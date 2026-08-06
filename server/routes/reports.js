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
import { localDateStr, localDateExpr, localHourExpr } from '../utils/date-utils.js';

const router = Router();

// ============================================================
// GET /api/reports/sales/daily — Ventas del día
// ============================================================

router.get('/sales/daily', requireAuth, requireRole('admin', 'caja'), (req, res) => {
  try {
    const { date } = req.query;
    // C1: "hoy" local America/La_Paz (UTC-4); si llega fecha explícita se usa tal cual
    const targetDate = date || localDateStr();

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
      WHERE ${localDateExpr('created_at')} = ?
    `).get(targetDate);

    // By payment method (C2: solo completed; C4: total cobrado = amount + tip)
    const byMethod = db.prepare(`
      SELECT p.method, COUNT(*) as count, SUM(p.amount + p.tip) as total
      FROM payments p
      WHERE ${localDateExpr('p.processed_at')} = ? AND p.status = 'completed'
      GROUP BY p.method
    `).all(targetDate);

    // Hourly breakdown (hora local del negocio)
    const hourly = db.prepare(`
      SELECT
        CAST(${localHourExpr('created_at')} AS INTEGER) as hour,
        COUNT(*) as orders,
        SUM(total) as revenue
      FROM orders
      WHERE ${localDateExpr('created_at')} = ?
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
        ${localDateExpr('created_at')} as date,
        COUNT(*) as orders,
        SUM(total) as revenue,
        SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) as cancelled
      FROM orders
      WHERE ${localDateExpr('created_at')} >= ? AND ${localDateExpr('created_at')} <= ?
      GROUP BY ${localDateExpr('created_at')}
      ORDER BY date
    `).all(from, to);

    const totals = db.prepare(`
      SELECT
        COUNT(*) as total_orders,
        SUM(total) as total_revenue,
        AVG(total) as avg_order
      FROM orders
      WHERE ${localDateExpr('created_at')} >= ? AND ${localDateExpr('created_at')} <= ? AND status = 'paid'
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
    const { from, to, limit } = req.query;
    const db = getDb();

    let dateFilter = '';
    const params = [];

    if (from && to) {
      dateFilter = ` AND ${localDateExpr('o.created_at')} >= ? AND ${localDateExpr('o.created_at')} <= ?`;
      params.push(from, to);
    }

    params.push(parseInt(limit, 10) || 20);

    const items = db.prepare(`
      SELECT
        mi.id, mi.name as item_name, mc.name as category_name,
        COUNT(*) as times_ordered,
        SUM(oi.quantity) as total_quantity,
        SUM(oi.subtotal) as total_revenue
      FROM order_items oi
      JOIN menu_items mi ON oi.menu_item_id = mi.id
      LEFT JOIN menu_categories mc ON mi.category_id = mc.id
      JOIN orders o ON oi.order_id = o.id
      WHERE o.status = 'paid'${dateFilter}
      GROUP BY mi.id
      ORDER BY total_quantity DESC
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
      dateFilter = ` AND ${localDateExpr('o.created_at')} >= ? AND ${localDateExpr('o.created_at')} <= ?`;
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
