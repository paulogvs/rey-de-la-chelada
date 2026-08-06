/**
 * ═══════════════════════════════════════════════════════════
 *  Sync Routes — Offline Synchronization
 *
 *  POST /api/sync/pull    → Descargar cambios desde servidor
 *  POST /api/sync/push    → Subir cambios offline al servidor
 *  GET  /api/sync/status  → Estado de sincronización
 *
 *  Contrato SyncEngine (src/core/engine/SyncEngine.ts):
 *    pull → { success, timestamp, data: { tables, menu: {
 *            categories, items, modifier_groups, modifier_options },
 *            recent_orders }, stats }
 *    push → { success, sync_id, results: [{client_id, server_id, status}], errors }
 *
 *  Acciones push: create_order | update_status | create_payment
 *  (valores de SyncAction en src/core/engine/SyncQueue.ts)
 *
 *  Alineado al SSOT: server/db/schema.js
 * ═══════════════════════════════════════════════════════════
 */

import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { getDb } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

// ============================================================
// Helpers — mapeo de estados al SSOT del schema
// ============================================================

// Estados de orders (schema CHECK): draft, confirmed, preparing, ready, served, paid, cancelled
const ORDER_STATUS_MAP = {
  pendiente: 'confirmed',
  en_preparacion: 'preparing',
  listo: 'ready',
  servido: 'served',
  completado: 'paid',
  cancelado: 'cancelled',
  draft: 'draft',
  confirmed: 'confirmed',
  preparing: 'preparing',
  ready: 'ready',
  served: 'served',
  paid: 'paid',
  cancelled: 'cancelled',
};

// Estados de order_items (schema CHECK): pending, preparing, ready, delivered, cancelled
const ITEM_STATUS_MAP = {
  pendiente: 'pending',
  en_preparacion: 'preparing',
  listo: 'ready',
  servido: 'delivered',
  cancelado: 'cancelled',
  pending: 'pending',
  preparing: 'preparing',
  ready: 'ready',
  delivered: 'delivered',
  cancelled: 'cancelled',
};

// Métodos de payments (schema CHECK): cash, qr_yape, qr_simple, card, transfer
const PAYMENT_METHOD_MAP = {
  efectivo: 'cash',
  cash: 'cash',
  qr: 'qr_yape',
  qr_yape: 'qr_yape',
  qr_simple: 'qr_simple',
  tarjeta: 'card',
  card: 'card',
  transferencia: 'transfer',
  transfer: 'transfer',
};

/** Log de sync compatible con CHECK constraints de sync_log */
function logSync(db, userId, operation, status, extra = {}) {
  db.prepare(`
    INSERT INTO sync_log (id, entity_type, entity_id, action, payload_json, status)
    VALUES (?, 'sync', ?, 'updated', ?, ?)
  `).run(
    randomUUID(),
    userId,
    JSON.stringify({ operation, ...extra }),
    status
  );
}

// ============================================================
// POST /api/sync/pull — Descargar datos para offline
// ============================================================

