/**
 * ═══════════════════════════════════════════════════════════
 *  Reports Routes — Reportes y Analytics
 *
 *  GET /api/reports/sales/daily      → Ventas del día
 *  GET /api/reports/sales/range      → Ventas por rango
 *  GET /api/reports/items/popular    → Items más vendidos
 *  GET /api/reports/staff/performance → Rendimiento del personal
 *
 *  Alineado al SSOT: server/db/schema.js
 *  (orders.status: paid/cancelled; pedido tomado por waiter_id)
 * ═══════════════════════════════════════════════════════════
 */

import { Router } from 'express';
import { getDb } from '../db/index.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { businessDayDateStr, businessDayExpr, localHourExpr } from '../utils/date-utils.js';

const router = Router();

// ============================================================
// GET /api/reports/sales/daily — Ventas del día
// ============================================================

router.get('/sales/daily', requireAuth, requireRole('admin', 'caja'), (req, res) => {
  try {
    const { date } = req.query;
    // Opción B (2026-08-19): "hoy" = DÍA LABORAL (turno 15:00 → 06:00 del
    // día siguiente); si llega fecha explícita (día laboral YYYY-MM-DD) se usa tal cual.
    const targetDate = date || businessDayDateStr();

    const db = getDb();

    // Summary
    const summary = db.prepare(`
      SELECT
        COUNT(*) as total_orders,
        SUM(CASE WHEN status = 'paid' THEN 1 ELSE 0 END) as completed_orders,
        SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) as cancelled_orders,
        SUM(total) as gross_revenue,
        SUM(CASE WHEN status = 'paid' THEN total ELSE 0 END) as net_revenue
      FROM orders
      WHERE ${businessDayExpr('created_at')} = ?
    `).get(targetDate);

    // By payment method (C2: solo completed; FASE 3: sin propina → SUM(amount))
    const byMethod = db.prepare(`
      SELECT p.method, COUNT(*) as count, SUM(p.amount) as total
      FROM payments p
      WHERE ${businessDayExpr('p.processed_at')} = ? AND p.status = 'completed'
      GROUP BY p.method
    `).all(targetDate);

    // Hourly breakdown (hora local del negocio — el GROUP BY por hora local
    // sigue siendo correcto dentro del día laboral)
    const hourly = db.prepare(`
      SELECT
        CAST(${localHourExpr('created_at')} AS INTEGER) as hour,
        COUNT(*) as orders,
        SUM(total) as revenue
      FROM orders
      WHERE ${businessDayExpr('created_at')} = ?
      GROUP BY hour
      ORDER BY hour
    `).all(targetDate);

    res.json({
      success: true,
      date: targetDate,
      summary: {
        total_orders: summary?.total_orders || 0,
        completed_orders: summary?.completed_orders || 0,
        cancelled_orders: summary?.cancelled_orders || 0,
        gross_revenue: summary?.gross_revenue || 0,
        net_revenue: summary?.net_revenue || 0,
      },
      by_payment_method: byMethod,
      hourly,
    });
  } catch (err) {
    console.error('[Reports] Daily error:', err.message);
    res.status(500).json({ success: false, error: 'Error al generar reporte diario', code: 'DAILY_REPORT_ERROR' });
  }
});

// ============================================================
// GET /api/reports/orders — Historial operativo pedido por pedido
// ============================================================

router.get('/orders', requireAuth, requireRole('admin', 'caja'), (req, res) => {
  try {
    const db = getDb();
    const businessDay = req.query.business_day || businessDayDateStr();
    const status = req.query.status || 'paid';
    const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 50, 1), 200);

    let sql = `
      SELECT o.id, o.table_id, t.number as table_number, o.status, o.total,
             o.created_at, o.paid_at, o.payment_method, o.waiter_id,
             s.display_name as waiter_name,
             COALESCE((SELECT SUM(p.amount) FROM payments p
               WHERE p.order_id = o.id AND p.status = 'completed'), 0) as paid_amount
      FROM orders o
      LEFT JOIN tables t ON o.table_id = t.id
      LEFT JOIN staff s ON o.waiter_id = s.id
      WHERE ${businessDayExpr('o.created_at')} = ?
    `;
    const params = [businessDay];
    if (status !== 'all') {
      sql += ' AND o.status = ?';
      params.push(status);
    }
    sql += ' ORDER BY o.created_at DESC LIMIT ?';
    params.push(limit);

    const orders = db.prepare(sql).all(...params);
    for (const order of orders) {
      order.items = db.prepare(`
        SELECT oi.id, oi.menu_item_name, oi.quantity, oi.unit_price, oi.subtotal,
               oi.preparation_notes as notes, oi.round, oi.promo_label, mi.area as kds_module
        FROM order_items oi
        LEFT JOIN menu_items mi ON oi.menu_item_id = mi.id
        WHERE oi.order_id = ?
        ORDER BY oi.round ASC, oi.created_at ASC
      `).all(order.id);
      order.payments = db.prepare(`
        SELECT p.id, p.method, p.amount, p.received, p.change, p.reference, p.status, p.processed_at,
               p.processed_by,
               s2.display_name as processor,   -- FIX 2026-08-27: 'processor' no existe en payments; la columna real es processed_by (FK staff). Se JOINTA a staff para exponer el nombre como 'processor' (mismo shape de salida).
               p.proof_photo
        FROM payments p
        LEFT JOIN staff s2 ON p.processed_by = s2.id
        WHERE p.order_id = ?
        ORDER BY p.processed_at ASC
      `).all(order.id);
      order.payment_summary = db.prepare(`
        SELECT method, SUM(amount) as total, COUNT(*) as count
        FROM payments
        WHERE order_id = ? AND status = 'completed'
        GROUP BY method
      `).all(order.id);
    }

    res.json({ success: true, business_day: businessDay, orders, count: orders.length });
  } catch (err) {
    console.error('[Reports] Orders history error:', err.message);
    res.status(500).json({ success: false, error: 'Error al obtener historial de pedidos', code: 'ORDERS_HISTORY_ERROR' });
  }
});

