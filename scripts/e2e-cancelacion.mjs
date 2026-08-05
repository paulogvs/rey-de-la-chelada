/**
 * E2E flujo 7 — Cancelación de pedido (meseros/admin) → mesa liberada.
 *
 *   node scripts/e2e-cancelacion.mjs
 *
 * PATCH /api/orders/:id/status { status: 'cancelled' }:
 *   - pedido pasa a cancelled
 *   - mesa vuelve a free + current_order_id NULL (si no hay otros activos)
 *   - el pedido sale del KDS
 */

import { api, makeReporter, ensureThrowawayTable, getCleanupDb } from './e2e-lib.mjs';
import { tokenFor } from './e2e-session.mjs';

const reporter = makeReporter('cancelacion');
const TABLE_NUMBER = 95;

async function run() {
  console.log('== Flujo 7: Cancelación de pedido ==');

  const adminToken = tokenFor('admin');
  const meseroToken = tokenFor('mesero');
  const kdsToken = tokenFor('kds');
  reporter.assert(!!adminToken && !!meseroToken && !!kdsToken, 'sesión compartida');

  // Mesa throwaway con estado inicial conocido
  const table = await ensureThrowawayTable(TABLE_NUMBER, { adminToken });

  // Pedido con 1 comida
  const menuRes = await api('/api/menu/items');
  const items = menuRes.json.items.filter(i => i.price != null);
  const cocinaItem = items.find(i => i.area === 'cocina' || !i.area);

  const create = await api('/api/orders', {
    method: 'POST', token: meseroToken,
    body: {
      table_id: table.id, guest_count: 1,
      items: [{ menu_item_id: cocinaItem.id, quantity: 1 }],
    },
  });
  const orderId = create.json.order.id;
  await api(`/api/orders/${orderId}/submit`, { method: 'PATCH', token: meseroToken });
  await api(`/api/orders/${orderId}/confirm`, { method: 'PATCH', token: meseroToken });

  // Mesa ocupada (con pedido activo) — estado real: 'ordered'
  const tableBusy = await api(`/api/tables/${table.id}`, { token: adminToken });
  const busyStatus = tableBusy.json.table?.status;
  reporter.assert(['occupied', 'busy', 'ordered'].includes(busyStatus), `mesa con pedido activo (${busyStatus})`);

  // Cancelar desde MESERO
  console.log('-- Cancelar desde mesero --');
  const cancel = await api(`/api/orders/${orderId}/status`, {
    method: 'PATCH', token: meseroToken, body: { status: 'cancelled' },
  });
  reporter.assert(cancel.status === 200 && cancel.json.status === 'cancelled', `cancelado (${cancel.json.status})`);

  // Pedido cancelled visible para mesero
  const orderAfter = await api(`/api/orders/${orderId}`, { token: meseroToken });
  reporter.assert(orderAfter.json.order.status === 'cancelled', 'pedido cancelled en DB');

  // Mesa liberada
  const tableFree = await api(`/api/tables/${table.id}`, { token: adminToken });
  reporter.assert(tableFree.json.table?.status === 'free', `mesa liberada (${tableFree.json.table?.status})`);
  reporter.assert(tableFree.json.table?.current_order_id == null, 'current_order_id NULL');

  // Pedido fuera del KDS
  const kdsView = await api('/api/orders/kds/kds', { token: kdsToken });
  reporter.assert(!kdsView.json.orders.some(o => o.id === orderId), 'pedido fuera del KDS');

  // Cancelar pedido ya cancelado → error controlado (STATUS_FLOW o similar)
  console.log('-- Cancelar dos veces (idempotencia/control) --');
  const cancelAgain = await api(`/api/orders/${orderId}/status`, {
    method: 'PATCH', token: meseroToken, body: { status: 'cancelled' },
  });
  reporter.assert(cancelAgain.status === 200 || cancelAgain.status === 409,
    `segundo cancel: ${cancelAgain.status} (200 ok o 409 controlado)`);

  // Limpieza
  const db = await getCleanupDb();
  db.prepare('DELETE FROM payments WHERE order_id = ?').run(orderId);
  db.prepare('DELETE FROM order_items WHERE order_id = ?').run(orderId);
  db.prepare('DELETE FROM orders WHERE id = ?').run(orderId);
  await api(`/api/tables/${table.id}`, { method: 'DELETE', token: adminToken });
  reporter.assert(true, 'limpieza completa');

  reporter.finish();
}

run().catch(err => {
  console.error('E2E crash:', err);
  process.exit(1);
});
