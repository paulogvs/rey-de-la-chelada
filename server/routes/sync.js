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
import { computeTotals, round2 } from '../../src/core/config/iva.js';
import { resolveModifierAdjustment, resolveItemUnitPrice, resolvePromoUnitPrice, validatePromoContext } from '../services/order-pricing.js';
import { businessDayDateStr } from '../utils/date-utils.js';
import { recordPayment } from '../services/financial/payment-service.js';

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

// Métodos de payments (schema CHECK v6): SOLO cash | qr
const PAYMENT_METHOD_MAP = {
  efectivo: 'cash',
  cash: 'cash',
  qr: 'qr',
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

          // ── 2.3 IDEMPOTENCIA: si el pedido ya existe (mismo id UUID) no
          // lo duplicamos — lo marcamos 'skipped' sin error. La semántica
          // elegida es dedupe por entity id (orders.id/payments.id son
          // UUID del cliente = deterministas).
          const existingOrder = db.prepare('SELECT id FROM orders WHERE id = ?').get(orderId);
          if (existingOrder) {
            results.push({
              client_id: order.client_id || orderId,
              server_id: orderId,
              status: 'skipped',
              reason: 'duplicate_order_id_already_exists',
            });
            continue;
          }

          // P1-1 (2026-08-11): contrato SSOT "1 pedido activo por mesa".
          // El sync offline NO debe crear un 2º pedido en una mesa que ya
          // tiene uno activo (llamado/confirmado/en preparación/...).
          if (order.table_id) {
            const tableActive = db.prepare(
              "SELECT id FROM orders WHERE table_id = ? AND status NOT IN ('paid','cancelled')"
            ).get(order.table_id);
            if (tableActive) {
              throw new Error(`La mesa ya tiene un pedido activo: ${tableActive.id}`);
            }
          }

          const waiterId = order.waiter_id || req.user.sub;
          const waiterName = order.waiter_name || req.user.displayName || req.user.username;

          // ── 2.2 PRECIOS SERVER-SIDE (SSOT): ignoramos subtotal/iva/total/
          // unit_price del cliente — recalculamos con resolveItemUnitPrice
          // (base + modificadores por NOMBRE + manual "Consultar precio" +
          // promo manual), igual que POST /api/orders (Sprint 1 B/E).
          let grossSubtotal = 0;
          const orderItems = [];
          const findMenuItem = db.prepare(
            'SELECT id, name, price, price_variable, promo_price, area, category_id FROM menu_items WHERE id = ? AND is_active = 1'
          );
          const rawItems = Array.isArray(order.items) ? order.items : [];
          for (const item of rawItems) {
            const menuItem = findMenuItem.get(item.menu_item_id);
            if (!menuItem) {
              throw new Error(`Item inválido: ${item.menu_item_id}`);
            }
            const quantity = Number(item.quantity);
            if (!Number.isFinite(quantity) || quantity < 1) {
              throw new Error(`Cantidad inválida: ${item.quantity}`);
            }
            const pricing = item.promo_type
              ? resolvePromoUnitPrice(db, menuItem, item.promo_type, { businessDay: businessDayDateStr() })
              : resolveItemUnitPrice(db, menuItem, {
                  manualPrice: item.manual_price,
                  applyPromo: item.apply_promo === true,
                  modifiers: item.modifiers,
                });
            if (pricing.error) {
              const err = new Error(`${pricing.error.message} (${menuItem.name})`);
              err.code = pricing.error.code;
              throw err;
            }
            const { summary } = resolveModifierAdjustment(db, menuItem.id, item.modifiers);
            const unitPrice = pricing.unitPrice;
            const itemSubtotal = round2(unitPrice * quantity);
            grossSubtotal += itemSubtotal;
            orderItems.push({
              id: item.id || randomUUID(),
              menu_item_id: menuItem.id,
              menu_item_name: menuItem.name,
              quantity,
              unit_price: unitPrice,
              modifiers_json: summary.length > 0 ? JSON.stringify(summary) : null,
              subtotal: itemSubtotal,
              status: ITEM_STATUS_MAP[item.status] || 'pending',
              preparation_notes: item.preparation_notes || item.notes || '',
              promo_label: pricing.promoLabel,
              promo_type: item.promo_type || null,
              promo_category: pricing.promoCategory || null,
              menu_item_category_id: menuItem.category_id || null,
            });
          }

          // v15 (2026-08-29): validar CONTEXTO de promos sobre el pedido offline
          // (mismo patrón que POST /api/orders): max_per_order y líneas del pack
          // presentes. Si una promo DB ya no está activa o el pack está incompleto,
          // el item falla → SYNC_PARTIAL_ERRORS (no rompe el resto del push).
          const promoTypes = [...new Set(orderItems.map(oi => oi.promo_type).filter(Boolean))];
          for (const promoType of promoTypes) {
            const ctx = validatePromoContext(
              orderItems.map(oi => ({
                categoryName: oi.promo_category,
                promoType: oi.promo_type,
                quantity: oi.quantity,
                itemId: oi.menu_item_id,
                categoryId: oi.menu_item_category_id,
              })),
              promoType,
              businessDayDateStr()
            );
            if (!ctx.valid) {
              throw new Error(`${ctx.message} (promo: ${promoType})`);
            }
          }

          // Modelo SSOT EXTRACTIVO (iva.js): total = gross (suma de precios
          // que ya incluyen IVA); subtotal(base) = total/1.13; iva = total - subtotal.
          const { subtotal, iva, total } = computeTotals(grossSubtotal);

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
            subtotal,
            iva,
            order.discount || 0,
            order.discount_reason || '',
            total,
            order.notes || '',
            order.guest_count || 1,
            order.local_id || orderId,
            new Date().toISOString()
          );

          // Insert items (precios recalculados — los del cliente se ignoran)
          if (orderItems.length > 0) {
            const insertItem = db.prepare(`
              INSERT INTO order_items (id, order_id, menu_item_id, menu_item_name, quantity,
                                       unit_price, modifiers_json, subtotal, status, preparation_notes, promo_label, promo_type)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);
            for (const oi of orderItems) {
              insertItem.run(
                oi.id, orderId, oi.menu_item_id, oi.menu_item_name, oi.quantity,
                oi.unit_price, oi.modifiers_json, oi.subtotal, oi.status, oi.preparation_notes,
                oi.promo_label, oi.promo_type
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
              SELECT COALESCE(SUM(amount), 0) as total FROM payments
              WHERE order_id = ? AND status = 'completed'
            `).get(order.id);
            const ord = db.prepare('SELECT total FROM orders WHERE id = ?').get(order.id);
            if ((paidCheck?.total || 0) < (ord?.total || 0)) { // v11: centavos exactos
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

          // ── 2.3 IDEMPOTENCIA: mismo id de pago → skipped (no duplicar)
          const existingPayment = db.prepare('SELECT id FROM payments WHERE id = ?').get(paymentId);
          if (existingPayment) {
            results.push({
              client_id: order.client_id || paymentId,
              server_id: paymentId,
              status: 'skipped',
              reason: 'duplicate_payment_id_already_exists',
            });
            continue;
          }

          recordPayment(db, {
            paymentId,
            orderId,
            method,
            amount: order.amount,
            ivaAmount: order.iva_amount,
            received: order.received,
            reference: order.reference,
            notes: order.notes,
            processedBy: order.processed_by || req.user.sub,
            idempotencyKey: `sync:${paymentId}`,
          });

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

    // ── 2.3 ERRORES HONESTOS: si algo falló, success:false + code
    // SYNC_PARTIAL_ERRORS + errors[] — el cliente NO borra los items
    // fallidos de su cola (SyncEngine lanza cuando success === false).
    // Status HTTP 200 (documentado): el payload lleva la verdad, no el
    // código HTTP; así el cliente puede diferenciar items buenos (results)
    // de malos (errors) en el MISMO batch.
    const hasErrors = errors.length > 0;

    res.json({
      success: !hasErrors,
      sync_id: sync_id || null,
      timestamp: new Date().toISOString(),
      ...(hasErrors ? { code: 'SYNC_PARTIAL_ERRORS' } : {}),
      results,
      errors: hasErrors ? errors : undefined,
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
