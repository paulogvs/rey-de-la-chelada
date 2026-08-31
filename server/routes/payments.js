/**
 * ═══════════════════════════════════════════════════════════
 *  Payments Routes — Cobros, Corte de Caja
 *
 *  GET    /api/payments               → Listar pagos
 *  GET    /api/payments/:id           → Pago específico
 *  POST   /api/payments               → Procesar pago
 *  GET    /api/payments/closing/current → Corte de caja actual
 *  POST   /api/payments/closing       → Abrir corte de caja
 *  PUT    /api/payments/closing/close → Cerrar corte de caja
 *
 *  Alineado al SSOT: server/db/schema.js
 *  payments.method:  cash, qr  (FASE 3: solo Efectivo o QR — adiós yape/simple/card/transfer)
 *  payments.status:  pending, completed, failed, refunded
 *  cash_closings:    sin columna status → abierto = closed_at IS NULL
 *  Pedido pagado:    orders.is_paid = 1, status = 'paid'
 *
 *  FASE 1 (caja cuadre al centavo):
 *  - C1: "hoy" = fecha local America/La_Paz (UTC-4) → date-utils.js.
 *  - C2: solo payments status='completed' cuentan como cobrados.
 *  - C5: expected_cash = SOLO method='cash'; is_reconciled lo decide el server.
 *  - A4: processPayment atómico (db.transaction → rollback total).
 *  FASE 3 (simplificación — 2026-08-11):
 *  - F3-1: propina ELIMINADA (se da directo al mesero). tip se ignora/elimina.
 *  - F3-2: efectivo al centavo — payments.received (lo que entrega el cliente) y
 *    payments.change (vuelto = received - amount). SUM(amount) = neto en caja.
 * ═══════════════════════════════════════════════════════════
 */

import express, { Router } from 'express';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { getDb } from '../db/index.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { businessDayDateStr, businessDayExpr } from '../utils/date-utils.js';
import { toCents } from '../../src/core/config/iva.js'; // v11: centavos
import { logger } from '../utils/logger.js'; // S1/T2: errores de pago/corte al log diario
import { broadcastOrderToCaja } from '../services/order-broadcaster.js'; // S2-D: caja real-time
import { recordPayment, recordMixedPayment } from '../services/financial/payment-service.js';

const router = Router();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// FASE 5: comprobantes foto de pagos QR (base64 → archivo en data/payment-proofs/)
const PROOF_DIR = path.join(__dirname, '..', '..', 'data', 'payment-proofs');
// Ruta de subida usa un límite propio (10 MB) — el global es 1 MB (fotos base64 grandes)
const proofJsonParser = express.json({ limit: '20mb' });
// ============================================================
// Helpers
// ============================================================

// FASE 3: SOLO 2 métodos cash|qr. Sinónimos ES aceptados; métodos legacy
// (qr_yape/qr_simple/card/transfer) ya NO existen → el request se rechaza (400).
const PAYMENT_METHOD_MAP = {
  efectivo: 'cash', cash: 'cash',
  qr: 'qr', 'qr-code': 'qr',
};

const PAYMENT_STATUS_MAP = {
  pendiente: 'pending', pending: 'pending',
  completado: 'completed', completed: 'completed',
  fallido: 'failed', failed: 'failed',
  reembolsado: 'refunded', refunded: 'refunded',
};

/**
 * Registra un pago y devuelve { paymentId, fullyPaid, remaining }.
 *
 * SEMÁNTICA (FASE 3):
 *   - `amount` = monto aplicado al saldo del pedido (SIEMPRE neto).
 *   - `received` (solo cash) = lo que el cliente ENTREGA (ej. Bs 50 por cuenta de 34.50).
 *   - `change` (solo cash)   = vuelto = received - amount (ej. 15.50). El server lo calcula.
 *   - La propina NO existe: el cliente la da directo al mesero, fuera de la app.
 *   - El saldo del pedido se cubre con SUM(amount) de payments completed.
 *   - Retrocompatible: payments sin received (received=0) → received=amount, change=0.
 *
 * SEMÁNTICA (C2 — estado):
 *   - Solo payments con status='completed' cuentan como cobrados.
 *   - failed/refunded se registran pero NO afectan saldo ni is_paid.
 *
 * ATOMICIDAD (A4): todo el flujo corre en db.transaction() — si algo
 * falla a mitad (validación, INSERT, UPDATE) → rollback total, sin pagos
 * huérfanos ni pedidos parcialmente actualizados.
 *
 * @param {object} db — better-sqlite3
 * @param {{ order_id, method, amount, iva_amount, reference, notes, status, processed_by, received }} args
 */
