/**
 * ═══════════════════════════════════════════════════════════
 *  Sync Routes — Offline Synchronization
 *
 *  POST /api/sync/pull    → Descargar cambios desde servidor
 *  POST /api/sync/push    → Subir cambios offline al servidor
 *  GET  /api/sync/status  → Estado de sincronización
 * ═══════════════════════════════════════════════════════════
 */

import { Router } from 'express';
import { getDb } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

// ============================================================
// POST /api/sync/pull — Descargar datos para offline
// ============================================================

router.post('/pull', requireAuth, (req, res) => {
  try {
    const { last_sync } = req.body;
    const db = getDb();

    // Get last sync timestamp
    const since = last_sync || '1970-01-01T00:00:00.000Z';

    // Tables
    const tables = db.prepare('SELECT * FROM tables').all();

    // Menu categories (active only)
    const categories = db.prepare(
      'SELECT * FROM menu_categories WHERE active = 1 ORDER BY sort_order'
    ).all();

    // Menu items (active only)
    const items = db.prepare(`
      SELECT mi.*, mc.name as category_name
      FROM menu_items mi
      JOIN menu_categories mc ON mi.category_id = mc.id
      WHERE mi.active = 1
      ORDER BY mc.sort_order, mi.sort_order
    `).all();

    // Modifier groups for active items
    const activeItemIds = items.map(i => i.id);
    let modifierGroups = [];
    let modifierOptions = [];

    if (activeItemIds.length > 0) {
      const placeholders = activeItemIds.map(() => '?').join(',');
      modifierGroups = db.prepare(`
        SELECT * FROM modifier_groups WHERE item_id IN (${placeholders}) ORDER BY sort_order
      `).all(...activeItemIds);

      if (modifierGroups.length > 0) {
        const groupIds = modifierGroups.map(g => g.id);
        const groupPlaceholders = groupIds.map(() => '?').join(',');
        modifierOptions = db.prepare(`
          SELECT * FROM modifier_options WHERE group_id IN (${groupPlaceholders}) ORDER BY sort_order
        `).all(...groupIds);
      }
    }

    // Recent orders for this user (last 24h)
    const recentOrders = db.prepare(`
      SELECT * FROM orders
      WHERE created_by = ? AND created_at >= datetime('now', '-1 day')
      ORDER BY created_at DESC
    `).all(req.user.sub);

    // Log sync
    db.prepare('INSERT INTO sync_log (user_id, action, status) VALUES (?, ?, ?)')
      .run(req.user.sub, 'pull', 'success');

    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      data: {
        tables,
        menu: { categories, items, modifier_groups: modifierGroups, modifier_options: modifierOptions },
        recent_orders: recentOrders,
      },
      stats: {
        tables: tables.length,
        categories: categories.length,
        items: items.length,
        modifierGroups: modifierGroups.length,
        modifierOptions: modifierOptions.length,
        recentOrders: recentOrders.length,
      },
    });
  } catch (err) {
    console.error('[Sync] Pull error:', err.message);
    res.status(500).json({ success: false, error: 'Error al sincronizar', code: 'SYNC_PULL_ERROR' });
  }
});

// ============================================================
// POST /api/sync/push — Subir cambios offline
// ============================================================

router.post('/push', requireAuth, (req, res) => {
  try {
    const { orders, sync_id } = req.body;
    const db = getDb();

    if (!orders || !Array.isArray(orders)) {
      return res.status(400).json({ success: false, error: 'Órdenes requeridas', code: 'ORDERS_REQUIRED' });
    }

    const results = [];
    const errors = [];

    for (const order of orders) {
      try {
        if (order.action === 'create') {
          // Create order from offline
          const orderResult = db.prepare(`
            INSERT INTO orders (table_id, status, notes, subtotal, tax, total, payment_status, created_by)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            order.table_id,
            order.status || 'pendiente',
            order.notes || '',
            order.subtotal || 0,
            order.tax || 0,
            order.total || 0,
            'pendiente',
            req.user.sub
          );

          // Insert items
          if (order.items) {
            for (const item of order.items) {
              db.prepare(`
                INSERT INTO order_items (order_id, menu_item_id, quantity, unit_price, subtotal, notes, modifiers, kds_module)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
              `).run(
                orderResult.lastInsertRowid,
                item.menu_item_id,
                item.quantity || 1,
                item.unit_price || 0,
                item.subtotal || 0,
                item.notes || '',
                item.modifiers || null,
                item.kds_module || 'cocina'
              );
            }
          }

          results.push({
            client_id: order.client_id,
            server_id: orderResult.lastInsertRowid,
            status: 'created',
          });
        }

        if (order.action === 'update_status' && order.id) {
          db.prepare('UPDATE orders SET status = ? WHERE id = ?').run(order.status, order.id);
          results.push({ id: order.id, status: 'updated' });
        }
      } catch (itemErr) {
        errors.push({ client_id: order.client_id, error: itemErr.message });
      }
    }

    // Log sync
    db.prepare('INSERT INTO sync_log (user_id, action, status, details) VALUES (?, ?, ?, ?)')
      .run(req.user.sub, 'push', errors.length > 0 ? 'partial' : 'success', JSON.stringify({ total: orders.length, errors: errors.length }));

    res.json({
      success: true,
      sync_id: sync_id || null,
      timestamp: new Date().toISOString(),
      results,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (err) {
    console.error('[Sync] Push error:', err.message);
    res.status(500).json({ success: false, error: 'Error al subir cambios', code: 'SYNC_PUSH_ERROR' });
  }
});

// ============================================================
// GET /api/sync/status — Estado de sincronización
// ============================================================

router.get('/status', requireAuth, (req, res) => {
  try {
    const db = getDb();
    const lastSync = db.prepare(`
      SELECT created_at, action, status FROM sync_log
      WHERE user_id = ?
      ORDER BY created_at DESC LIMIT 1
    `).get(req.user.sub);

    const pendingOrders = db.prepare(`
      SELECT COUNT(*) as count FROM orders
      WHERE created_by = ? AND status IN ('pendiente', 'en_preparacion')
    `).get(req.user.sub);

    res.json({
      success: true,
      server_time: new Date().toISOString(),
      last_sync: lastSync?.created_at || null,
      last_action: lastSync?.action || null,
      last_status: lastSync?.status || null,
      pending_orders: pendingOrders?.count || 0,
    });
  } catch (err) {
    console.error('[Sync] Status error:', err.message);
    res.status(500).json({ success: false, error: 'Error al obtener estado', code: 'SYNC_STATUS_ERROR' });
  }
});

export default router;
