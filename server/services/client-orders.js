/**
 * ═══════════════════════════════════════════════════════════
 *  Client Orders Service — Public order creation (clientes PWA)
 *
 *  "El pedido activo es el permiso": the client creates an order
 *  with NO JWT (table_number + session_id is the permission).
 *
 *  The order is created directly in 'called' status so the mesero
 *  just confirms it. Extracted from the route so it can be unit
 *  tested without an Express server.
 *
 *  Alineado al SSOT: server/db/schema.js → orders, order_items
 * ═══════════════════════════════════════════════════════════
 */

import { randomUUID } from 'node:crypto';

const IVA_RATE = 0.13;

function round2(n) {
  return Math.round(n * 100) / 100;
}

/**
 * Create a public order from the clientes PWA.
 * Returns { success, order?, code?, error? } — never throws for
 * expected validation errors.
 *
 * @param {object} db — better-sqlite3 instance
 * @param {object} input — { table_number, session_id, items, guest_count, notes }
 */
export function createPublicOrder(db, input) {
  const { table_number, session_id, items } = input || {};

  if (!table_number) {
    return { success: false, code: 'TABLE_REQUIRED', error: 'Número de mesa requerido' };
  }
  if (!session_id) {
    return { success: false, code: 'SESSION_REQUIRED', error: 'Sesión requerida' };
  }
  if (!items || !Array.isArray(items) || items.length === 0) {
    return { success: false, code: 'ITEMS_REQUIRED', error: 'Al menos un item requerido' };
  }

  const table = db.prepare('SELECT id, number, status FROM tables WHERE number = ?').get(table_number);
  if (!table) {
    return { success: false, code: 'TABLE_NOT_FOUND', error: 'Mesa no encontrada' };
  }

  // Build order items from menu DB (prices come from the server SSOT)
  let subtotal = 0;
  const orderItems = [];
  const findItem = db.prepare(
    'SELECT id, name, price, area, category_id FROM menu_items WHERE id = ? AND is_active = 1'
  );

  for (const item of items) {
    const menuItem = findItem.get(item.menu_item_id);
    if (!menuItem) {
      return {
        success: false,
        code: 'INVALID_MENU_ITEM',
        error: `Item inválido: ${item.menu_item_id}`,
      };
    }

    const quantity = item.quantity || 1;
    // price null = item with size variants → unit price comes from modifiers
    const unitPrice = menuItem.price ?? 0;
    const itemSubtotal = round2(unitPrice * quantity);
    subtotal += itemSubtotal;

    orderItems.push({
      id: item.id || randomUUID(),
      menu_item_id: menuItem.id,
      menu_item_name: menuItem.name,
      quantity,
      unit_price: unitPrice,
      subtotal: itemSubtotal,
      modifiers_json: item.modifiers ? JSON.stringify(item.modifiers) : null,
      preparation_notes: item.notes || item.preparation_notes || '',
      status: 'pending',
    });
  }

  const iva = round2(subtotal * IVA_RATE);
  const total = round2(subtotal + iva);
  const orderId = randomUUID();

  // FK: waiter_id references staff(id) — assign the default mesero as
  // placeholder; the confirming mesero is assigned at confirm time.
  const defaultMesero = db.prepare(
    "SELECT id FROM staff WHERE role = 'mesero' AND is_active = 1 ORDER BY created_at LIMIT 1"
  ).get();
  const waiterId = (defaultMesero && defaultMesero.id) || 'client';

  const insertOrder = db.prepare(`
    INSERT INTO orders (id, table_id, table_number, waiter_id, waiter_name, status,
                        subtotal, iva_amount, discount, discount_reason, total,
                        notes, guest_count, local_id, is_paid)
    VALUES (?, ?, ?, ?, ?, 'called', ?, ?, 0, '', ?, ?, ?, ?, 0)
  `);

  insertOrder.run(
    orderId, table.id, table.number, waiterId, 'Cliente',
    subtotal, iva, total,
    input.notes || '', input.guest_count || 1, session_id
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
  db.prepare("UPDATE tables SET status = 'occupied', current_order_id = ? WHERE id = ?")
    .run(orderId, table.id);

  const order = buildOrder(db, orderId);
  return { success: true, order };
}

/**
 * Public status tracking for a client order (no auth — orderId is the secret).
 * Returns { success, status, tableNumber, total, items, updatedAt }.
 */
export function getPublicOrderStatus(db, orderId) {
  const order = db.prepare(`
    SELECT id, status, table_number, total, updated_at, created_at
    FROM orders WHERE id = ?
  `).get(orderId);

  if (!order) {
    return { success: false, code: 'ORDER_NOT_FOUND', error: 'Pedido no encontrado' };
  }

  const items = db.prepare(`
    SELECT menu_item_name as name, quantity, subtotal
    FROM order_items WHERE order_id = ?
  `).all(orderId);

  return {
    success: true,
    status: order.status,
    tableNumber: order.table_number,
    total: order.total,
    items,
    updatedAt: order.updated_at,
  };
}

/** Build full order with items (internal) */
function buildOrder(db, orderId) {
  const order = db.prepare(`
    SELECT o.*, t.number as table_number
    FROM orders o
    LEFT JOIN tables t ON o.table_id = t.id
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

  return order;
}

export { round2 };
