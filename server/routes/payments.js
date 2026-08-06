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
 *  payments.method:  cash, qr_yape, qr_simple, card, transfer
 *  payments.status:  pending, completed, failed, refunded
 *  cash_closings:    sin columna status → abierto = closed_at IS NULL
 *  Pedido pagado:    orders.is_paid = 1, status = 'paid'
 *
 *  FASE 1 (caja cuadre al centavo):
 *  - C1: "hoy" = fecha local America/La_Paz (UTC-4) → date-utils.js.
 *  - C2: solo payments status='completed' cuentan como cobrados.
 *  - C4: propina en payments.tip → total cobrado = amount + tip.
 *  - C5: expected_cash = SOLO method='cash'; is_reconciled lo decide el server.
 *  - A4: processPayment atómico (db.transaction → rollback total).
 * ═══════════════════════════════════════════════════════════
 */

import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { getDb } from '../db/index.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { localDateStr, localDateExpr } from '../utils/date-utils.js';

const router = Router();

// ============================================================
// Helpers
// ============================================================

const PAYMENT_METHOD_MAP = {
  efectivo: 'cash', cash: 'cash',
  qr: 'qr_yape', qr_yape: 'qr_yape', yape: 'qr_yape',
  qr_simple: 'qr_simple',
  tarjeta: 'card', card: 'card',
  transferencia: 'transfer', transfer: 'transfer',
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
 * SEMÁNTICA (C4 — propina):
 *   - `amount` = monto aplicado al saldo del pedido.
 *   - `tip`    = propina del mismo pago (mismo método; NO sujeta a IVA).
 *   - Total cobrado por el pago = amount + tip.
 *   - El saldo del pedido se cubre con SUM(amount + tip) de payments completed.
 *   - Retrocompatible: payments sin tip (tip=0) se comportan igual que antes.
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
 * @param {{ order_id, method, amount, iva_amount, reference, notes, status, processed_by, tip }} args
 */
export function processPayment(db, { order_id, method, amount, iva_amount, reference, notes, status, processed_by, tip }) {
  const canonicalMethod = PAYMENT_METHOD_MAP[method];
  const canonicalStatus = PAYMENT_STATUS_MAP[status || 'completed'];
  const amountValue = round2(Number(amount) || 0);
  const tipValue = round2(Math.max(0, Number(tip) || 0));

  if (!canonicalMethod) {
    throw new Error(`Método de pago inválido: ${method}`);
  }

  const execute = db.transaction(() => {
    const order = db.prepare('SELECT id, total, iva_amount, status FROM orders WHERE id = ?').get(order_id);
    if (!order) {
      throw new Error(`Pedido no encontrado: ${order_id}`);
    }
    if (order.status === 'cancelled') {
      throw new Error('No se puede pagar un pedido cancelado');
    }

    // C2: solo completed cuenta como cobrado. C4: total cobrado = amount + tip.
    const paid = db.prepare(`
      SELECT COALESCE(SUM(amount + tip), 0) as total_paid FROM payments
      WHERE order_id = ? AND status = 'completed'
    `).get(order_id);
    const remaining = round2((order.total || 0) - paid.total_paid);

    // C2/C4: la constraint de saldo SOLO aplica a pagos que cuentan como
    // cobrados (completed). failed/refunded se registran sin tocar el saldo:
    // un refund se puede registrar aunque el pedido ya esté paid.
    if (canonicalStatus === 'completed' && amountValue + tipValue > remaining + 0.001) {
      throw new Error(`El monto excede el saldo pendiente. Restante: Bs ${remaining.toFixed(2)}`);
    }

    const paymentId = randomUUID();
    // SSOT IVA: si el cliente no envía iva_amount, derivar del pedido
    // (orders.iva_amount) — evita pagos con IVA 0 inconsistentes.
    const ivaAmount = iva_amount ?? order.iva_amount ?? 0;
    db.prepare(`
      INSERT INTO payments (id, order_id, method, amount, iva_amount, tip, reference,
                            status, processed_by, notes, synced_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      paymentId, order_id, canonicalMethod, amountValue, ivaAmount, tipValue, reference || '',
      canonicalStatus, processed_by, notes || '', new Date().toISOString()
    );

    // El nuevo pago solo aporta al saldo si es completed
    const isCompleted = canonicalStatus === 'completed';
    const totalPaid = paid.total_paid + (isCompleted ? amountValue + tipValue : 0);
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

    return { paymentId, fullyPaid, remaining: round2(remaining - (isCompleted ? amountValue + tipValue : 0)) };
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
    console.error('[Payments] List error:', err.message);
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
    console.error('[Payments] Closings history error:', err.message);
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
    console.error('[Payments] Get error:', err.message);
    res.status(500).json({ success: false, error: 'Error al obtener pago', code: 'PAYMENT_GET_ERROR' });
  }
});

// ============================================================
// POST /api/payments — Procesar pago
// ============================================================

router.post('/', requireAuth, requireRole('admin', 'mesero', 'caja'), (req, res) => {
  try {
    const { order_id, amount, method, iva_amount, reference, notes, status, tip } = req.body;

    if (!order_id || amount === undefined || !method) {
      return res.status(400).json({
        success: false,
        error: 'Orden, monto y método son requeridos',
        code: 'PAYMENT_DATA_REQUIRED',
      });
    }

    if (!PAYMENT_METHOD_MAP[method]) {
      return res.status(400).json({
        success: false,
        error: `Método inválido. Use: ${Object.keys(PAYMENT_METHOD_MAP).join(', ')}`,
        code: 'INVALID_METHOD',
      });
    }

    // C4: la propina debe ser un número ≥ 0 (el server la registra aparte)
    if (tip !== undefined && (typeof tip !== 'number' || Number.isNaN(tip) || tip < 0)) {
      return res.status(400).json({
        success: false,
        error: 'Propina inválida (debe ser un número ≥ 0)',
        code: 'INVALID_TIP',
      });
    }

    const db = getDb();
    const result = processPayment(db, {
      order_id, amount, method, iva_amount, reference, notes, status, tip,
      processed_by: req.user.sub,
    });

    const payment = db.prepare('SELECT * FROM payments WHERE id = ?').get(result.paymentId);
    res.status(201).json({
      success: true,
      payment,
      fully_paid: result.fullyPaid,
      remaining: result.remaining,
    });
  } catch (err) {
    const known = err.message.startsWith('El monto') || err.message.startsWith('Método') ||
                   err.message.startsWith('Pedido no encontrado') || err.message.startsWith('No se puede pagar');
    if (known) {
      return res.status(409).json({ success: false, error: err.message, code: 'PAYMENT_CONFLICT' });
    }
    console.error('[Payments] Create error:', err.message);
    res.status(500).json({ success: false, error: 'Error al procesar pago', code: 'PAYMENT_CREATE_ERROR' });
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
    // C2: solo completed. C4: total cobrado = amount + tip. C5: cash = solo efectivo.
    const summary = db.prepare(`
      SELECT p.method, COUNT(*) as count, SUM(p.amount + p.tip) as total
      FROM payments p
      WHERE ${localDateExpr('p.processed_at')} = ? AND p.status = 'completed'
      GROUP BY p.method
    `).all(today);

    const totalToday = db.prepare(`
      SELECT COALESCE(SUM(amount + tip), 0) as total FROM payments
      WHERE ${localDateExpr('processed_at')} = ? AND status = 'completed'
    `).get(today);

    const cashToday = db.prepare(`
      SELECT COALESCE(SUM(amount + tip), 0) as total FROM payments
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
        orders: ordersToday,
      },
    });
  } catch (err) {
    console.error('[Payments] Closing current error:', err.message);
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
    // (QR/card/transfer son "ya depositados" — el cajero cuadra únicamente el efectivo).
    const today = localDateStr();
    const expected = db.prepare(`
      SELECT COALESCE(SUM(amount + tip), 0) as total FROM payments
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
    console.error('[Payments] Open closing error:', err.message);
    res.status(500).json({ success: false, error: 'Error al iniciar corte', code: 'CLOSING_OPEN_ERROR' });
  }
});

// ============================================================
// PUT /api/payments/closing/close — Cerrar corte activo
// ============================================================

router.put('/closing/close', requireAuth, requireRole('admin', 'caja'), (req, res) => {
  try {
    const { actual_cash, notes, is_reconciled } = req.body;

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
    console.error('[Payments] Close closing error:', err.message);
    res.status(500).json({ success: false, error: 'Error al cerrar corte', code: 'CLOSING_CLOSE_ERROR' });
  }
});

export default router;
