/**
 * E2E flujo 4+5 — KDS cocina y bar: ciclo de estados de items.
 *
 *   node scripts/e2e-kds-estados.mjs
 *
 * Pedido mixto confirmado → cada KDS:
 *   - cocina: pending → preparing → ready → delivered (persistido, visto
 *     por el otro módulo vía endpoint)
 *   - bar:    pending → ready (listo directo)
 *   - verificación de aislamiento: cocina solo ve sus items, bar los suyos
 *   - al marcar todos los items delivered/cancelled → pedido served
 */

import { api, makeReporter, ensureThrowawayTable, getCleanupDb } from './e2e-lib.mjs';
import { tokenFor } from './e2e-session.mjs';

const reporter = makeReporter('kds-estados');
const TABLE_NUMBER = 93;

async function run() {
  console.log('== Flujo 4+5: KDS estados (cocina + bar) ==');

  const adminToken = tokenFor('admin');
  const meseroToken = tokenFor('mesero');
  const kdsToken = tokenFor('kds');
  reporter.assert(!!adminToken && !!meseroToken && !!kdsToken, 'sesión compartida');

  // Mesa throwaway
  const table = await ensureThrowawayTable(TABLE_NUMBER, { adminToken });
  reporter.assert(table.id != null, `mesa ${TABLE_NUMBER} lista`);

  // Items mixtos
  const menuRes = await api('/api/menu/items');
  const items = menuRes.json.items.filter(i => i.price != null);
  const barItem = items.find(i => i.area === 'bar');
  const cocinaItem = items.find(i => i.area === 'cocina' || !i.area);
  reporter.assert(!!barItem && !!cocinaItem, `items mixtos: ${barItem?.name} + ${cocinaItem?.name}`);

  // Pedido mixto → confirmed
  const create = await api('/api/orders', {
    method: 'POST', token: meseroToken,
    body: {
      table_id: table.id, guest_count: 2,
      items: [
        { menu_item_id: barItem.id, quantity: 1 },
        { menu_item_id: cocinaItem.id, quantity: 1 },
      ],
    },
  });
  reporter.assert(create.status === 201, `pedido creado (${create.status})`);
  const orderId = create.json.order.id;
  await api(`/api/orders/${orderId}/submit`, { method: 'PATCH', token: meseroToken });
  const confirm = await api(`/api/orders/${orderId}/confirm`, { method: 'PATCH', token: meseroToken });
  reporter.assert(confirm.json.status === 'confirmed', 'confirmado (KDS)');

  // Obtener items por módulo desde el KDS unificado
  const all = await api('/api/orders/kds/kds', { token: kdsToken });
  const order = all.json.orders.find(o => o.id === orderId);
  const cocinaItemRow = order.items.find(i => i.kds_module === 'cocina');
  const barItemRow = order.items.find(i => i.kds_module === 'bar');
  reporter.assert(!!cocinaItemRow && !!barItemRow, `items en KDS: cocina=${!!cocinaItemRow} bar=${!!barItemRow}`);

  // ---- KDS COCINA: ciclo completo del item ----
  console.log('-- KDS cocina: pending → preparing → ready → delivered --');
  const p1 = await api(`/api/orders/${orderId}/items/${cocinaItemRow.id}/status`, {
    method: 'PATCH', token: kdsToken, body: { status: 'preparing' },
  });
  reporter.assert(p1.status === 200 && p1.json.status === 'preparing', 'cocina: pending → preparing (persistido)');

  const p2 = await api(`/api/orders/${orderId}/items/${cocinaItemRow.id}/status`, {
    method: 'PATCH', token: kdsToken, body: { status: 'ready' },
  });
  reporter.assert(p2.status === 200 && p2.json.status === 'ready', 'cocina: preparing → ready (persistido)');

  // Verificar persistencia desde KDS cocina (el item aparece ready)
  const cocinaView = await api('/api/orders/kds/cocina', { token: kdsToken });
  const cocinaOrder = cocinaView.json.orders.find(o => o.id === orderId);
  const cocinaItemAfter = cocinaOrder?.items?.find(i => i.id === cocinaItemRow.id);
  reporter.assert(cocinaItemAfter?.item_status === 'ready', `KDS cocina ve item ready (${cocinaItemAfter?.item_status})`);
  reporter.assert(cocinaOrder?.items?.length === 1, `cocina ve solo 1 item (${cocinaOrder?.items?.length})`);

  // ---- KDS BAR: pending → ready directo ----
  console.log('-- KDS bar: pending → ready --');
  const barViewBefore = await api('/api/orders/kds/bar', { token: kdsToken });
  const barOrderBefore = barViewBefore.json.orders.find(o => o.id === orderId);
  reporter.assert(barOrderBefore?.items?.length === 1, `bar ve solo 1 item (${barOrderBefore?.items?.length})`);
  const barItemStatus = barOrderBefore.items[0].item_status;
  reporter.assert(barItemStatus === 'pending', `bar item empieza pending (${barItemStatus})`);

  const p3 = await api(`/api/orders/${orderId}/items/${barItemRow.id}/status`, {
    method: 'PATCH', token: kdsToken, body: { status: 'ready' },
  });
  reporter.assert(p3.status === 200 && p3.json.status === 'ready', 'bar: pending → ready (persistido)');

  // Aislamiento: el cambio de bar NO afecta la vista cocina
  const cocinaView2 = await api('/api/orders/kds/cocina', { token: kdsToken });
  const cocinaOrder2 = cocinaView2.json.orders.find(o => o.id === orderId);
  reporter.assert(cocinaOrder2?.items?.length === 1, 'cocina sigue viendo 1 item (aislamiento bar)');

  // ---- Pedido served cuando todos los items delivered/cancelled ----
  console.log('-- Servir: ambos items delivered → pedido served --');
  await api(`/api/orders/${orderId}/items/${cocinaItemRow.id}/status`, {
    method: 'PATCH', token: kdsToken, body: { status: 'delivered' },
  });
  const servBar = await api(`/api/orders/${orderId}/items/${barItemRow.id}/status`, {
    method: 'PATCH', token: kdsToken, body: { status: 'delivered' },
  });
  reporter.assert(servBar.status === 200, 'bar item delivered');

  const orderAfter = await api(`/api/orders/${orderId}`, { token: meseroToken });
  reporter.assert(orderAfter.json.order.status === 'served', `pedido served (${orderAfter.json.order.status})`);
  const kdsAfter = await api('/api/orders/kds/kds', { token: kdsToken });
  reporter.assert(!kdsAfter.json.orders.some(o => o.id === orderId), 'pedido fuera del KDS (served ya no es activo)');

  // Limpieza
  console.log('-- Limpieza --');
  const db = await getCleanupDb();
  db.prepare('DELETE FROM payments WHERE order_id = ?').run(orderId);
  db.prepare('DELETE FROM order_items WHERE order_id = ?').run(orderId);
  db.prepare('DELETE FROM orders WHERE id = ?').run(orderId);
  const del = await api(`/api/tables/${table.id}`, { method: 'DELETE', token: adminToken });
  reporter.assert(del.status === 200, 'mesa eliminada');

  reporter.finish();
}

run().catch(err => {
  console.error('E2E crash:', err);
  process.exit(1);
});