export function processPayment(db, args) {
  const canonicalMethod = PAYMENT_METHOD_MAP[args.method];
  const canonicalStatus = PAYMENT_STATUS_MAP[args.status || 'completed'];

  // B2 (2026-08-13): defensa en profundidad — la ruta ya valida amount,
  // pero este es el punto de entrada ÚNICO para registrar pagos. Antes
  // `Number(amount) || 0` convertía 'abc' o NaN en Bs 0 silenciosamente.
  // Ahora: throw claro (el catch de la ruta lo mapea). Se aceptan strings
  // numéricas ("1050") por retrocompat con clientes legacy.
  // v11 (2026-08-19): CENTAVOS — el API espera enteros en centavos. Por
  // tolerancia con clientes legacy que aún manden Bs con decimales ("10.5"),
  // si el número no es entero se convierte con toCents (10.5 → 1050).
  const rawAmount = Number(args.amount);
  if (!Number.isFinite(rawAmount) || rawAmount < 0) {
    throw new Error(`El monto es inválido: ${String(args.amount)} (debe ser un número ≥ 0)`);
  }
  const amountValue = Number.isInteger(rawAmount) ? rawAmount : toCents(rawAmount);

  if (!canonicalMethod || !canonicalStatus) {
    throw new Error(`Método de pago inválido: ${args.method}`);
  }

  // F3-2: efectivo al centavo. received = lo que entrega el cliente.
  // Si no se envía (retrocompat) → received = amount, change = 0.
  // 2026-08-26: change explícito (cambio por QR) y transferOut (retiro QR).
  return recordPayment(db, { orderId: args.order_id, method: canonicalMethod, amount: amountValue,
    ivaAmount: args.iva_amount, reference: args.reference, notes: args.notes, status: canonicalStatus,
    processedBy: args.processed_by, received: args.received, change: args.change,
    transferOut: args.transfer_out, idempotencyKey: args.idempotency_key });
}

export function round2(n) {
  return Math.round(n);
}

// ============================================================
// GET /api/payments — Listar pagos
// ============================================================

router.get('/', requireAuth, (req, res) => {
  try {
    const db = getDb();
    const { date_from, date_to, method, order_id } = req.query;

    let sql = `
      SELECT p.*, o.table_id, t.number as table_number, s.display_name as processed_by_name
      FROM payments p
      JOIN orders o ON p.order_id = o.id
      LEFT JOIN tables t ON o.table_id = t.id
      LEFT JOIN staff s ON p.processed_by = s.id
      WHERE 1=1
    `;
    const params = [];

    if (date_from) { sql += ' AND p.processed_at >= ?'; params.push(date_from); }
    if (date_to) { sql += ' AND p.processed_at <= ?'; params.push(date_to); }
    if (method) { sql += ' AND p.method = ?'; params.push(PAYMENT_METHOD_MAP[method] || method); }
    if (order_id) { sql += ' AND p.order_id = ?'; params.push(order_id); }

    sql += ' ORDER BY p.processed_at DESC';

    const payments = db.prepare(sql).all(...params);
    res.json({ success: true, payments, count: payments.length });
  } catch (err) {
    logger.error('[Payments] List error:', err.message);
    res.status(500).json({ success: false, error: 'Error al listar pagos', code: 'PAYMENTS_LIST_ERROR' });
  }
});

// ============================================================
// GET /api/payments/closings — Historial de cortes de caja
// (solo cerrados; el actual se obtiene con /closing/current)
// NOTA: debe ir ANTES de GET /:id (patrón de un segmento)
// ============================================================

router.get('/closings', requireAuth, requireRole('admin', 'caja'), (req, res) => {
  try {
    const db = getDb();
    const closings = db.prepare(`
      SELECT cc.*, s.display_name as closed_by_name, o.display_name as opened_by_name
      FROM cash_closings cc
      LEFT JOIN staff s ON cc.closed_by = s.id
      LEFT JOIN staff o ON cc.opened_by = o.id
      WHERE cc.closed_at IS NOT NULL
      ORDER BY cc.closed_at DESC
      LIMIT 50
    `).all();
    res.json({ success: true, closings, count: closings.length });
  } catch (err) {
    logger.error('[Payments] Closings history error:', err.message);
    res.status(500).json({ success: false, error: 'Error al obtener historial de cortes', code: 'CLOSINGS_HISTORY_ERROR' });
  }
});