router.post('/pull', requireAuth, (req, res) => {
  try {
    const db = getDb();

    // Tables (todas — estado actual)
    const tables = db.prepare('SELECT * FROM tables ORDER BY number ASC').all();

    // Menu categories (active only)
    const categories = db.prepare(
      'SELECT * FROM menu_categories WHERE is_active = 1 ORDER BY sort_order ASC'
    ).all();

    // Menu items (active only)
    const items = db.prepare(`
      SELECT mi.*, mc.name as category_name
      FROM menu_items mi
      JOIN menu_categories mc ON mi.category_id = mc.id
      WHERE mi.is_active = 1
      ORDER BY mc.sort_order, mi.sort_order
    `).all();

    // Modifier groups for active items
    const activeItemIds = items.map(i => i.id);
    let modifierGroups = [];
    let modifierOptions = [];

    if (activeItemIds.length > 0) {
      const placeholders = activeItemIds.map(() => '?').join(',');
      modifierGroups = db.prepare(`
        SELECT * FROM modifier_groups WHERE menu_item_id IN (${placeholders}) ORDER BY sort_order
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
      WHERE waiter_id = ? AND created_at >= datetime('now', '-1 day')
      ORDER BY created_at DESC
      LIMIT 100
    `).all(req.user.sub);

    // Log sync
    logSync(db, req.user.sub, 'pull', 'synced', {
      tables: tables.length,
      categories: categories.length,
      items: items.length,
      modifierGroups: modifierGroups.length,
      modifierOptions: modifierOptions.length,
      recentOrders: recentOrders.length,
    });

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
//
// Acciones (SyncAction): create_order | update_status | create_payment
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
        const action = order.action === 'create' ? 'create_order' : order.action;

        if (action === 'create_order') {
          // ── Crear pedido offline → servidor ──────────────────
          // Usamos el id del cliente (UUID) como PK para que
          // create_payment/update_status posteriores sean deterministas.
          const orderId = order.id || randomUUID();
          const waiterId = order.waiter_id || req.user.sub;
          const waiterName = order.waiter_name || req.user.displayName || req.user.username;

          db.prepare(`
            INSERT INTO orders (id, table_id, table_number, waiter_id, waiter_name, status,
                                subtotal, iva_amount, discount, discount_reason, total,
                                notes, guest_count, local_id, synced_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            orderId,
            order.table_id,
            order.table_number ?? 0,
            waiterId,
            waiterName,
            ORDER_STATUS_MAP[order.status] || 'confirmed',
            order.subtotal || 0,
            order.iva_amount || 0,
            order.discount || 0,
            order.discount_reason || '',
            order.total || 0,
            order.notes || '',
            order.guest_count || 1,
            order.local_id || orderId,
            new Date().toISOString()
          );

          // Insert items
          if (Array.isArray(order.items)) {
            const insertItem = db.prepare(`
              INSERT INTO order_items (id, order_id, menu_item_id, menu_item_name, quantity,
                                       unit_price, modifiers_json, subtotal, status, preparation_notes)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);
            for (const item of order.items) {
              insertItem.run(
                item.id || randomUUID(),
                orderId,
                item.menu_item_id,
                item.menu_item_name || '',
                item.quantity || 1,
                item.unit_price || 0,
                typeof item.modifiers === 'string' ? item.modifiers : JSON.stringify(item.modifiers || []),
                item.subtotal || 0,
                ITEM_STATUS_MAP[item.status] || 'pending',
                item.preparation_notes || item.notes || ''
              );
            }
          }

          // Marcar mesa como ocupada
          if (order.table_id) {
            db.prepare("UPDATE tables SET status = 'occupied', current_order_id = ? WHERE id = ?")
              .run(orderId, order.table_id);
          }

          results.push({ client_id: order.client_id || orderId, server_id: orderId, status: 'created' });
        }

        if (action === 'update_status' && order.id) {
          // ── Actualizar estado de un pedido ────────────────────
          const status = ORDER_STATUS_MAP[order.status];
          if (!status) {
            throw new Error(`Estado inválido: ${order.status}`);
          }

          const existing = db.prepare('SELECT id, status, table_id FROM orders WHERE id = ?').get(order.id);
          if (!existing) {
            throw new Error(`Pedido no encontrado: ${order.id}`);
          }

          // C3: INVARIANTE — 'paid' offline solo es válido si el pago completo
          // ya se registró (create_payment debe ir ANTES en el mismo push, o en
          // un push previo). Sin pago → error, sin marcar is_paid.
          if (status === 'paid') {
            const paidCheck = db.prepare(`
              SELECT COALESCE(SUM(amount + tip), 0) as total FROM payments
              WHERE order_id = ? AND status = 'completed'
            `).get(order.id);
            const ord = db.prepare('SELECT total FROM orders WHERE id = ?').get(order.id);
            if ((paidCheck?.total || 0) + 0.001 < (ord?.total || 0)) {
              throw new Error(`No se puede marcar pagado sin pago completo: ${order.id}`);
            }
          }

          db.prepare(`
            UPDATE orders SET status = ?, synced_at = ?, updated_at = datetime('now') WHERE id = ?
          `).run(status, new Date().toISOString(), order.id);

          // Si el pedido se pagó/canceló, liberar la mesa si no hay más pedidos activos
          if (status === 'paid' || status === 'cancelled') {
            if (status === 'paid') {
              db.prepare(`
                UPDATE orders SET is_paid = 1, paid_at = COALESCE(paid_at, datetime('now')) WHERE id = ?
              `).run(order.id);
            }
            const activeOrders = db.prepare(
              "SELECT id FROM orders WHERE table_id = ? AND status NOT IN ('paid','cancelled') AND id != ?"
            ).get(existing.table_id, order.id);
            if (!activeOrders) {
              db.prepare("UPDATE tables SET status = 'free', current_order_id = NULL WHERE id = ?")
                .run(existing.table_id);
            }
          }

          results.push({ client_id: order.client_id || order.id, server_id: order.id, status: 'updated' });
        }

        if (action === 'create_payment') {
          // ── Registrar pago offline → servidor ─────────────────
          const method = PAYMENT_METHOD_MAP[order.method];
          if (!method) {
            throw new Error(`Método de pago inválido: ${order.method}`);
          }
          const orderId = order.order_id;
          if (!orderId) {
            throw new Error('order_id requerido para create_payment');
          }

          const paymentId = order.id || randomUUID();
          // C4: tip viaja con el payment (total cobrado = amount + tip).
          const tipValue = Math.max(0, Number(order.tip) || 0);
          db.prepare(`
            INSERT INTO payments (id, order_id, method, amount, iva_amount, tip, reference,
                                  status, processed_by, notes, synced_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'completed', ?, ?, ?)
          `).run(
            paymentId,
            orderId,
            method,
            order.amount || 0,
            order.iva_amount || 0,
            tipValue,
            order.reference || '',
            order.processed_by || req.user.sub,
            order.notes || '',
            new Date().toISOString()
          );

          // Actualizar estado de pago del pedido
          // C2: solo completed cuenta; C4: suma con tip.
          const ord = db.prepare('SELECT total FROM orders WHERE id = ?').get(orderId);
          const totalPaid = db.prepare(`
            SELECT COALESCE(SUM(amount + tip), 0) as paid FROM payments
            WHERE order_id = ? AND status = 'completed'
          `).get(orderId).paid;
          if (ord && totalPaid >= ord.total) {
            db.prepare(`
              UPDATE orders SET is_paid = 1, paid_at = datetime('now'),
                                payment_method = ?, payment_reference = ?,
                                status = 'paid', synced_at = ?
              WHERE id = ?
            `).run(method, order.reference || '', new Date().toISOString(), orderId);
          }

          results.push({ client_id: order.client_id || paymentId, server_id: paymentId, status: 'created' });
        }
      } catch (itemErr) {
        errors.push({ client_id: order.client_id, error: itemErr.message });
      }
    }

    // Log sync
    logSync(db, req.user.sub, 'push', errors.length > 0 ? 'failed' : 'synced', {
      total: orders.length,
      results: results.length,
      errors: errors.length,
    });

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
      SELECT created_at, payload_json, status FROM sync_log
      WHERE entity_type = 'sync' AND entity_id = ?
      ORDER BY created_at DESC LIMIT 1
    `).get(req.user.sub);

    const pendingOrders = db.prepare(`
      SELECT COUNT(*) as count FROM orders
      WHERE waiter_id = ? AND status IN ('confirmed', 'preparing')
    `).get(req.user.sub);

    res.json({
      success: true,
      server_time: new Date().toISOString(),
      last_sync: lastSync?.created_at || null,
      last_status: lastSync?.status || null,
      last_payload: lastSync?.payload_json || null,
      pending_orders: pendingOrders?.count || 0,
    });
  } catch (err) {
    console.error('[Sync] Status error:', err.message);
    res.status(500).json({ success: false, error: 'Error al obtener estado', code: 'SYNC_STATUS_ERROR' });
  }
});

export default router;
