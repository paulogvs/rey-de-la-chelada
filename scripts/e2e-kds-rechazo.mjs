/**
 * E2E flujo 6 — Rechazo de pedido en KDS (item agotado / rechazo).
 *
 *   node scripts/e2e-kds-rechazo.mjs
 *
 * El KDS tiene botón "Rechazar" (onReject): marca los items pending
 * como cancelled (persistido vía PATCH item status, FASE 2). El mesero
 * debe ver el pedido con los items cancelados, y la mesa queda libre.
 *
 * Criterio restobar: rechazar NO elimina el pedido — marca items como
 * cancelled para trazabilidad (lo que el cliente pidió, vs. lo servido).
 */

import { api, makeReporter, ensureThrowawayTable, getCleanupDb } from './e2e-lib.mjs';
import { tokenFor } from './e2e-session.mjs';

const reporter = makeReporter('kds-rechazo');
const TABLE_NUMBER = 94;

async function run() {
  console.log('== Flujo 6: Rechazo en KDS ==');

  const adminToken = tokenFor('admin');
  const meseroToken = tokenFor('mesero');
  const kdsToken = tokenFor('kds');
  reporter.assert(!!adminToken && !!meseroToken && !!kdsToken, 'sesión compartida');

  const table = await ensureThrowawayTable(TABLE_NUMBER, { adminToken });

  const menuRes = await api('/api/menu/items');
  const items = menuRes.json.items.filter(i => i.price != null);
  const cocinaItem = items.find(i => i.area === 'cocina' || !i.area);

  // Pedido de 1 comida → confirmado
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
  reporter.assert(true, `pedido confirmado (${orderId.slice(0, 8)}…)`);

  // El item aparece en KDS cocina como pending
  const kdsView = await api('/api/orders/kds/cocina', { token: kdsToken });
  const order = kdsView.json.orders.find(o => o.id === orderId);
  const itemRow = order?.items?.[0];
  reporter.assert(!!itemRow, 'item visible en KDS cocina');
  reporter.assert(itemRow?.item_status === 'pending', `item pending (${itemRow?.item_status})`);

  // RECHAZAR: misma acción que el botón Rechazar del frontend
  const reject = await api(`/api/orders/${orderId}/items/${itemRow.id}/status`, {
    method: 'PATCH', token: kdsToken, body: { status: 'cancelled' },
  });
  reporter.assert(reject.status === 200 && reject.json.status === 'cancelled', 'item rechazado (cancelled)');

  // Persistencia: el mesero ve el item cancelado
  const meseroView = await api(`/api/orders/${orderId}`, { token: meseroToken });
  const itemFromMesero = meseroView.json.order.items.find(i => i.id === itemRow.id);
  reporter.assert(itemFromMesero?.status === 'cancelled', `mesero ve item cancelled (${itemFromMesero?.status})`);

  // Todos los items cancelados → pedido served (trazable, no activo en KDS)
  const orderAfter = await api(`/api/orders/${orderId}`, { token: meseroToken });
  reporter.assert(orderAfter.json.order.status === 'served', `pedido served tras rechazo (${orderAfter.json.order.status})`);

  // El pedido ya no aparece en el KDS
  const kdsAfter = await api('/api/orders/kds/cocina', { token: kdsToken });
  reporter.assert(!kdsAfter.json.orders.some(o => o.id === orderId), 'pedido fuera del KDS tras rechazo');

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
