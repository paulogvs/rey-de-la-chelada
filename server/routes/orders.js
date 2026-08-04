/**
 * ═══════════════════════════════════════════════════════════
 *  Orders Routes — Pedidos + KDS Integration
 *
 *  GET    /api/orders               → Listar pedidos (filtrable)
 *  GET    /api/orders/:id           → Pedido específico
 *  POST   /api/orders               → Crear pedido
 *  PUT    /api/orders/:id           → Actualizar pedido
 *  PATCH  /api/orders/:id/status    → Cambiar estado
 *  POST   /api/orders/:id/items     → Agregar item a pedido
 *  DELETE /api/orders/:id/items/:itemId → Quitar item
 *  GET    /api/orders/kds/:module   → KDS view (cocina/bar)
 *
 *  Alineado al SSOT: server/db/schema.js
 *  orders.status:  draft, confirmed, preparing, ready, served, paid, cancelled
 *  order_items.status: pending, preparing, ready, delivered, cancelled
 *  IVA: orders.iva_amount (13% sobre subtotal)
 *  KDS: el módulo (cocina/bar) sale de menu_items.area
 * ═══════════════════════════════════════════════════════════
 */

import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { getDb } from '../db/index.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { broadcastOrderConfirmed, broadcastOrderStatusChange } from '../services/order-broadcaster.js';
import { computeTotals, round2 } from '../../src/core/config/iva.js';

const router = Router();

// ============================================================
// Helpers
// ============================================================

// Mapeo de estados al schema (se acepta español o canónico)
const ORDER_STATUS_MAP = {
  pendiente: 'confirmed', en_preparacion: 'preparing', listo: 'ready',
  servido: 'served', completado: 'paid', cancelado: 'cancelled',
  draft: 'draft', called: 'called', confirmed: 'confirmed', preparing: 'preparing',
  ready: 'ready', served: 'served', paid: 'paid', cancelled: 'cancelled',
};

const ITEM_STATUS_MAP = {
  pendiente: 'pending', en_preparacion: 'preparing', listo: 'ready',
  servido: 'delivered', cancelado: 'cancelled',
  pending: 'pending', preparing: 'preparing', ready: 'ready',
  delivered: 'delivered', cancelled: 'cancelled',
};

const KDS_MODULES = { cocina: 'cocina', bar: 'bar', kds: 'all' };

/**
 * Recalcula subtotal/iva/total de un pedido.
 *
 * MODELO SSOT (iva.js — precio INCLUYE IVA): el `grossTotal` es la suma de
 * precios de línea (que ya incluyen IVA). Entonces:
 *   - total   = grossTotal (lo que paga el cliente)
 *   - subtotal = total / 1.13 (base, sin IVA)
 *   - iva     = total - subtotal
 */

/**
 * Resolve modifier adjustments for an order item from the DB.
 *
 * The mesero/clientes PWAs send modifiers as optionName (+priceAdjustment).
 * To keep server totals authoritative (SSOT), we look the options up by
 * name within the item's modifier groups and re-derive the adjustment.
 *
 * @param {object} db — better-sqlite3 instance
 * @param {string} menuItemId
 * @param {Array} modifiers — [{ groupName?, optionName, priceAdjustment? }]
 * @returns {{ adjustment: number, summary: Array }}
 */
function resolveModifierAdjustment(db, menuItemId, modifiers) {
  const raw = Array.isArray(modifiers) ? modifiers : [];
  if (raw.length === 0) return { adjustment: 0, summary: [] };

  const groups = db.prepare(
    'SELECT id FROM modifier_groups WHERE menu_item_id = ?'
  ).all(menuItemId);
  if (groups.length === 0) return { adjustment: 0, summary: [] };

  const placeholders = groups.map(() => '?').join(',');
  const options = db.prepare(
    `SELECT id, name, price_adjustment FROM modifier_options
     WHERE group_id IN (${placeholders})`
  ).all(...groups.map(g => g.id));

  let adjustment = 0;
  const summary = [];
  for (const m of raw) {
    const opt = options.find(o => o.name === m.optionName);
    if (!opt) continue;
    const adj = Number(opt.price_adjustment || 0);
    adjustment += adj;
    summary.push({ groupName: m.groupName || '', optionName: opt.name, priceAdjustment: adj });
  }
  return { adjustment: Math.round(adjustment * 100) / 100, summary };
}