// ============================================================
// GET /api/payments/:id
// ============================================================

router.get('/:id', requireAuth, (req, res) => {
  try {
    const db = getDb();
    const payment = db.prepare(`
      SELECT p.*, o.table_id, t.number as table_number, s.display_name as processed_by_name
      FROM payments p
      JOIN orders o ON p.order_id = o.id
      LEFT JOIN tables t ON o.table_id = t.id
      LEFT JOIN staff s ON p.processed_by = s.id
      WHERE p.id = ?
    `).get(req.params.id);

    if (!payment) {
      return res.status(404).json({ success: false, error: 'Pago no encontrado', code: 'PAYMENT_NOT_FOUND' });
    }

    res.json({ success: true, payment });
  } catch (err) {
    logger.error('[Payments] Get error:', err.message);
    res.status(500).json({ success: false, error: 'Error al obtener pago', code: 'PAYMENT_GET_ERROR' });
  }
});

// ============================================================
// POST /api/payments — Procesar pago
// ============================================================

router.post('/', requireAuth, requireRole('admin', 'mesero', 'caja'), (req, res) => {
  try {
    const { order_id, amount, method, iva_amount, reference, notes, status, received, change, transfer_out, idempotency_key } = req.body;

    if (!order_id || amount === undefined || !method) {
      return res.status(400).json({
        success: false,
        error: 'Orden, monto y método son requeridos',
        code: 'PAYMENT_DATA_REQUIRED',
      });
    }

    // B2 (2026-08-13): amount DEBE ser numérico ≥ 0 para pagos. EXCEPCIÓN
    // (2026-08-26): RETIRO QR — method='qr' + transfer_out=true con amount
    // POSITIVO → se registra como SALIDA QR (amount negativo en la DB) para
    // devolver cambio por QR. Ver payment-calculator (transferOut).
    if (amount === null || amount === '' ||
        (typeof amount !== 'number' && typeof amount !== 'string') ||
        !Number.isFinite(Number(amount)) || Number(amount) < 0) {
      return res.status(400).json({
        success: false,
        error: 'Monto inválido (debe ser un número ≥ 0)',
        code: 'INVALID_AMOUNT',
      });
    }

    if (!PAYMENT_METHOD_MAP[method]) {
      return res.status(400).json({
        success: false,
        error: `Método inválido. Use: ${Object.keys(PAYMENT_METHOD_MAP).join(', ')}`,
        code: 'INVALID_METHOD',
      });
    }

    // Retiro QR: solo method qr + transfer_out; received/change no aplican
    if (transfer_out) {
      if (PAYMENT_METHOD_MAP[method] !== 'qr') {
        return res.status(400).json({
          success: false,
          error: 'El retiro QR solo aplica a method=qr',
          code: 'TRANSFER_OUT_ONLY_QR',
        });
      }
      if (Number(amount) <= 0) {
        return res.status(400).json({
          success: false,
          error: 'El retiro QR debe ser mayor que cero',
          code: 'INVALID_AMOUNT',
        });
      }
    } else {
      // F3-2: el efectivo al centavo exige received ≥ 0 y recibido ≥ cobrado
      if (received !== undefined && received !== null) {
        if (typeof received !== 'number' || Number.isNaN(received) || received < 0) {
          return res.status(400).json({
            success: false,
            error: 'Monto recibido inválido (debe ser un número ≥ 0)',
            code: 'INVALID_RECEIVED',
          });
        }
        if (PAYMENT_METHOD_MAP[method] === 'cash' && round2(Number(received)) < round2(Number(amount))) {
          return res.status(400).json({
            success: false,
            error: 'El monto recibido no puede ser menor al monto cobrado',
            code: 'INVALID_RECEIVED',
          });
        }
      }
      // change explícito (cambio por QR): ≤ vuelto total
      if (change !== undefined && change !== null) {
        if (typeof change !== 'number' || Number.isNaN(change) || change < 0) {
          return res.status(400).json({
            success: false,
            error: 'Cambio inválido (debe ser un número ≥ 0)',
            code: 'INVALID_CHANGE',
          });
        }
        if (PAYMENT_METHOD_MAP[method] === 'cash' && Number(change) > round2(Number(received) - Number(amount))) {
          return res.status(400).json({
            success: false,
            error: 'El cambio no puede exceder el vuelto total',
            code: 'INVALID_CHANGE',
          });
        }
      }
    }

    const db = getDb();
    const result = processPayment(db, {
      order_id, amount, method, iva_amount, reference, notes, status, received, change,
      transfer_out: !!transfer_out,
      idempotency_key,
      processed_by: req.user.sub,
    });

    const payment = db.prepare('SELECT * FROM payments WHERE id = ?').get(result.paymentId);

    // S2-D: la caja refresca su lista de pendientes en tiempo real cuando
    // se procesa un pago (el pedido pasa a paid → sale de pending).
    try {
      const paidOrder = db.prepare(`
        SELECT o.id, o.status, o.table_id, t.number as table_number
        FROM orders o
        LEFT JOIN tables t ON o.table_id = t.id
        WHERE o.id = ?
      `).get(order_id);
      broadcastOrderToCaja(paidOrder);
    } catch (broadcastErr) {
      logger.warn('[Payments] Broadcast a caja falló:', broadcastErr.message);
    }

    res.status(201).json({
      success: true,
      payment,
      fully_paid: result.fullyPaid,
      remaining: result.remaining,
    });
  } catch (err) {
    if (err.code === 'IDEMPOTENCY_CONFLICT' || err.code === 'IDEMPOTENCY_REQUIRED') {
      return res.status(409).json({ success: false, error: err.message, code: err.code });
    }
    if (err.message.includes('received') || err.message.startsWith('Cambio inválido')) {
      return res.status(400).json({ success: false, error: err.message, code: 'INVALID_RECEIVED' });
    }
    const known = err.message.startsWith('El monto') || err.message.startsWith('Método') ||
                   err.message.startsWith('Pedido no encontrado') || err.message.startsWith('No se puede pagar');
    if (known) {
      return res.status(409).json({ success: false, error: err.message, code: 'PAYMENT_CONFLICT' });
    }
    logger.error('[Payments] Create error:', err.message);
    res.status(500).json({ success: false, error: 'Error al procesar pago', code: 'PAYMENT_CREATE_ERROR' });
  }
});

