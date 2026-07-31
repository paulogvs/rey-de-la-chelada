/**
 * ═══════════════════════════════════════════════════════════
 *  Payments Routes — Cobros, Corte de Caja
 *
 *  GET    /api/payments               → Listar pagos
 *  GET    /api/payments/:id           → Pago específico
 *  POST   /api/payments               → Procesar pago
 *  GET    /api/payments/closing/current → Corte de caja actual
 *  POST   /api/payments/closing       → Cerrar corte de caja
 * ═══════════════════════════════════════════════════════════
 */

import { Router } from 'express';
import { getDb } from '../db/index.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const router = Router();

// ============================================================
// Helpers
// ============================================================

const PAYMENT_METHODS = ['efectivo', 'qr', 'tarjeta', 'transferencia'];
const CLOSING_STATUSES = ['abierto', 'cerrado'];

// ============================================================
// GET /api/payments — Listar pagos
// ============================================================

router.get('/', requireAuth, (req, res) => {
  try {
    const db = getDb();
    const { date_from, date_to, method, order_id } = req.query;

    let sql = `
      SELECT p.id, p.order_id, o.table_id, t.number as table_number,
             p.amount, p.method, p.reference, p.notes,
             p.processed_by, s.display_name as processed_by_name,
             p.created_at
      FROM payments p
      JOIN orders o ON p.order_id = o.id
      LEFT JOIN tables t ON o.table_id = t.id
      LEFT JOIN staff s ON p.processed_by = s.id
      WHERE 1=1
    `;
    const params = [];

    if (date_from) { sql += ' AND p.created_at >= ?'; params.push(date_from); }
    if (date_to) { sql += ' AND p.created_at <= ?'; params.push(date_to); }
    if (method) { sql += ' AND p.method = ?'; params.push(method); }
    if (order_id) { sql += ' AND p.order_id = ?'; params.push(order_id); }

    sql += ' ORDER BY p.created_at DESC';

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
    const { order_id, amount, method, reference, notes } = req.body;

    if (!order_id || amount === undefined || !method) {
      return res.status(400).json({
        success: false,
        error: 'Orden, monto y método son requeridos',
        code: 'PAYMENT_DATA_REQUIRED',
      });
    }

    if (!PAYMENT_METHODS.includes(method)) {
      return res.status(400).json({
        success: false,
        error: `Método inválido. Use: ${PAYMENT_METHODS.join(', ')}`,
        code: 'INVALID_METHOD',
      });
    }

    const db = getDb();

    // Verify order exists and can be paid
    const order = db.prepare(`
      SELECT id, total, payment_status, status FROM orders WHERE id = ?
    `).get(order_id);

    if (!order) {
      return res.status(404).json({ success: false, error: 'Pedido no encontrado', code: 'ORDER_NOT_FOUND' });
    }

    if (order.status === 'cancelado') {
      return res.status(409).json({ success: false, error: 'No se puede pagar un pedido cancelado', code: 'ORDER_CANCELLED' });
    }

    // Calculate remaining amount
    const paid = db.prepare('SELECT COALESCE(SUM(amount), 0) as total_paid FROM payments WHERE order_id = ?').get(order_id);
    const remaining = order.total - paid.total_paid;

    if (amount > remaining) {
      return res.status(409).json({
        success: false,
        error: `El monto excede el saldo pendiente. Restante: Bs ${remaining.toFixed(2)}`,
        code: 'AMOUNT_EXCEEDS_BALANCE',
        remaining,
      });
    }

    // Insert payment
    const result = db.prepare(`
      INSERT INTO payments (order_id, amount, method, reference, notes, processed_by)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(order_id, amount, method, reference || '', notes || '', req.user.sub);

    // Update order payment status
    const totalPaid = paid.total_paid + amount;
    const paymentStatus = totalPaid >= order.total ? 'pagado' : 'parcial';

    db.prepare('UPDATE orders SET payment_status = ? WHERE id = ?').run(paymentStatus, order_id);

    // If fully paid, mark order as completed
    if (paymentStatus === 'pagado' && order.status !== 'completado') {
      db.prepare("UPDATE orders SET status = 'completado' WHERE id = ?").run(order_id);

      // Free table
      const tableId = db.prepare('SELECT table_id FROM orders WHERE id = ?').get(order_id).table_id;
      const activeOrders = db.prepare(
        "SELECT id FROM orders WHERE table_id = ? AND status NOT IN ('completado', 'cancelado') AND id != ?"
      ).get(tableId, order_id);
      if (!activeOrders) {
        db.prepare("UPDATE tables SET status = 'disponible' WHERE id = ?").run(tableId);
      }
    }

    res.status(201).json({
      success: true,
      payment: {
        id: result.lastInsertRowid,
        order_id,
        amount,
        method,
        reference: reference || '',
        processed_by: req.user.sub,
      },
      payment_status: paymentStatus,
      remaining: remaining - amount,
    });
  } catch (err) {
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

    // Current open closing
    const current = db.prepare(
      "SELECT * FROM cash_closings WHERE status = 'abierto' ORDER BY id DESC LIMIT 1"
    ).get();

    // Today's payments summary
    const today = new Date().toISOString().split('T')[0];
    const summary = db.prepare(`
      SELECT p.method, COUNT(*) as count, SUM(p.amount) as total
      FROM payments p
      WHERE DATE(p.created_at) = ?
      GROUP BY p.method
    `).all(today);

    const totalToday = db.prepare(`
      SELECT SUM(amount) as total FROM payments WHERE DATE(created_at) = ?
    `).get(today);

    // Orders summary
    const ordersToday = db.prepare(`
      SELECT COUNT(*) as total,
             SUM(CASE WHEN status = 'completado' THEN 1 ELSE 0 END) as completed,
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
// POST /api/payments/closing — Cerrar corte de caja
// ============================================================

router.post('/closing', requireAuth, requireRole('admin', 'caja'), (req, res) => {
  try {
    const { final_amount, notes } = req.body;

    if (final_amount === undefined) {
      return res.status(400).json({ success: false, error: 'Monto final requerido', code: 'FINAL_AMOUNT_REQUIRED' });
    }

    const db = getDb();

    // Check if there's an open closing
    const open = db.prepare("SELECT id FROM cash_closings WHERE status = 'abierto'").get();
    if (open) {
      return res.status(409).json({ success: false, error: 'Ya hay un corte de caja abierto', code: 'CLOSING_ALREADY_OPEN' });
    }

    // Calculate expected amount
    const today = new Date().toISOString().split('T')[0];
    const expected = db.prepare(`
      SELECT SUM(amount) as total FROM payments WHERE DATE(created_at) = ?
    `).get(today);

    const openedAt = new Date().toISOString();

    db.prepare(`
      INSERT INTO cash_closings (opened_at, opened_by, initial_amount, expected_amount, final_amount, notes)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(openedAt, req.user.sub, 0, expected?.total || 0, final_amount, notes || '');

    res.status(201).json({
      success: true,
      message: 'Corte de caja iniciado',
      closing: {
        opened_at: openedAt,
        expected: expected?.total || 0,
        final: final_amount,
        difference: final_amount - (expected?.total || 0),
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
    const { final_amount, notes } = req.body;

    if (final_amount === undefined) {
      return res.status(400).json({ success: false, error: 'Monto final requerido', code: 'FINAL_AMOUNT_REQUIRED' });
    }

    const db = getDb();
    const open = db.prepare("SELECT * FROM cash_closings WHERE status = 'abierto' ORDER BY id DESC LIMIT 1").get();

    if (!open) {
      return res.status(404).json({ success: false, error: 'No hay corte de caja abierto', code: 'NO_OPEN_CLOSING' });
    }

    const closedAt = new Date().toISOString();
    const difference = final_amount - open.expected_amount;

    db.prepare(`
      UPDATE cash_closings
      SET closed_at = ?, closed_by = ?, final_amount = ?, difference = ?, notes = ?, status = 'cerrado'
      WHERE id = ?
    `).run(closedAt, req.user.sub, final_amount, difference, notes || open.notes, open.id);

    res.json({
      success: true,
      message: 'Corte de caja cerrado',
      closing: {
        id: open.id,
        opened_at: open.opened_at,
        closed_at: closedAt,
        expected: open.expected_amount,
        final: final_amount,
        difference,
      },
    });
  } catch (err) {
    console.error('[Payments] Close closing error:', err.message);
    res.status(500).json({ success: false, error: 'Error al cerrar corte', code: 'CLOSING_CLOSE_ERROR' });
  }
});

export default router;