/** Recalcula subtotal/iva/total de un pedido */
function recalcOrder(db, orderId) {
  const sum = db.prepare('SELECT COALESCE(SUM(subtotal), 0) as subtotal FROM order_items WHERE order_id = ?').get(orderId);
  const grossTotal = round2(sum.subtotal || 0);
  const { subtotal, iva, total } = computeTotals(grossTotal);
  db.prepare('UPDATE orders SET subtotal = ?, iva_amount = ?, total = ? WHERE id = ?')
    .run(subtotal, iva, total, orderId);
  return { subtotal, iva, total };
}

/** Helper para armar la respuesta de un pedido con items */
function buildOrder(db, orderId) {
  const order = db.prepare(`
    SELECT o.*, t.number as table_number, s.display_name as waiter_name_resolved
    FROM orders o
    LEFT JOIN tables t ON o.table_id = t.id
    LEFT JOIN staff s ON o.waiter_id = s.id
    WHERE o.id = ?
  `).get(orderId);

  if (!order) return null;

  order.items = db.prepare(`
    SELECT oi.*, mi.name as item_name, mi.area as kds_module
    FROM order_items oi
    LEFT JOIN menu_items mi ON oi.menu_item_id = mi.id
    WHERE oi.order_id = ?
    ORDER BY oi.created_at ASC
  `).all(orderId);

  order.payments = db.prepare('SELECT * FROM payments WHERE order_id = ?').all(orderId);
  return order;
}

// ============================================================
// GET /api/orders — Listar pedidos
// ============================================================

router.get('/', requireAuth, (req, res) => {
  try {
    const db = getDb();
    const { status, table_id, date_from, date_to, limit } = req.query;

    let sql = `
      SELECT o.*, t.number as table_number, s.display_name as waiter_name_resolved
      FROM orders o
      LEFT JOIN tables t ON o.table_id = t.id
      LEFT JOIN staff s ON o.waiter_id = s.id
      WHERE 1=1
    `;
    const params = [];

    if (status) {
      const statuses = status.split(',').map(s => ORDER_STATUS_MAP[s.trim()] || s.trim());
      sql += ` AND o.status IN (${statuses.map(() => '?').join(',')})`;
      params.push(...statuses);
    }

    if (table_id) { sql += ' AND o.table_id = ?'; params.push(table_id); }
    if (date_from) { sql += ' AND o.created_at >= ?'; params.push(date_from); }
    if (date_to) { sql += ' AND o.created_at <= ?'; params.push(date_to); }

    sql += ' ORDER BY o.created_at DESC';

    if (limit) {
      sql += ' LIMIT ?';
      params.push(parseInt(limit, 10));
    }

    const orders = db.prepare(sql).all(...params);

    // Attach items to each order
    for (const order of orders) {
      order.items = db.prepare(`
        SELECT oi.*, mi.name as item_name, mi.area as kds_module
        FROM order_items oi
        LEFT JOIN menu_items mi ON oi.menu_item_id = mi.id
        WHERE oi.order_id = ?
        ORDER BY oi.created_at ASC
      `).all(order.id);
    }

    res.json({ success: true, orders, count: orders.length });
  } catch (err) {
    console.error('[Orders] List error:', err.message);
    res.status(500).json({ success: false, error: 'Error al listar pedidos', code: 'ORDERS_LIST_ERROR' });
  }
});

// ============================================================
// GET /api/orders/kds/:module — KDS View (cocina/bar)
// NOTA: debe registrarse ANTES de GET /:id (orden de Express)
// ============================================================

