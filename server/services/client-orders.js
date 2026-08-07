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
import { computeTotals, round2 } from '../../src/core/config/iva.js';

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
    'SELECT id, name, price, area, category_id FROM menu_items WHERE id = ? AND is_active = 1 AND is_available = 1'
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

    const quantity = item.quantity ?? 1;
    if (!Number.isFinite(quantity) || quantity < 1) {
      return { success: false, code: 'INVALID_QUANTITY', error: 'Cantidad inválida (debe ser ≥ 1)' };
    }

    // Resolve unit price: base price (null = size-variant item) + modifier adjustments.
    // Contrato SSOT: modifiers llegan como [{ option_id }] (camelCase en el
    // payload público clientes → snake_case opción única). Ya NO se tolera
    // el doble-nombre modifier_option_id.
    let modifierAdjustment = 0;
    let modifierSummary = [];
    const rawModifiers = Array.isArray(item.modifiers) ? item.modifiers : [];
    if (rawModifiers.length > 0) {
      const optionIds = rawModifiers.map(m => m.option_id).filter(Boolean);
      let options = [];
      if (optionIds.length > 0) {
        const placeholders = optionIds.map(() => '?').join(',');
        options = db.prepare(
          `SELECT id, name, price_adjustment FROM modifier_options WHERE id IN (${placeholders})`
        ).all(...optionIds);
      }
      for (const m of rawModifiers) {
        const opt = options.find(o => o.id === m.option_id);
        if (!opt) {
          return {
            success: false,
            code: 'INVALID_MODIFIER_OPTION',
            error: `Opción inválida: ${m.option_id}`,
          };
        }
        modifierAdjustment += Number(opt.price_adjustment || 0);
        modifierSummary.push({ option_id: opt.id, name: opt.name, price_adjustment: opt.price_adjustment });
      }
    }

    const basePrice = menuItem.price ?? 0;
    const unitPrice = round2(basePrice + modifierAdjustment);
    const itemSubtotal = round2(unitPrice * quantity);
    subtotal += itemSubtotal;

    orderItems.push({
      id: item.id || randomUUID(),
      menu_item_id: menuItem.id,
      menu_item_name: menuItem.name,
      quantity,
      unit_price: unitPrice,
      subtotal: itemSubtotal,
      modifiers_json: modifierSummary.length > 0 ? JSON.stringify(modifierSummary) : null,
      // Contrato SSOT: el campo de notas es `notes` (único). No se tolera
      // el doble-nombre preparation_notes en la entrada pública.
      preparation_notes: item.notes || '',
      status: 'pending',
    });
  }

  // ── 2.6 (A7) UN SOLO PEDIDO ACTIVO POR MESA ──────────────────
  // "El pedido activo es el permiso": un segundo teléfono de la misma
  // mesa NO puede crear otro pedido mientras exista uno activo
  // (status NOT IN ('paid','cancelled')). Regla documentada:
  //   - pedido activo de OTRO session_id → rechazo 409 TABLE_HAS_ACTIVE_ORDER
  //   - excepción: pedido activo del MISMO session_id (mismo teléfono,
  //     mismo flujo de tracking/reintento) → se permite
  // El session_id se guarda en orders.local_id al insertar (abajo).
  // OJO: corre DESPUÉS de validar items (orden de validación histórico:
  // INVALID_MENU_ITEM primero — ver tests/unit/client-orders-agotados.test.js).
  const activeOrder = db.prepare(
    "SELECT id, local_id FROM orders WHERE table_id = ? AND status NOT IN ('paid','cancelled')"
  ).get(table.id);
  if (activeOrder && activeOrder.local_id !== session_id) {
    return {
      success: false,
      code: 'TABLE_HAS_ACTIVE_ORDER',
      error: 'La mesa ya tiene un pedido activo — espera a que lo atiendan o lo cierren',
      activeOrderId: activeOrder.id,
    };
  }

  // Modelo EXTRACTIVO (precio INCLUYE IVA — SSOT iva.js):
  //   - total  = suma de precios del carrito (lo que paga el cliente, ya incluye IVA)
  //   - subtotal = base (sin IVA) = total / 1.13
  //   - iva   = total - subtotal
  const grossTotal = round2(subtotal);
  const totals = computeTotals(grossTotal);
  const iva = totals.iva;
  const total = totals.total;
  // Reasignar subtotal a BASE (sin IVA) para consistencia con el resto de capas,
  // y mantener separada la cifra bruta para insertar como `total`.
  subtotal = totals.subtotal;
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

  // Notify mesero: the client order arrives as a call_waiter call so the
  // mesero PWA shows the table immediately ("El pedido activo es el permiso").
  const existingCall = db.prepare(
    "SELECT id FROM waiter_calls WHERE table_id = ? AND call_type = 'call_waiter' AND status = 'pending'"
  ).get(table.id);
  if (!existingCall) {
    db.prepare(`
      INSERT INTO waiter_calls (id, table_id, table_number, session_id, call_type, status)
      VALUES (?, ?, ?, ?, 'call_waiter', 'pending')
    `).run(randomUUID(), table.id, table.number, session_id);
  }

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
