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
import { getDb } from '../db/index.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { localDateStr, localDateExpr } from '../utils/date-utils.js';
import { logger } from '../utils/logger.js'; // S1/T2: errores de pago/corte al log diario
import { broadcastOrderToCaja } from '../services/order-broadcaster.js'; // S2-D: caja real-time

const router = Router();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// FASE 5: comprobantes foto de pagos QR (base64 → archivo en data/payment-proofs/)
const PROOF_DIR = path.join(__dirname, '..', '..', 'data', 'payment-proofs');
// Ruta de subida usa un límite propio (10 MB) — el global es 1 MB (fotos base64 grandes)
const proofJsonParser = express.json({ limit: '10mb' });
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
export function processPayment(db, { order_id, method, amount, iva_amount, reference, notes, status, processed_by, received }) {
  const canonicalMethod = PAYMENT_METHOD_MAP[method];
  const canonicalStatus = PAYMENT_STATUS_MAP[status || 'completed'];

  // B2 (2026-08-13): defensa en profundidad — la ruta ya valida amount,
  // pero este es el punto de entrada ÚNICO para registrar pagos. Antes
  // `Number(amount) || 0` convertía 'abc' o NaN en Bs 0 silenciosamente.
  // Ahora: throw claro (el catch de la ruta lo mapea). Se aceptan strings
  // numéricas ("34.5") por retrocompat con clientes legacy.
  const rawAmount = Number(amount);
  if (!Number.isFinite(rawAmount) || rawAmount < 0) {
    throw new Error(`El monto es inválido: ${String(amount)} (debe ser un número ≥ 0)`);
  }
  const amountValue = round2(rawAmount);

  if (!canonicalMethod) {
    throw new Error(`Método de pago inválido: ${method}`);
  }

  // F3-2: efectivo al centavo. received = lo que entrega el cliente.
  // Si no se envía (retrocompat) → received = amount, change = 0.
  let receivedValue = amountValue;
  let changeValue = 0;
  if (received !== undefined && received !== null) {
    receivedValue = round2(Number(received) || 0);
    if (canonicalMethod !== 'cash') {
      throw new Error('El campo received solo aplica a pagos en efectivo');
    }
    if (receivedValue < amountValue) {
      throw new Error('Cambio inválido: el monto recibido es menor al cobrado');
    }
    changeValue = round2(receivedValue - amountValue);
  }

  const execute = db.transaction(() => {
    const order = db.prepare('SELECT id, total, iva_amount, status FROM orders WHERE id = ?').get(order_id);
    if (!order) {
      throw new Error(`Pedido no encontrado: ${order_id}`);
    }
    if (order.status === 'cancelled') {
      throw new Error('No se puede pagar un pedido cancelado');
    }

    // C2: solo completed cuenta como cobrado. FASE 3: sin propina → SUM(amount).
    const paid = db.prepare(`
      SELECT COALESCE(SUM(amount), 0) as total_paid FROM payments
      WHERE order_id = ? AND status = 'completed'
    `).get(order_id);
    const remaining = round2((order.total || 0) - paid.total_paid);

    // C2: la constraint de saldo SOLO aplica a pagos que cuentan como
    // cobrados (completed). failed/refunded se registran sin tocar el saldo:
    // un refund se puede registrar aunque el pedido ya esté paid.
    if (canonicalStatus === 'completed' && amountValue > remaining + 0.001) {
      throw new Error(`El monto excede el saldo pendiente. Restante: Bs ${remaining.toFixed(2)}`);
    }

    const paymentId = randomUUID();
    // SSOT IVA: si el cliente no envía iva_amount, derivar del pedido
    // (orders.iva_amount) — evita pagos con IVA 0 inconsistentes.
    const ivaAmount = iva_amount ?? order.iva_amount ?? 0;
    db.prepare(`
      INSERT INTO payments (id, order_id, method, amount, iva_amount, received, change, reference,
                            status, processed_by, notes, synced_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      paymentId, order_id, canonicalMethod, amountValue, ivaAmount, receivedValue, changeValue, reference || '',
      canonicalStatus, processed_by, notes || '', new Date().toISOString()
    );

    // El nuevo pago solo aporta al saldo si es completed
    const isCompleted = canonicalStatus === 'completed';
    const totalPaid = paid.total_paid + (isCompleted ? amountValue : 0);
    const fullyPaid = isCompleted && round2(totalPaid) >= round2(order.total || 0);

    // Update order payment state
    db.prepare(`
      UPDATE orders SET is_paid = ?,
                        payment_method = CASE WHEN ? THEN ? ELSE payment_method END,
                        payment_reference = CASE WHEN ? THEN ? ELSE payment_reference END,
                        paid_at = CASE WHEN ? THEN datetime('now') ELSE paid_at END,
                        status = CASE WHEN ? THEN 'paid' ELSE status END,
                        updated_at = datetime('now')
      WHERE id = ?
    `).run(
      fullyPaid ? 1 : 0,
      isCompleted ? 1 : 0, canonicalMethod,
      isCompleted ? 1 : 0, reference || '',
      fullyPaid ? 1 : 0, fullyPaid ? 1 : 0,
      order_id
    );

    // If fully paid, free the table (if no other active orders)
    if (fullyPaid) {
      const table = db.prepare('SELECT table_id FROM orders WHERE id = ?').get(order_id);
      if (table && table.table_id) {
        const activeOrders = db.prepare(
          "SELECT id FROM orders WHERE table_id = ? AND status NOT IN ('paid','cancelled') AND id != ?"
        ).get(table.table_id, order_id);
        if (!activeOrders) {
          db.prepare("UPDATE tables SET status = 'free', current_order_id = NULL WHERE id = ?").run(table.table_id);
        }
      }
    }

    return { paymentId, fullyPaid, remaining: round2(remaining - (isCompleted ? amountValue : 0)) };
  });

  return execute();
}

export function round2(n) {
  return Math.round(n * 100) / 100;
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
    const { order_id, amount, method, iva_amount, reference, notes, status, received } = req.body;

    if (!order_id || amount === undefined || !method) {
      return res.status(400).json({
        success: false,
        error: 'Orden, monto y método son requeridos',
        code: 'PAYMENT_DATA_REQUIRED',
      });
    }

    // B2 (2026-08-13): amount DEBE ser numérico ≥ 0. Decisión documentada:
    // se aceptan strings numéricas ("34.5") por retrocompat con clientes
    // legacy que serializan montos como string (Number("34.5") es finito).
    // Se rechaza: 'abc', NaN, null, '', booleanos, arrays y negativos.
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

    const db = getDb();
    const result = processPayment(db, {
      order_id, amount, method, iva_amount, reference, notes, status, received,
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
    if (err.message.startsWith('Cambio inválido')) {
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
    const buffer = Buffer.from(base64Data, 'base64');

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
    const filename = `${payment.id}.${ext}`;
    const absPath = path.join(PROOF_DIR, filename);
    fs.writeFileSync(absPath, buffer);

    const proofUrl = `/payment-proofs/${filename}`;
    db.prepare('UPDATE payments SET proof_photo = ?, notes = ? WHERE id = ?').run(
      proofUrl,
      payment.notes || 'Comprobante QR adjunto',
      payment.id
    );

    res.json({ success: true, proof_photo: proofUrl, message: 'Comprobante guardado' });
  } catch (err) {
    logger.error('[Payments] Proof upload error:', err.message);
    res.status(500).json({ success: false, error: 'Error al guardar el comprobante', code: 'PROOF_UPLOAD_ERROR' });
  }
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

    // C1: "hoy" local America/La_Paz (no UTC) — ver server/utils/date-utils.js
    const today = localDateStr();
    // C2: solo completed. C5: cash = solo efectivo. FASE 3: sin propina → SUM(amount).
    const summary = db.prepare(`
      SELECT p.method, COUNT(*) as count, SUM(p.amount) as total
      FROM payments p
      WHERE ${localDateExpr('p.processed_at')} = ? AND p.status = 'completed'
      GROUP BY p.method
    `).all(today);

    const totalToday = db.prepare(`
      SELECT COALESCE(SUM(amount), 0) as total FROM payments
      WHERE ${localDateExpr('processed_at')} = ? AND status = 'completed'
    `).get(today);

    const cashToday = db.prepare(`
      SELECT COALESCE(SUM(amount), 0) as total FROM payments
      WHERE ${localDateExpr('processed_at')} = ? AND status = 'completed' AND method = 'cash'
    `).get(today);

    // F3-2: efectivo al centavo — lo que el cliente entregó (received) y el vuelto
    // (change) del día. Neto en caja = received_total - change_total == cash.
    const cashFlowToday = db.prepare(`
      SELECT COALESCE(SUM(received), 0) as received, COALESCE(SUM(change), 0) as change
      FROM payments
      WHERE ${localDateExpr('processed_at')} = ? AND status = 'completed' AND method = 'cash'
    `).get(today);

    // Orders summary
    const ordersToday = db.prepare(`
      SELECT COUNT(*) as total,
             SUM(CASE WHEN status = 'paid' THEN 1 ELSE 0 END) as completed,
             SUM(total) as revenue
      FROM orders WHERE ${localDateExpr('created_at')} = ?
    `).get(today);

    res.json({
      success: true,
      closing: current || null,
      today: {
        date: today,
        payments: summary,
        total: totalToday?.total || 0,
        cash: cashToday?.total || 0,
        received_total: cashFlowToday?.received || 0,
        change_total: cashFlowToday?.change || 0,
        orders: ordersToday,
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

    // C1: "hoy" local America/La_Paz. C5: expected_cash = SOLO method='cash'
    // (QR es "ya depositado" — el cajero cuadra únicamente el efectivo).
    const today = localDateStr();
    const expected = db.prepare(`
      SELECT COALESCE(SUM(amount), 0) as total FROM payments
      WHERE ${localDateExpr('processed_at')} = ? AND status = 'completed' AND method = 'cash'
    `).get(today);

    const id = randomUUID();
    const openedAt = new Date().toISOString();

    db.prepare(`
      INSERT INTO cash_closings (id, closing_date, opened_at, opened_by, expected_cash, actual_cash, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, today, openedAt, req.user.sub, expected?.total || 0, expected?.total || 0, '');

    res.status(201).json({
      success: true,
      message: 'Corte de caja iniciado',
      closing: {
        id,
        opened_at: openedAt,
        expected: expected?.total || 0,
        actual: expected?.total || 0,
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
    const { actual_cash, notes } = req.body;
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

    const closedAt = new Date().toISOString();
    // C5: difference = actual - expected SOLO efectivo.
    const difference = round2(Number(actual_cash) - open.expected_cash);
    // M9: el SERVER decide is_reconciled (el valor del cliente se ignora y se
    // recalcula): |actual - expected| <= 0.01 → cuadra al centavo.
    const reconciled = Math.abs(difference) <= 0.01 ? 1 : 0;

    db.prepare(`
      UPDATE cash_closings
      SET closed_at = ?, closed_by = ?, actual_cash = ?, cash_difference = ?,
          is_reconciled = ?, notes = ?
      WHERE id = ?
    `).run(closedAt, req.user.sub, Number(actual_cash), difference, reconciled, notes || open.notes, open.id);

    res.json({
      success: true,
      message: 'Corte de caja cerrado',
      closing: {
        id: open.id,
        opened_at: open.opened_at,
        closed_at: closedAt,
        expected: open.expected_cash,
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