router.get('/kds/:module', requireAuth, requireRole('admin', 'kds'), (req, res) => {
  try {
    const module = req.params.module;
    if (!KDS_MODULES[module]) {
      return res.status(400).json({ success: false, error: 'Módulo KDS inválido. Use: cocina, bar, kds', code: 'INVALID_KDS_MODULE' });
    }

    const db = getDb();
    const moduleFilter = KDS_MODULES[module]; // 'cocina', 'bar', or 'all'

    let sql = `
      SELECT DISTINCT o.id, o.table_id, t.number as table_number, o.status,
             o.notes, o.created_at, o.waiter_id, s.display_name as waiter_name_resolved
      FROM orders o
      JOIN order_items oi ON o.id = oi.order_id
      JOIN menu_items mi ON oi.menu_item_id = mi.id
      LEFT JOIN tables t ON o.table_id = t.id
      LEFT JOIN staff s ON o.waiter_id = s.id
      WHERE o.status IN ('confirmed', 'preparing', 'ready')
    `;
    const params = [];

    if (moduleFilter !== 'all') {
      sql += ' AND mi.area = ?';
      params.push(moduleFilter);
    }

    sql += ` ORDER BY
        CASE o.status
          WHEN 'confirmed' THEN 1
          WHEN 'preparing' THEN 2
          WHEN 'ready' THEN 3
        END,
        o.created_at ASC`;

    const orders = db.prepare(sql).all(...params);

    // Attach KDS items for each order
    for (const order of orders) {
      let itemSql = `
        SELECT oi.id, oi.menu_item_id, mi.name as item_name, oi.quantity,
               oi.unit_price, oi.preparation_notes as item_notes, oi.status as item_status,
               oi.modifiers_json, oi.created_at, mi.area as kds_module
        FROM order_items oi
        JOIN menu_items mi ON oi.menu_item_id = mi.id
        WHERE oi.order_id = ?
      `;
      const itemParams = [order.id];

      if (moduleFilter !== 'all') {
        itemSql += ' AND mi.area = ?';
        itemParams.push(moduleFilter);
      }

      itemSql += ' ORDER BY oi.created_at ASC';
      order.items = db.prepare(itemSql).all(...itemParams);

      // Calculate wait time
      const created = new Date(order.created_at);
      const now = new Date();
      order.wait_minutes = Math.floor((now - created) / 60000);
    }

    res.json({ success: true, module, orders });
  } catch (err) {
    console.error('[Orders] KDS error:', err.message);
    res.status(500).json({ success: false, error: 'Error al obtener KDS', code: 'KDS_ERROR' });
  }
});

// ============================================================
// GET /api/orders/:id — Pedido específico
// ============================================================

router.get('/:id', requireAuth, (req, res) => {
  try {
    const db = getDb();
    const order = buildOrder(db, req.params.id);

    if (!order) {
      return res.status(404).json({ success: false, error: 'Pedido no encontrado', code: 'ORDER_NOT_FOUND' });
    }

    res.json({ success: true, order });
  } catch (err) {
    console.error('[Orders] Get error:', err.message);
    res.status(500).json({ success: false, error: 'Error al obtener pedido', code: 'ORDER_GET_ERROR' });
  }
});

// ============================================================
// POST /api/orders — Crear pedido
// ============================================================