// ============================================================
// GET /api/reports/sales/range — Ventas por rango
// ============================================================

router.get('/sales/range', requireAuth, requireRole('admin', 'caja'), (req, res) => {
  try {
    const { from, to } = req.query;
    if (!from || !to) {
      return res.status(400).json({ success: false, error: 'from y to son requeridos (YYYY-MM-DD)', code: 'DATE_RANGE_REQUIRED' });
    }

    const db = getDb();

    const daily = db.prepare(`
      SELECT
        ${businessDayExpr('created_at')} as date,
        COUNT(*) as orders,
        SUM(total) as revenue,
        SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) as cancelled
      FROM orders
      WHERE ${businessDayExpr('created_at')} >= ? AND ${businessDayExpr('created_at')} <= ?
      GROUP BY ${businessDayExpr('created_at')}
      ORDER BY date
    `).all(from, to);

    const totals = db.prepare(`
      SELECT
        COUNT(*) as total_orders,
        SUM(total) as total_revenue,
        AVG(total) as avg_order
      FROM orders
      WHERE ${businessDayExpr('created_at')} >= ? AND ${businessDayExpr('created_at')} <= ? AND status = 'paid'
    `).get(from, to);

    res.json({
      success: true,
      from,
      to,
      daily,
      totals: {
        total_orders: totals?.total_orders || 0,
        total_revenue: totals?.total_revenue || 0,
        avg_order: totals?.avg_order || 0,
      },
    });
  } catch (err) {
    console.error('[Reports] Range error:', err.message);
    res.status(500).json({ success: false, error: 'Error al generar reporte por rango', code: 'RANGE_REPORT_ERROR' });
  }
});

// ============================================================
// GET /api/reports/items/popular — Items más vendidos
// ============================================================

router.get('/items/popular', requireAuth, requireRole('admin', 'caja'), (req, res) => {
  try {
    const { from, to, limit, order_by, group_by } = req.query;
    const db = getDb();

    let dateFilter = '';
    const params = [];

    if (from && to) {
      dateFilter = ` AND ${businessDayExpr('o.created_at')} >= ? AND ${businessDayExpr('o.created_at')} <= ?`;
      params.push(from, to);
    }

    params.push(parseInt(limit, 10) || 20);

    // v14 (2026-08-29): order_by=quantity|revenue (default quantity);
    // group_by=category agrupa por categoría en vez de por item.
    const orderBy = order_by === 'revenue' ? 'total_revenue' : 'total_quantity';
    const groupCol = group_by === 'category' ? 'mc.id' : 'mi.id';

    const items = db.prepare(`
      SELECT
        ${group_by === 'category' ? 'mc.id AS cat_id, mc.name AS category_name' : 'mi.id, mi.name as item_name, mc.name as category_name'},
        COUNT(*) as times_ordered,
        SUM(oi.quantity) as total_quantity,
        SUM(oi.subtotal) as total_revenue
      FROM order_items oi
      JOIN menu_items mi ON oi.menu_item_id = mi.id
      LEFT JOIN menu_categories mc ON mi.category_id = mc.id
      JOIN orders o ON oi.order_id = o.id
      WHERE o.status = 'paid'${dateFilter}
      GROUP BY ${groupCol}
      ORDER BY ${orderBy} DESC
      LIMIT ?
    `).all(...params);

    res.json({ success: true, items });
  } catch (err) {
    console.error('[Reports] Popular error:', err.message);
    res.status(500).json({ success: false, error: 'Error al obtener items populares', code: 'POPULAR_ITEMS_ERROR' });
  }
});

// ============================================================
// GET /api/reports/staff/performance
// ============================================================

router.get('/staff/performance', requireAuth, requireRole('admin'), (req, res) => {
  try {
    const { from, to } = req.query;
    const db = getDb();

    let dateFilter = '';
    const params = [];
    if (from && to) {
      dateFilter = ` AND ${businessDayExpr('o.created_at')} >= ? AND ${businessDayExpr('o.created_at')} <= ?`;
      params.push(from, to);
    }

    const performance = db.prepare(`
      SELECT
        s.id, s.display_name, s.role,
        COUNT(o.id) as orders_taken,
        SUM(CASE WHEN o.status = 'paid' THEN 1 ELSE 0 END) as orders_completed,
        SUM(CASE WHEN o.status = 'cancelled' THEN 1 ELSE 0 END) as orders_cancelled,
        SUM(o.total) as total_revenue
      FROM staff s
      LEFT JOIN orders o ON s.id = o.waiter_id${dateFilter}
      WHERE s.is_active = 1
      GROUP BY s.id
      ORDER BY orders_completed DESC
    `).all(...params);

    res.json({ success: true, performance });
  } catch (err) {
    console.error('[Reports] Staff error:', err.message);
    res.status(500).json({ success: false, error: 'Error al obtener rendimiento', code: 'STAFF_PERFORMANCE_ERROR' });
  }
});

export default router;