// POST /api/payments/mixed — una operación atómica con cash + QR.
router.post('/mixed', requireAuth, requireRole('admin', 'mesero', 'caja'), (req, res) => {
  try {
    const { order_id, allocations, idempotency_key } = req.body || {};
    if (!order_id || !Array.isArray(allocations) || !idempotency_key) {
      return res.status(400).json({ success: false, error: 'order_id, allocations e idempotency_key son requeridos', code: 'PAYMENT_DATA_REQUIRED' });
    }
    const result = recordMixedPayment(getDb(), { orderId: order_id, allocations, idempotencyKey: idempotency_key, processedBy: req.user.sub });
    res.status(201).json({ success: true, ...result });
  } catch (err) {
    const status = ['IDEMPOTENCY_CONFLICT', 'ORDER_CLOSED', 'ORDER_NOT_FOUND', 'PAYMENT_CONFLICT'].includes(err.code) ? 409 : 400;
    res.status(status).json({ success: false, error: err.message, code: err.code || 'PAYMENT_INVALID' });
  }
});

// ============================================================
// POST /api/payments/:id/proof — Subir comprobante foto (SOLO QR)
// ============================================================
// FASE 5: el mesero/cajero toma una foto del comprobante del pago QR
// (transferencia/billetera). Se envía como base64 en JSON:
//   { image: "data:image/jpeg;base64,/9j/4AAQ..." }
// Se guarda en data/payment-proofs/{paymentId}.jpg y se enlaza a la
// transacción vía payments.proof_photo. Solo aplica a method='qr'.
// ============================================================