router.post('/', requireAuth, requireRole('admin', 'mesero'), (req, res) => {
  try {
    const { table_id, items, notes, guest_count, local_id } = req.body;

    if (!table_id) {
      return res.status(400).json({ success: false, error: 'Mesa requerida', code: 'TABLE_REQUIRED' });
    }

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, error: 'Al menos un item requerido', code: 'ITEMS_REQUIRED' });
    }

    const db = getDb();

    // Verify table exists
    const table = db.prepare('SELECT id, number, status FROM tables WHERE id = ?').get(table_id);
    if (!table) {
      return res.status(404).json({ success: false, error: 'Mesa no encontrada', code: 'TABLE_NOT_FOUND' });
    }

    // Calculate totals
    let subtotal = 0;
    const orderItems = [];

    for (const item of items) {
      const menuItem = db.prepare(
        'SELECT id, name, price, category_id, area FROM menu_items WHERE id = ? AND is_active = 1'
      ).get(item.menu_item_id);
      if (!menuItem) {
        return res.status(400).json({ success: false, error: `Item inválido: ${item.menu_item_id}`, code: 'INVALID_MENU_ITEM' });
      }

      const quantity = item.quantity || 1;
      // Resolve size/modifier adjustments from the DB (SSOT — server computes totals)
      const { adjustment, summary } = resolveModifierAdjustment(db, menuItem.id, item.modifiers);
      const unitPrice = round2((menuItem.price || 0) + adjustment);
      const itemSubtotal = round2(unitPrice * quantity);

      subtotal += itemSubtotal;

      orderItems.push({
        id: item.id || randomUUID(),
        menu_item_id: menuItem.id,
        menu_item_name: menuItem.name,
        quantity,
        unit_price: unitPrice,
        subtotal: itemSubtotal,
        modifiers_json: summary.length > 0 ? JSON.stringify(summary) : null,
        preparation_notes: item.notes || '',
        status: 'pending',
        kds_module: item.kds_module || menuItem.area || 'cocina',
      });
    }

    // Modelo SSOT EXTRACTIVO (precio INCLUYE IVA): `subtotal` acumulado es
    // la suma de precios (gross). total = gross, subtotal(base) = gross/1.13.
    const { subtotal: baseSubtotal, iva, total } = computeTotals(subtotal);
    const orderId = randomUUID();

    db.prepare(`
      INSERT INTO orders (id, table_id, table_number, waiter_id, waiter_name, status,
                          subtotal, iva_amount, discount, discount_reason, total,
                          notes, guest_count, local_id, is_paid)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, '', ?, ?, ?, ?, 0)
    `).run(
      orderId, table_id, table.number, req.user.sub,
      req.user.displayName || req.user.username,
      'draft', baseSubtotal, iva, total,
      notes || '', guest_count || 1, local_id || orderId
    );

    const insertItem = db.prepare(`
      INSERT INTO order_items (id, order_id, menu_item_id, menu_item_name, quantity,
                               unit_price, modifiers_json, subtotal, status, preparation_notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const oi of orderItems) {
      insertItem.run(oi.id, orderId, oi.menu_item_id, oi.menu_item_name, oi.quantity,
                     oi.unit_price, oi.modifiers_json, oi.subtotal, oi.status, oi.preparation_notes);
    }

    // Mark table as occupied
    db.prepare("UPDATE tables SET status = 'occupied', current_order_id = ? WHERE id = ?").run(orderId, table_id);

    const order = buildOrder(db, orderId);
    res.status(201).json({ success: true, order });
  } catch (err) {
    console.error('[Orders] Create error:', err.message);
    res.status(500).json({ success: false, error: 'Error al crear pedido', code: 'ORDER_CREATE_ERROR' });
  }
});

// ============================================================
// PUT /api/orders/:id — Actualizar pedido (items, notes)
// ============================================================

router.put('/:id', requireAuth, requireRole('admin', 'mesero'), (req, res) => {
  try {
    const { notes, items } = req.body;
    const db = getDb();

    const existing = db.prepare('SELECT id, status FROM orders WHERE id = ?').get(req.params.id);
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Pedido no encontrado', code: 'ORDER_NOT_FOUND' });
    }

    if (['paid', 'cancelled'].includes(existing.status)) {
      return res.status(409).json({ success: false, error: 'Pedido ya completado o cancelado', code: 'ORDER_CLOSED' });
    }

    // Update notes
    if (notes !== undefined) {
      db.prepare("UPDATE orders SET notes = ? WHERE id = ?").run(notes, req.params.id);
    }

    // Replace items if provided
    if (items && Array.isArray(items) && items.length > 0) {
      db.prepare('DELETE FROM order_items WHERE order_id = ?').run(req.params.id);

      const insertItem = db.prepare(`
        INSERT INTO order_items (id, order_id, menu_item_id, menu_item_name, quantity,
                                 unit_price, modifiers_json, subtotal, status, preparation_notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const item of items) {
        const menuItem = db.prepare('SELECT id, name, price FROM menu_items WHERE id = ? AND is_active = 1').get(item.menu_item_id);
        if (!menuItem) continue;

        const quantity = item.quantity || 1;
        const { adjustment } = resolveModifierAdjustment(db, menuItem.id, item.modifiers);
        const unitPrice = round2((menuItem.price || 0) + adjustment);
        const itemSubtotal = round2(unitPrice * quantity);

        insertItem.run(randomUUID(), req.params.id, menuItem.id, menuItem.name, quantity,
                       unitPrice, item.modifiers ? JSON.stringify(item.modifiers) : null,
                       itemSubtotal, 'pending', item.notes || '');
      }

      recalcOrder(db, req.params.id);
    }

    const updated = buildOrder(db, req.params.id);
    res.json({ success: true, order: updated });
  } catch (err) {
    console.error('[Orders] Update error:', err.message);
    res.status(500).json({ success: false, error: 'Error al actualizar pedido', code: 'ORDER_UPDATE_ERROR' });
  }
});

// ============================================================
// PATCH /api/orders/:id/submit — draft → called (client sends to mesero)
// ============================================================

