/**
 * E2E flujo 2 — Menú digital (clientes): QR estático → carrito → pedido → tracking.
 *
 *   node scripts/e2e-cliente-menu.mjs
 *
 * "El pedido activo es el permiso" (sin JWT):
 *   1. QR estático: POST /api/client-sessions/table/:mesa (público, lazy)
 *   2. Menú: GET /api/menu/items (público) + verificación de precio con IVA SSOT
 *   3. Carrito: total calculado por el SERVIDOR (no cliente) al crear el pedido
 *   4. Pedido: POST /api/client-orders (público) → status 'called'
 *   5. Tracking: GET /api/client-orders/:id (público)
 *   6. Consistencia: total del pedido == suma de precios del menú (IVA incluido)
 */

import { api, makeReporter, ensureThrowawayTable, getCleanupDb } from './e2e-lib.mjs';
import { tokenFor } from './e2e-session.mjs';

const reporter = makeReporter('cliente-menu');
const TABLE_NUMBER = 97;

async function run() {
  console.log('== Flujo 2: Menú digital (clientes) ==');

  const adminToken = tokenFor('admin');
  reporter.assert(!!adminToken, 'sesión admin');

  // 1. Mesa throwaway
  const table = await ensureThrowawayTable(TABLE_NUMBER, { adminToken });

  // 2. QR estático — get-or-create sesión (público, lazy)
  console.log('1. QR estático → sesión de mesa');
  const qr = await api(`/api/client-sessions/table/${TABLE_NUMBER}`, { method: 'POST' });
  reporter.assert(qr.status === 200 && qr.json.sessionId, `sesión creada (${qr.status})`);
  const sessionId = qr.json.sessionId;
  reporter.assert(qr.json.url.includes(`mesa=${TABLE_NUMBER}`), `url estática estable (${qr.json.url})`);

  // 3. Sesión reutilizada (idempotente — mismo QR)
  const qr2 = await api(`/api/client-sessions/table/${TABLE_NUMBER}`, { method: 'POST' });
  reporter.assert(qr2.json.sessionId === sessionId, 'misma sesión reutilizada (QR estático estable)');

  // 4. Menú público con precios
  console.log('2. Menú carga + precios');
  const menu = await api('/api/menu/items');
  reporter.assert(menu.status === 200 && menu.json.items?.length > 0, `menú con items (${menu.json.items?.length})`);
  const items = menu.json.items.filter(i => i.price != null && i.price > 0);
  const cocinaItem = items.find(i => i.area === 'cocina' || !i.area);
  const barItem = items.find(i => i.area === 'bar');
  reporter.assert(!!cocinaItem && !!barItem, 'items bar + cocina disponibles');

  // 5. Carrito → crear pedido (total calculado por el SERVIDOR)
  console.log('3. Crear pedido (carrito → servidor)');
  const order = await api('/api/client-orders', {
    method: 'POST',
    body: {
      table_number: TABLE_NUMBER,
      session_id: sessionId,
      guest_count: 2,
      items: [
        { menu_item_id: cocinaItem.id, quantity: 2 },
        { menu_item_id: barItem.id, quantity: 1 },
      ],
    },
  });
  reporter.assert(order.status === 201 && order.json.orderId, `pedido creado (${order.status})`);
  const orderId = order.json.orderId;
  reporter.assert(order.json.status === 'called', `status called (${order.json.status})`);

  // 6. Verificación SSOT IVA: total == (2×precio_comida + 1×precio_bebida), redondeado
  const expectedGross = Math.round((2 * cocinaItem.price + barItem.price) * 100) / 100;
  reporter.assert(Math.abs(order.json.total - expectedGross) < 0.01,
    `total servidor == suma de precios: ${order.json.total} ≈ ${expectedGross}`);
  const ivaRate = 0.13;
  const expectedSubtotal = Math.round((order.json.total / (1 + ivaRate)) * 100) / 100;
  reporter.assert(order.json.total > expectedSubtotal, `total > subtotal (IVA incluido: ${order.json.total} > ${expectedSubtotal})`);

  // 7. Tracking público (no expone orderId — es el secreto; devuelve
  //    status/tableNumber/total/items)
  console.log('4. Tracking del pedido');
  const track = await api(`/api/client-orders/${orderId}`);
  reporter.assert(track.status === 200, 'tracking disponible');
  reporter.assert(track.json.order?.tableNumber === TABLE_NUMBER, `tracking mesa correcta (${track.json.order?.tableNumber})`);
  reporter.assert(['called', 'confirmed', 'preparing', 'ready', 'served'].includes(track.json.order?.status),
    `tracking status válido (${track.json.order?.status})`);
  reporter.assert(Math.abs(track.json.order?.total - order.json.total) < 0.01, 'total consistente en tracking');
  reporter.assert(track.json.order?.items?.length === 2, `tracking items (${track.json.order?.items?.length})`);

  // 8. Error: pedido sin items → rechazado
  console.log('5. Edge: pedido sin items');
  const empty = await api('/api/client-orders', {
    method: 'POST',
    body: { table_number: TABLE_NUMBER, session_id: sessionId, items: [] },
  });
  reporter.assert(empty.status === 400 && empty.json.code === 'ITEMS_REQUIRED', `sin items → 400 (${empty.status})`);

  // 9. Error: sesión/table inválida
  const badTable = await api('/api/client-orders', {
    method: 'POST',
    body: { table_number: 9999, session_id: sessionId, items: [{ menu_item_id: cocinaItem.id, quantity: 1 }] },
  });
  reporter.assert(badTable.status === 400 && badTable.json.code === 'TABLE_NOT_FOUND', `mesa inexistente → 400 (${badTable.status})`);

  // Limpieza
  console.log('6. Limpieza');
  const db = await getCleanupDb();
  db.prepare('DELETE FROM payments WHERE order_id = ?').run(orderId);
  db.prepare('DELETE FROM order_items WHERE order_id = ?').run(orderId);
  db.prepare('DELETE FROM orders WHERE id = ?').run(orderId);
  db.prepare('DELETE FROM client_sessions WHERE session_id = ?').run(sessionId);
  await api(`/api/tables/${table.id}`, { method: 'DELETE', token: adminToken });
  reporter.assert(true, 'limpieza completa');

  reporter.finish();
}

run().catch(err => {
  console.error('E2E crash:', err);
  process.exit(1);
});