router.post('/:id/proof', proofJsonParser, requireAuth, requireRole('admin', 'mesero', 'caja'), (req, res) => {
  try {
    const { image } = req.body || {};
    const db = getDb();

    const payment = db.prepare('SELECT * FROM payments WHERE id = ?').get(req.params.id);
    if (!payment) {
      return res.status(404).json({ success: false, error: 'Pago no encontrado', code: 'PAYMENT_NOT_FOUND' });
    }
    if (payment.method !== 'qr') {
      return res.status(400).json({
        success: false,
        error: 'El comprobante foto solo aplica a pagos QR',
        code: 'PROOF_ONLY_QR',
      });
    }

    // Validar base64 data URL: data:image/{jpeg|png|webp};base64,...
    if (typeof image !== 'string' || !image.includes(';base64,')) {
      return res.status(400).json({
        success: false,
        error: 'Imagen inválida — se espera data:image/*;base64,...',
        code: 'INVALID_PROOF_IMAGE',
      });
    }

    const mimeMatch = image.match(/^data:image\/([a-zA-Z0-9.+-]+);base64,(.+)$/s);
    if (!mimeMatch) {
      return res.status(400).json({
        success: false,
        error: 'Formato de imagen no soportado (use jpeg, png o webp)',
        code: 'INVALID_PROOF_MIME',
      });
    }

    const ext = mimeMatch[1].toLowerCase() === 'png' ? 'png' : mimeMatch[1].toLowerCase() === 'webp' ? 'webp' : 'jpg';
    const base64Data = mimeMatch[2];
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(base64Data) || base64Data.length % 4 === 1) {
      return res.status(400).json({ success: false, error: 'Base64 inválido', code: 'INVALID_PROOF_IMAGE' });
    }
    const buffer = Buffer.from(base64Data, 'base64');

    const magic = (ext === 'png' && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) ||
      (ext === 'jpg' && buffer.subarray(0, 3).equals(Buffer.from([255, 216, 255]))) ||
      (ext === 'webp' && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP');
    if (!magic) return res.status(400).json({ success: false, error: 'El contenido no coincide con el MIME', code: 'INVALID_PROOF_IMAGE' });

    // Límite defensivo: ~8 MB (fotos de teléfono comprimidas)
    if (buffer.length > 8 * 1024 * 1024) {
      return res.status(400).json({
        success: false,
        error: 'La imagen supera 8 MB',
        code: 'PROOF_TOO_LARGE',
      });
    }

    // Asegurar directorio (idempotente)
    fs.mkdirSync(PROOF_DIR, { recursive: true });
    // 2026-08-26: FOTOS MÚLTIPLES por pago QR — filename ÚNICO por foto
    // (antes `${payment.id}.${ext}` colisionaba y sobrescribía). Varias
    // personas de una mesa pagan QR → varios comprobantes del mismo pago.
    const filename = `${payment.id}-${randomUUID().slice(0, 8)}.${ext}`;
    const absPath = path.join(PROOF_DIR, filename);
    fs.writeFileSync(absPath, buffer);

    const proofUrl = `/payment-proofs/${filename}`;
    db.prepare('UPDATE payments SET proof_photo = ?, notes = ? WHERE id = ?').run(
      proofUrl,
      payment.notes || 'Comprobante QR adjunto',
      payment.id
    );
    // INSERT normal (no OR REPLACE): una fila por foto en payment_proofs
    db.prepare(`INSERT INTO payment_proofs (id, payment_id, storage_key, mime, size, hash, status)
      VALUES (?, ?, ?, ?, ?, ?, 'pending')`).run(randomUUID(), payment.id, filename,
      `image/${ext === 'jpg' ? 'jpeg' : ext}`, buffer.length, createHash('sha256').update(buffer).digest('hex'));

    res.json({ success: true, proof_photo: proofUrl, message: 'Comprobante guardado' });
  } catch (err) {
    logger.error('[Payments] Proof upload error:', err.message);
    res.status(500).json({ success: false, error: 'Error al guardar el comprobante', code: 'PROOF_UPLOAD_ERROR' });
  }
});

router.get('/:id/proof', requireAuth, requireRole('admin', 'mesero', 'caja'), (req, res) => {
  // 2026-08-26: devolver TODAS las fotos del pago QR (varias personas → varios comprobantes)
  const proofs = getDb().prepare('SELECT id, payment_id, storage_key, mime, size, hash, status, reviewer, supersedes, created_at, updated_at FROM payment_proofs WHERE payment_id = ? ORDER BY created_at DESC').all(req.params.id);
  if (proofs.length === 0) return res.status(404).json({ success: false, error: 'Comprobante no encontrado', code: 'PROOF_NOT_FOUND' });
  res.json({ success: true, proofs, proof: proofs[0], count: proofs.length });
});

