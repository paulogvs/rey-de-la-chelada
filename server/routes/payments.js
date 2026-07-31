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
 * ═══════════════════════════════════════════════════════════
 */

import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { getDb } from '../db/index.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

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

/** Registra un pago y devuelve { paymentId, fullyPaid, remaining } */
function processPayment(db, { order_id, method, amount, iva_amount, reference, notes, status, processed_by }) {
  const canonicalMethod = PAYMENT_METHOD_MAP[method];
  const canonicalStatus = PAYMENT_STATUS_MAP[status || 'completed'];

  if (!canonicalMethod) {
    throw new Error(`Método de pago inválido: ${method}`);
  }

  const order = db.prepare('SELECT id, total, status FROM orders WHERE id = ?').get(order_id);
  if (!order) {
    throw new Error(`Pedido no encontrado: ${order_id}`);
  }
  if (order.status === 'cancelled') {
    throw new Error('No se puede pagar un pedido cancelado');
  }

  const paid = db.prepare('SELECT COALESCE(SUM(amount), 0) as total_paid FROM payments WHERE order_id = ?').get(order_id);
  const remaining = round2((order.total || 0) - paid.total_paid);

  if (amount > remaining + 0.001) {
    throw new Error(`El monto excede el saldo pendiente. Restante: Bs ${remaining.toFixed(2)}`);
  }

  const paymentId = randomUUID();
  db.prepare(`
    INSERT INTO payments (id, order_id, method, amount, iva_amount, reference,
                          status, processed_by, notes, synced_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    paymentId, order_id, canonicalMethod, amount, iva_amount || 0, reference || '',
    canonicalStatus, processed_by, notes || '', new Date().toISOString()
  );

  const totalPaid = paid.total_paid + amount;
  const fullyPaid = round2(totalPaid) >= round2(order.total || 0);

  // Update order payment state
  db.prepare(`
    UPDATE orders SET is_paid = ?, payment_method = ?, payment_reference = ?,
                      paid_at = CASE WHEN ? THEN datetime('now') ELSE paid_at END,
                      status = CASE WHEN ? THEN 'paid' ELSE status END,
                      updated_at = datetime('now')
    WHERE id = ?
  `).run(fullyPaid ? 1 : 0, canonicalMethod, reference || '', fullyPaid ? 1 : 0, fullyPaid ? 1 : 0, order_id);

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

  return { paymentId, fullyPaid, remaining: round2(remaining - amount) };
}

function round2(n) {
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
    const { order_id, amount, method, iva_amount, reference, notes, status } = req.body;

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

    const db = getDb();
    const result = processPayment(db, {
      order_id, amount, method, iva_amount, reference, notes, status,
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

    // Today's payments summary
    const today = new Date().toISOString().split('T')[0];
    const summary = db.prepare(`
      SELECT p.method, COUNT(*) as count, SUM(p.amount) as total
      FROM payments p
      WHERE DATE(p.processed_at) = ?
      GROUP BY p.method
    `).all(today);

    const totalToday = db.prepare(`
      SELECT SUM(amount) as total FROM payments WHERE DATE(processed_at) = ?
    `).get(today);

    // Orders summary
    const ordersToday = db.prepare(`
      SELECT COUNT(*) as total,
             SUM(CASE WHEN status = 'paid' THEN 1 ELSE 0 END) as completed,
             SUM(total) as revenue
      FROM orders WHERE DATE(created_at) = ?
    `).get(today);

    res.json({
      success: true,
      closing: current || null,
      today: {
        date: today,
        payments: summary,
        total: totalToday?.total || 0,
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

    // Calculate expected amount (ventas del día)
    const today = new Date().toISOString().split('T')[0];
    const expected = db.prepare(`
      SELECT SUM(amount) as total FROM payments WHERE DATE(processed_at) = ?
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
    const difference = round2(actual_cash - open.expected_cash);

    db.prepare(`
      UPDATE cash_closings
      SET closed_at = ?, closed_by = ?, actual_cash = ?, cash_difference = ?,
          is_reconciled = ?, notes = ?
      WHERE id = ?
    `).run(closedAt, req.user.sub, actual_cash, difference, is_reconciled ? 1 : 0, notes || open.notes, open.id);

    res.json({
      success: true,
      message: 'Corte de caja cerrado',
      closing: {
        id: open.id,
        opened_at: open.opened_at,
        closed_at: closedAt,
        expected: open.expected_cash,
        actual: actual_cash,
        difference,
      },
    });
  } catch (err) {
    console.error('[Payments] Close closing error:', err.message);
    res.status(500).json({ success: false, error: 'Error al cerrar corte', code: 'CLOSING_CLOSE_ERROR' });
  }
});

export default router;
