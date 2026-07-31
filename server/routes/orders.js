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
 * ═══════════════════════════════════════════════════════════
 */

import { Router } from 'express';
import { getDb } from '../db/index.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const router = Router();

// ============================================================
// Helpers
// ============================================================

const ORDER_STATUSES = ['pendiente', 'en_preparacion', 'listo', 'servido', 'completado', 'cancelado'];
const KDS_MODULES = { cocina: 'cocina', bar: 'bar' };

/**
 * Broadcast an order update via WebSocket
 */
function broadcastOrderUpdate(orderId, action) {
  // The WebSocket server is attached to the HTTP server
  // Clients poll or use WS — handled at server level
  // This function exists for future WS-based push
  if (process.send) {
    process.send({ type: 'order_update', orderId, action, timestamp: new Date().toISOString() });
  }
}

// ============================================================
// GET /api/orders — Listar pedidos
// ============================================================

router.get('/', requireAuth, (req, res) => {
  try {
    const db = getDb();
    const { status, table_id, date_from, date_to, limit } = req.query;

    let sql = `
      SELECT o.id, o.table_id, t.number as table_number, o.status, o.notes,
             o.subtotal, o.tax, o.total, o.payment_status,
             o.created_by, s.display_name as created_by_name,
             o.created_at, o.updated_at
      FROM orders o
      LEFT JOIN tables t ON o.table_id = t.id
      LEFT JOIN staff s ON o.created_by = s.id
      WHERE 1=1
    `;
    const params = [];

    if (status) {
      const statuses = status.split(',');
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
        SELECT oi.id, oi.menu_item_id, mi.name as item_name, mi.price,
               oi.quantity, oi.unit_price, oi.subtotal as item_subtotal,
               oi.notes as item_notes, oi.status as item_status,
               oi.modifiers, oi.kds_module, oi.created_at as item_created_at
        FROM order_items oi
        JOIN menu_items mi ON oi.menu_item_id = mi.id
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
// GET /api/orders/:id — Pedido específico
// ============================================================

router.get('/:id', requireAuth, (req, res) => {
  try {
    const db = getDb();
    const order = db.prepare(`
      SELECT o.*, t.number as table_number, s.display_name as created_by_name
      FROM orders o
      LEFT JOIN tables t ON o.table_id = t.id
      LEFT JOIN staff s ON o.created_by = s.id
      WHERE o.id = ?
    `).get(req.params.id);

    if (!order) {
      return res.status(404).json({ success: false, error: 'Pedido no encontrado', code: 'ORDER_NOT_FOUND' });
    }

    order.items = db.prepare(`
      SELECT oi.*, mi.name as item_name
      FROM order_items oi
      JOIN menu_items mi ON oi.menu_item_id = mi.id
      WHERE oi.order_id = ?
      ORDER BY oi.created_at ASC
    `).all(order.id);

    // Payment info if any
    order.payments = db.prepare(`
      SELECT * FROM payments WHERE order_id = ?
    `).all(order.id);

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
    const { table_id, items, notes } = req.body;

    if (!table_id) {
      return res.status(400).json({ success: false, error: 'Mesa requerida', code: 'TABLE_REQUIRED' });
    }

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, error: 'Al menos un item requerido', code: 'ITEMS_REQUIRED' });
    }

    const db = getDb();

    // Verify table exists and is available
    const table = db.prepare('SELECT id, status FROM tables WHERE id = ?').get(table_id);
    if (!table) {
      return res.status(404).json({ success: false, error: 'Mesa no encontrada', code: 'TABLE_NOT_FOUND' });
    }

    // Calculate totals
    let subtotal = 0;
    const orderItems = [];

    for (const item of items) {
      const menuItem = db.prepare('SELECT id, name, price, category_id FROM menu_items WHERE id = ? AND active = 1').get(item.menu_item_id);
      if (!menuItem) {
        return res.status(400).json({ success: false, error: `Item inválido: ${item.menu_item_id}`, code: 'INVALID_MENU_ITEM' });
      }

      const quantity = item.quantity || 1;
      const unitPrice = menuItem.price;
      const itemSubtotal = unitPrice * quantity;

      // Determine KDS module based on category
      const cat = db.prepare('SELECT name FROM menu_categories WHERE id = ?').get(menuItem.category_id);
      const kdsModule = cat && (cat.name.toLowerCase().includes('bar') || cat.name.toLowerCase().includes('tragos') || cat.name.toLowerCase().includes('cerveza'))
        ? 'bar' : 'cocina';

      subtotal += itemSubtotal;

      orderItems.push({
        menu_item_id: menuItem.id,
        item_name: menuItem.name,
        quantity,
        unit_price: unitPrice,
        subtotal: itemSubtotal,
        notes: item.notes || '',
        modifiers: item.modifiers ? JSON.stringify(item.modifiers) : null,
        kds_module: item.kds_module || kdsModule,
      });
    }

    const tax = Math.round(subtotal * 0.13 * 100) / 100; // 13% IVA
    const total = subtotal + tax;

    const orderResult = db.prepare(`
      INSERT INTO orders (table_id, status, notes, subtotal, tax, total, payment_status, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(table_id, 'pendiente', notes || '', subtotal, tax, total, 'pendiente', req.user.sub);

    const orderId = orderResult.lastInsertRowid;

    // Insert order items
    const insertItem = db.prepare(`
      INSERT INTO order_items (order_id, menu_item_id, quantity, unit_price, subtotal, notes, modifiers, kds_module)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const oi of orderItems) {
      insertItem.run(orderId, oi.menu_item_id, oi.quantity, oi.unit_price, oi.subtotal, oi.notes, oi.modifiers, oi.kds_module);
    }

    // Update table status to ocupada
    db.prepare('UPDATE tables SET status = ? WHERE id = ?').run('ocupada', table_id);

    // Return created order
    const order = db.prepare(`
      SELECT o.*, t.number as table_number, s.display_name as created_by_name
      FROM orders o
      LEFT JOIN tables t ON o.table_id = t.id
      LEFT JOIN staff s ON o.created_by = s.id
      WHERE o.id = ?
    `).get(orderId);

    order.items = db.prepare(`
      SELECT oi.*, mi.name as item_name
      FROM order_items oi
      JOIN menu_items mi ON oi.menu_item_id = mi.id
      WHERE oi.order_id = ?
      ORDER BY oi.created_at ASC
    `).all(orderId);

    broadcastOrderUpdate(orderId, 'created');

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

    if (['completado', 'cancelado'].includes(existing.status)) {
      return res.status(409).json({ success: false, error: 'Pedido ya completado o cancelado', code: 'ORDER_CLOSED' });
    }

    // Update notes
    if (notes !== undefined) {
      db.prepare('UPDATE orders SET notes = ? WHERE id = ?').run(notes, req.params.id);
    }

    // Replace items if provided
    if (items && Array.isArray(items) && items.length > 0) {
      // Delete existing items
      db.prepare('DELETE FROM order_items WHERE order_id = ?').run(req.params.id);

      let subtotal = 0;
      const insertItem = db.prepare(`
        INSERT INTO order_items (order_id, menu_item_id, quantity, unit_price, subtotal, notes, modifiers, kds_module)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const item of items) {
        const menuItem = db.prepare('SELECT id, name, price FROM menu_items WHERE id = ? AND active = 1').get(item.menu_item_id);
        if (!menuItem) continue;

        const quantity = item.quantity || 1;
        const unitPrice = menuItem.price;
        const itemSubtotal = unitPrice * quantity;
        subtotal += itemSubtotal;

        insertItem.run(req.params.id, menuItem.id, quantity, unitPrice, itemSubtotal, item.notes || '', null, 'cocina');
      }

      const tax = Math.round(subtotal * 0.13 * 100) / 100;
      const total = subtotal + tax;
      db.prepare('UPDATE orders SET subtotal = ?, tax = ?, total = ? WHERE id = ?').run(subtotal, tax, total, req.params.id);
    }

    const updated = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
    broadcastOrderUpdate(updated.id, 'updated');

    res.json({ success: true, order: updated });
  } catch (err) {
    console.error('[Orders] Update error:', err.message);
    res.status(500).json({ success: false, error: 'Error al actualizar pedido', code: 'ORDER_UPDATE_ERROR' });
  }
});

// ============================================================
// PATCH /api/orders/:id/status — Cambiar estado del pedido
// ============================================================

router.patch('/:id/status', requireAuth, (req, res) => {
  try {
    const { status } = req.body;

    if (!status || !ORDER_STATUSES.includes(status)) {
      return res.status(400).json({
        success: false,
        error: `Estado inválido. Use: ${ORDER_STATUSES.join(', ')}`,
        code: 'INVALID_STATUS',
      });
    }

    const db = getDb();
    const existing = db.prepare('SELECT id, status, table_id FROM orders WHERE id = ?').get(req.params.id);
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Pedido no encontrado', code: 'ORDER_NOT_FOUND' });
    }

    // Enforce status flow
    const flow = ['pendiente', 'en_preparacion', 'listo', 'servido', 'completado'];
    const currentIdx = flow.indexOf(existing.status);
    const nextIdx = flow.indexOf(status);

    // Allow cancel at any time, but enforce forward flow otherwise
    if (status !== 'cancelado' && nextIdx < currentIdx) {
      return res.status(409).json({
        success: false,
        error: 'No se puede retroceder el estado del pedido',
        code: 'STATUS_FLOW_ERROR',
        current: existing.status,
        requested: status,
      });
    }

    db.prepare('UPDATE orders SET status = ? WHERE id = ?').run(status, req.params.id);

    // If completed, free the table (if no other active orders)
    if (status === 'completado') {
      const activeOrders = db.prepare(
        'SELECT id FROM orders WHERE table_id = ? AND status NOT IN (?, ?)'
      ).get(existing.table_id, 'completado', 'cancelado');

      if (!activeOrders) {
        db.prepare('UPDATE tables SET status = ? WHERE id = ?').run('disponible', existing.table_id);
      }
    }

    broadcastOrderUpdate(req.params.id, `status:${status}`);

    res.json({ success: true, status, message: `Pedido ${status}` });
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
    const { menu_item_id, quantity, notes } = req.body;

    if (!menu_item_id) {
      return res.status(400).json({ success: false, error: 'Item requerido', code: 'ITEM_REQUIRED' });
    }

    const db = getDb();
    const order = db.prepare('SELECT id, status FROM orders WHERE id = ?').get(req.params.id);
    if (!order) {
      return res.status(404).json({ success: false, error: 'Pedido no encontrado', code: 'ORDER_NOT_FOUND' });
    }

    if (['completado', 'cancelado'].includes(order.status)) {
      return res.status(409).json({ success: false, error: 'Pedido cerrado', code: 'ORDER_CLOSED' });
    }

    const menuItem = db.prepare('SELECT id, name, price FROM menu_items WHERE id = ? AND active = 1').get(menu_item_id);
    if (!menuItem) {
      return res.status(404).json({ success: false, error: 'Item de menú no encontrado', code: 'MENU_ITEM_NOT_FOUND' });
    }

    const qty = quantity || 1;
    const unitPrice = menuItem.price;
    const itemSubtotal = unitPrice * qty;

    db.prepare(`
      INSERT INTO order_items (order_id, menu_item_id, quantity, unit_price, subtotal, notes)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(req.params.id, menuItem.id, qty, unitPrice, itemSubtotal, notes || '');

    // Recalculate order totals
    const items = db.prepare('SELECT SUM(subtotal) as total_items FROM order_items WHERE order_id = ?').get(req.params.id);
    const newSubtotal = items.total_items || 0;
    const newTax = Math.round(newSubtotal * 0.13 * 100) / 100;
    const newTotal = newSubtotal + newTax;
    db.prepare('UPDATE orders SET subtotal = ?, tax = ?, total = ? WHERE id = ?').run(newSubtotal, newTax, newTotal, req.params.id);

    broadcastOrderUpdate(req.params.id, 'item_added');

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

    // Recalculate
    const items = db.prepare('SELECT SUM(subtotal) as total_items FROM order_items WHERE order_id = ?').get(req.params.id);
    const newSubtotal = items.total_items || 0;
    const newTax = Math.round(newSubtotal * 0.13 * 100) / 100;
    const newTotal = newSubtotal + newTax;
    db.prepare('UPDATE orders SET subtotal = ?, tax = ?, total = ? WHERE id = ?').run(newSubtotal, newTax, newTotal, req.params.id);

    broadcastOrderUpdate(req.params.id, 'item_removed');

    res.json({ success: true, message: 'Item eliminado del pedido' });
  } catch (err) {
    console.error('[Orders] Remove item error:', err.message);
    res.status(500).json({ success: false, error: 'Error al eliminar item', code: 'ORDER_REMOVE_ITEM_ERROR' });
  }
});

// ============================================================
// GET /api/orders/kds/:module — KDS View
// ============================================================

router.get('/kds/:module', requireAuth, requireRole('admin', 'cocina', 'bartender'), (req, res) => {
  try {
    const module = req.params.module;
    if (!KDS_MODULES[module]) {
      return res.status(400).json({ success: false, error: 'Módulo KDS inválido. Use: cocina, bar', code: 'INVALID_KDS_MODULE' });
    }

    const db = getDb();
    const orders = db.prepare(`
      SELECT DISTINCT o.id, o.table_id, t.number as table_number, o.status,
             o.notes, o.created_at, o.created_by
      FROM orders o
      JOIN order_items oi ON o.id = oi.order_id
      LEFT JOIN tables t ON o.table_id = t.id
      WHERE oi.kds_module = ?
        AND o.status IN ('pendiente', 'en_preparacion', 'listo')
      ORDER BY
        CASE o.status
          WHEN 'pendiente' THEN 1
          WHEN 'en_preparacion' THEN 2
          WHEN 'listo' THEN 3
        END,
        o.created_at ASC
    `).all(module);

    // Attach KDS items for each order
    for (const order of orders) {
      order.items = db.prepare(`
        SELECT oi.id, oi.menu_item_id, mi.name as item_name, oi.quantity,
               oi.unit_price, oi.notes as item_notes, oi.status as item_status,
               oi.modifiers, oi.created_at
        FROM order_items oi
        JOIN menu_items mi ON oi.menu_item_id = mi.id
        WHERE oi.order_id = ? AND oi.kds_module = ?
        ORDER BY oi.created_at ASC
      `).all(order.id, module);

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

export default router;