router.get('/:id/proof/content', requireAuth, requireRole('admin', 'mesero', 'caja'), (req, res) => {
  // v14 (2026-08-29): permitir servir UN comprobante específico (?proof_id=).
  // Sin proof_id, se mantiene el comportamiento previo (el más reciente).
  let proof;
  if (req.query.proof_id) {
    proof = getDb().prepare('SELECT storage_key, mime FROM payment_proofs WHERE id = ? AND payment_id = ?').get(req.query.proof_id, req.params.id);
  } else {
    proof = getDb().prepare('SELECT storage_key, mime FROM payment_proofs WHERE payment_id = ? ORDER BY created_at DESC LIMIT 1').get(req.params.id);
  }
  if (!proof || !/^[0-9a-f-]+\.(png|jpg|webp)$/.test(proof.storage_key)) return res.status(404).json({ success: false, error: 'Comprobante no encontrado', code: 'PROOF_NOT_FOUND' });
  const file = path.join(PROOF_DIR, proof.storage_key);
  if (!fs.existsSync(file)) return res.status(404).json({ success: false, error: 'Archivo no encontrado', code: 'PROOF_FILE_NOT_FOUND' });
  res.type(proof.mime).sendFile(file);
});

// ============================================================
// GET /api/payments/closing/current — Corte de caja actual
// ============================================================

router.get('/closing/current', requireAuth, requireRole('admin', 'caja'), (req, res) => {
  try {
    const db = getDb();

    // Current open closing (abierto = closed_at IS NULL)
    const current = db.prepare(
      'SELECT * FROM cash_closings WHERE closed_at IS NULL ORDER BY opened_at DESC LIMIT 1'
    ).get();

    // Opción B (2026-08-19): "hoy" = DÍA LABORAL (turno 15:00 → 06:00 del
    // día siguiente) — un solo corte de caja por turno. Ver date-utils.js.
    const today = businessDayDateStr();
    // C2: solo completed. C5: cash = solo efectivo. FASE 3: sin propina → SUM(amount).
    const summary = db.prepare(`
      SELECT p.method, COUNT(*) as count, SUM(p.amount) as total
      FROM payments p
      WHERE ${businessDayExpr('p.processed_at')} = ? AND p.status = 'completed'
      GROUP BY p.method
    `).all(today);

    const totalToday = db.prepare(`
      SELECT COALESCE(SUM(amount), 0) as total FROM payments
      WHERE ${businessDayExpr('processed_at')} = ? AND status = 'completed'
    `).get(today);

    // v13 (2026-08-26): "efectivo ingresado" = NETO FÍSICO que entra al cajón =
    // SUM(received) − SUM(change). Con recibido=amount y change=0 → = amount
    // (igual que antes). Con cambio en efectivo: received=amount+X, change=X
    // → neto = amount ✓. Con cambio POR QR: received=amount+Y, change=0 →
    // neto = amount+Y ✓ (el vuelto no salió del cajón; el QR lo absorbe).
    const cashToday = db.prepare(`
      SELECT COALESCE(SUM(received), 0) - COALESCE(SUM(change), 0) as total FROM payments
      WHERE ${businessDayExpr('processed_at')} = ? AND status = 'completed' AND method = 'cash'
    `).get(today);

    // QR del día: SUM(amount) — incluye retiros QR (amount negativo, cambio por QR)
    const qrToday = db.prepare(`
      SELECT COALESCE(SUM(amount), 0) as total FROM payments
      WHERE ${businessDayExpr('processed_at')} = ? AND status = 'completed' AND method = 'qr'
    `).get(today);

    // 2026-08-27: "transacciones" = PEDIDOS pagados distintos, no pagos.
    // Un pedido pagado con efectivo+QR (mixto) o con retiro QR genera 2+ filas
    // en `payments`, pero es UNA sola venta → COUNT(DISTINCT order_id).
    const txToday = db.prepare(`
      SELECT COUNT(DISTINCT order_id) as n FROM payments
      WHERE ${businessDayExpr('processed_at')} = ? AND status = 'completed'
    `).get(today);

    // F3-2: efectivo al centavo — lo que el cliente entregó (received) y el vuelto
    // (change) del día. Neto en caja = received_total - change_total == cash.
    const cashFlowToday = db.prepare(`
      SELECT COALESCE(SUM(received), 0) as received, COALESCE(SUM(change), 0) as change
      FROM payments
      WHERE ${businessDayExpr('processed_at')} = ? AND status = 'completed' AND method = 'cash'
    `).get(today);

    // Orders summary
    const ordersToday = db.prepare(`
      SELECT COUNT(*) as total,
             SUM(CASE WHEN status = 'paid' THEN 1 ELSE 0 END) as completed,
             SUM(total) as revenue
      FROM orders WHERE ${businessDayExpr('created_at')} = ?
    `).get(today);

    // v13 (2026-08-25): efectivo INICIAL = efectivo contado (actual_cash) del
    // cierre cerrado más reciente ANTERIOR al día laboral actual. Si es el
    // primer cierre de la historia → 0. El opening se congela al ABRIR el
    // cierre (POST /closing) y aquí se expone el snapshot + el cálculo vivo.
    const openingCash = current?.opening_cash ?? 0;
    const cash = cashToday?.total || 0;
    const qr = qrToday?.total || 0;
    const expensesCash = current?.expenses_cash ?? 0;
    const expensesQr = current?.expenses_qr ?? 0;

    res.json({
      success: true,
      closing: current || null,
      today: {
        date: today,
        payments: summary,
        total: totalToday?.total || 0,
        cash,
        qr,
        received_total: cashFlowToday?.received || 0,
        change_total: cashFlowToday?.change || 0,
        orders: ordersToday,
      },
      breakdown: {
        opening_cash: openingCash,
        cash_today: cash,
        qr_today: qr,
        total_general: openingCash + cash + qr,
        transactions: txToday?.n || 0,
        expenses_cash: expensesCash,
        expenses_qr: expensesQr,
        expected_cash: openingCash + cash - expensesCash,
        expected_qr: qr - expensesQr,
      },
    });
  } catch (err) {
    logger.error('[Payments] Closing current error:', err.message);
    res.status(500).json({ success: false, error: 'Error al obtener corte actual', code: 'CLOSING_CURRENT_ERROR' });
  }
});