router.patch('/:id/submit', requireAuth, (req, res) => {
  try {
    const db = getDb();
    const existing = db.prepare('SELECT id, status, table_id FROM orders WHERE id = ?').get(req.params.id);
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Pedido no encontrado', code: 'ORDER_NOT_FOUND' });
    }

    if (existing.status !== 'draft') {
      return res.status(409).json({
        success: false,
        error: `Solo se pueden enviar pedidos en borrador. Estado actual: ${existing.status}`,
        code: 'ORDER_NOT_DRAFT',
        current: existing.status,
      });
    }

    db.prepare("UPDATE orders SET status = 'called', updated_at = datetime('now') WHERE id = ?")
      .run(req.params.id);

    res.json({ success: true, status: 'called', message: 'Pedido enviado al mesero' });
  } catch (err) {
    console.error('[Orders] Submit error:', err.message);
    res.status(500).json({ success: false, error: 'Error al enviar pedido', code: 'ORDER_SUBMIT_ERROR' });
  }
});

// ============================================================
// PATCH /api/orders/:id/confirm — called → confirmed (mesero action)
// ============================================================

router.patch('/:id/confirm', requireAuth, requireRole('admin', 'mesero'), (req, res) => {
  try {
    const db = getDb();
    const existing = db.prepare('SELECT id, status, table_id, table_number FROM orders WHERE id = ?').get(req.params.id);
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Pedido no encontrado', code: 'ORDER_NOT_FOUND' });
    }

    if (existing.status !== 'called') {
      return res.status(409).json({
        success: false,
        error: `Solo se pueden confirmar pedidos llamados. Estado actual: ${existing.status}`,
        code: 'ORDER_NOT_CALLED',
        current: existing.status,
      });
    }

    // Assign confirming mesero (client-created orders start with placeholder)
    const waiterId = req.user?.sub || existing.waiter_id;
    const waiterName = req.user?.displayName || 'Mesero';
    db.prepare(
      "UPDATE orders SET status = 'confirmed', waiter_id = ?, waiter_name = ?, updated_at = datetime('now') WHERE id = ?"
    ).run(waiterId, waiterName, req.params.id);

    // Mark table as ordered
    db.prepare("UPDATE tables SET status = 'ordered' WHERE id = ?").run(existing.table_id);

    // Broadcast new_order to KDS (cocina + bar)
    const order = buildOrder(db, req.params.id);
    broadcastOrderConfirmed(order);

    res.json({ success: true, status: 'confirmed', message: 'Pedido confirmado' });
  } catch (err) {
    console.error('[Orders] Confirm error:', err.message);
    res.status(500).json({ success: false, error: 'Error al confirmar pedido', code: 'ORDER_CONFIRM_ERROR' });
  }
});

// ============================================================
// PATCH /api/orders/:id/status — Cambiar estado del pedido
// ============================================================

router.patch('/:id/status', requireAuth, (req, res) => {
  try {
    const { status } = req.body;

    const canonical = ORDER_STATUS_MAP[status];
    if (!canonical) {
      return res.status(400).json({
        success: false,
        error: `Estado inválido. Use: ${Object.keys(ORDER_STATUS_MAP).join(', ')}`,
        code: 'INVALID_STATUS',
      });
    }

    const db = getDb();
    const existing = db.prepare('SELECT id, status, table_id FROM orders WHERE id = ?').get(req.params.id);
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Pedido no encontrado', code: 'ORDER_NOT_FOUND' });
    }

    // Enforce status flow (forward only; cancel any time)
    const flow = ['draft', 'called', 'confirmed', 'preparing', 'ready', 'served', 'paid'];
    const currentIdx = flow.indexOf(existing.status);
    const nextIdx = flow.indexOf(canonical);

    if (canonical !== 'cancelled' && nextIdx < currentIdx) {
      return res.status(409).json({
        success: false,
        error: 'No se puede retroceder el estado del pedido',
        code: 'STATUS_FLOW_ERROR',
        current: existing.status,
        requested: canonical,
      });
    }

    const now = new Date().toISOString();
    db.prepare("UPDATE orders SET status = ?, synced_at = ?, updated_at = datetime('now') WHERE id = ?")
      .run(canonical, now, req.params.id);

    // If paid, mark is_paid
    if (canonical === 'paid') {
      db.prepare("UPDATE orders SET is_paid = 1, paid_at = COALESCE(paid_at, datetime('now')) WHERE id = ?")
        .run(req.params.id);
    }

    // If paid or cancelled, free the table (if no other active orders)
    if (canonical === 'paid' || canonical === 'cancelled') {
      const activeOrders = db.prepare(
        "SELECT id FROM orders WHERE table_id = ? AND status NOT IN ('paid','cancelled') AND id != ?"
      ).get(existing.table_id, req.params.id);

      if (!activeOrders) {
        db.prepare("UPDATE tables SET status = 'free', current_order_id = NULL WHERE id = ?")
          .run(existing.table_id);
      }
    }

    // Broadcast status_change to KDS so cocina + bar re-render.
    // If the new state is "ready" and all items are ready, also notify meseros.
    const orderForWs = buildOrder(db, req.params.id);
    broadcastOrderStatusChange(orderForWs, existing.status);

    res.json({ success: true, status: canonical, message: `Pedido ${canonical}` });
  } catch (err) {
    console.error('[Orders] Status error:', err.message);
    res.status(500).json({ success: false, error: 'Error al cambiar estado', code: 'ORDER_STATUS_ERROR' });
  }
});