// ============================================================
// POST /api/payments/closing — Abrir corte de caja
// ============================================================

router.post('/closing', requireAuth, requireRole('admin', 'caja'), (req, res) => {
  try {
    const db = getDb();

    // Check if there's an open closing
    const open = db.prepare('SELECT id FROM cash_closings WHERE closed_at IS NULL').get();
    if (open) {
      return res.status(409).json({ success: false, error: 'Ya hay un corte de caja abierto', code: 'CLOSING_ALREADY_OPEN' });
    }

    // Opción B (2026-08-19): "hoy" = DÍA LABORAL (turno 15:00 → 06:00).
    // closing_date = día laboral (mié 15:00 → jue 06:00 = UN corte del miércoles).
    // C5: expected_cash = SOLO method='cash' (QR es "ya depositado").
    const today = businessDayDateStr();
    const expected = db.prepare(`
      SELECT COALESCE(SUM(amount), 0) as total FROM payments
      WHERE ${businessDayExpr('processed_at')} = ? AND status = 'completed' AND method = 'cash'
    `).get(today);

    // v13 (2026-08-25): efectivo INICIAL = efectivo contado (actual_cash) del
    // cierre cerrado más reciente. El primer cierre de la historia abre con 0.
    const prevClosing = db.prepare(`
      SELECT actual_cash FROM cash_closings
      WHERE closed_at IS NOT NULL
      ORDER BY closed_at DESC LIMIT 1
    `).get();
    const openingCash = prevClosing?.actual_cash ?? 0;

    const id = randomUUID();
    const openedAt = new Date().toISOString();

    db.prepare(`
      INSERT INTO cash_closings (id, closing_date, opened_at, opened_by, expected_cash, actual_cash, opening_cash, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, today, openedAt, req.user.sub, expected?.total || 0, expected?.total || 0, openingCash, '');

    res.status(201).json({
      success: true,
      message: 'Corte de caja iniciado',
      closing: {
        id,
        opened_at: openedAt,
        expected: expected?.total || 0,
        actual: expected?.total || 0,
        opening_cash: openingCash,
        difference: 0,
      },
    });
  } catch (err) {
    logger.error('[Payments] Open closing error:', err.message);
    res.status(500).json({ success: false, error: 'Error al iniciar corte', code: 'CLOSING_OPEN_ERROR' });
  }
});

// ============================================================
// PUT /api/payments/closing/close — Cerrar corte activo
// ============================================================

router.put('/closing/close', requireAuth, requireRole('admin', 'caja'), (req, res) => {
  try {
    // v13 (2026-08-25): la cajera ingresa al cerrar:
    //   actual_cash    → efectivo CONTADO al final del día
    //   expenses_cash  → gastos/retiros de caja en EFECTIVO (luz, etc.)
    //   expenses_qr    → gastos/retiros de caja en QR
    const { actual_cash, expenses_cash, expenses_qr, notes } = req.body;
    // M9: el cliente puede enviar is_reconciled, pero el SERVER lo ignora y lo
    // recalcula — nunca confiar en el valor del cliente. (ver línea de `reconciled`)

    if (actual_cash === undefined) {
      return res.status(400).json({ success: false, error: 'Monto final requerido', code: 'FINAL_AMOUNT_REQUIRED' });
    }

    const db = getDb();
    const open = db.prepare('SELECT * FROM cash_closings WHERE closed_at IS NULL ORDER BY opened_at DESC LIMIT 1').get();

    if (!open) {
      return res.status(404).json({ success: false, error: 'No hay corte de caja abierto', code: 'NO_OPEN_CLOSING' });
    }

    // Recalcular el desglose vivo del día laboral del cierre (SSOT):
    const closingDay = open.closing_date;
    // v13: efectivo = neto físico (received − change); QR = SUM(amount) (incluye retiros)
    const cashDay = db.prepare(`
      SELECT COALESCE(SUM(received), 0) - COALESCE(SUM(change), 0) as total FROM payments
      WHERE ${businessDayExpr('processed_at')} = ? AND status = 'completed' AND method = 'cash'
    `).get(closingDay);
    const qrDay = db.prepare(`
      SELECT COALESCE(SUM(amount), 0) as total FROM payments
      WHERE ${businessDayExpr('processed_at')} = ? AND status = 'completed' AND method = 'qr'
    `).get(closingDay);
    // 2026-08-27: "transacciones" = PEDIDOS pagados distintos (ver comentario arriba).
    const txDay = db.prepare(`
      SELECT COUNT(DISTINCT order_id) as n FROM payments
      WHERE ${businessDayExpr('processed_at')} = ? AND status = 'completed'
    `).get(closingDay);

    const openingCash = open.opening_cash ?? 0;
    const expensesCash = Math.max(0, Number(expenses_cash) || 0);
    const expensesQr = Math.max(0, Number(expenses_qr) || 0);
    const expectedCash = openingCash + (cashDay?.total || 0) - expensesCash;
    const expectedQr = (qrDay?.total || 0) - expensesQr;
    const totalGeneral = openingCash + (cashDay?.total || 0) + (qrDay?.total || 0);
    const transactions = txDay?.n || 0;

    const closedAt = new Date().toISOString();
    // C5: difference = actual - expected SOLO efectivo.
    const difference = round2(Number(actual_cash) - expectedCash);
    // M9: el SERVER decide is_reconciled (el valor del cliente se ignora y se
    // recalcula): |actual - expected| <= 0.01 → cuadra al centavo.
    const reconciled = Math.abs(difference) <= 0.01 ? 1 : 0;

    db.prepare(`
      UPDATE cash_closings
      SET closed_at = ?, closed_by = ?, actual_cash = ?, cash_difference = ?,
          is_reconciled = ?, notes = ?,
          expected_cash = ?, expenses_cash = ?, expenses_qr = ?,
          expected_qr = ?, total_general = ?, transactions = ?
      WHERE id = ?
    `).run(closedAt, req.user.sub, Number(actual_cash), difference, reconciled,
      notes || open.notes, expectedCash, expensesCash, expensesQr,
      expectedQr, totalGeneral, transactions, open.id);

    res.json({
      success: true,
      message: 'Corte de caja cerrado',
      closing: {
        id: open.id,
        opened_at: open.opened_at,
        closed_at: closedAt,
        opening_cash: openingCash,
        expected: expectedCash,
        expected_qr: expectedQr,
        total_general: totalGeneral,
        transactions,
        expenses_cash: expensesCash,
        expenses_qr: expensesQr,
        actual: Number(actual_cash),
        difference,
        is_reconciled: reconciled,
      },
    });
  } catch (err) {
    logger.error('[Payments] Close closing error:', err.message);
    res.status(500).json({ success: false, error: 'Error al cerrar corte', code: 'CLOSING_CLOSE_ERROR' });
  }
});

export default router;