// ============================================================
// POST /api/orders/:id/items — Agregar item a pedido existente
// ============================================================

router.post('/:id/items', requireAuth, requireRole('admin', 'mesero'), (req, res) => {
  try {
    const { menu_item_id, quantity, notes, modifiers } = req.body;

    if (!menu_item_id) {
      return res.status(400).json({ success: false, error: 'Item requerido', code: 'ITEM_REQUIRED' });
    }

    const db = getDb();
    const order = db.prepare('SELECT id, status FROM orders WHERE id = ?').get(req.params.id);
    if (!order) {
      return res.status(404).json({ success: false, error: 'Pedido no encontrado', code: 'ORDER_NOT_FOUND' });
    }

    if (['paid', 'cancelled'].includes(order.status)) {
      return res.status(409).json({ success: false, error: 'Pedido cerrado', code: 'ORDER_CLOSED' });
    }

    const menuItem = db.prepare('SELECT id, name, price FROM menu_items WHERE id = ? AND is_active = 1').get(menu_item_id);
    if (!menuItem) {
      return res.status(404).json({ success: false, error: 'Item de menú no encontrado', code: 'MENU_ITEM_NOT_FOUND' });
    }

    const qty = quantity || 1;
    const { adjustment } = resolveModifierAdjustment(db, menuItem.id, modifiers);
    const unitPrice = round2((menuItem.price || 0) + adjustment);
    const itemSubtotal = round2(unitPrice * qty);

    db.prepare(`
      INSERT INTO order_items (id, order_id, menu_item_id, menu_item_name, quantity,
                               unit_price, modifiers_json, subtotal, status, preparation_notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
    `).run(randomUUID(), req.params.id, menuItem.id, menuItem.name, qty, unitPrice,
           modifiers ? JSON.stringify(modifiers) : null, itemSubtotal, notes || '');

    recalcOrder(db, req.params.id);

    res.status(201).json({ success: true, message: 'Item agregado al pedido' });
  } catch (err) {
    console.error('[Orders] Add item error:', err.message);
    res.status(500).json({ success: false, error: 'Error al agregar item', code: 'ORDER_ADD_ITEM_ERROR' });
  }
});

// ============================================================
// DELETE /api/orders/:id/items/:itemId — Quitar item
// ============================================================

router.delete('/:id/items/:itemId', requireAuth, requireRole('admin', 'mesero'), (req, res) => {
  try {
    const db = getDb();
    const orderItem = db.prepare('SELECT id, order_id FROM order_items WHERE id = ? AND order_id = ?').get(req.params.itemId, req.params.id);
    if (!orderItem) {
      return res.status(404).json({ success: false, error: 'Item no encontrado en el pedido', code: 'ORDER_ITEM_NOT_FOUND' });
    }

    db.prepare('DELETE FROM order_items WHERE id = ?').run(req.params.itemId);
    recalcOrder(db, req.params.id);

    res.json({ success: true, message: 'Item eliminado del pedido' });
  } catch (err) {
    console.error('[Orders] Remove item error:', err.message);
    res.status(500).json({ success: false, error: 'Error al eliminar item', code: 'ORDER_REMOVE_ITEM_ERROR' });
  }
});

export default router;
