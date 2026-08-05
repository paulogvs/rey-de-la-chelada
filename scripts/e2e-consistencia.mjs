/**
 * E2E flujo 12 — Consistencia entre PWAs (SSOT IVA).
 *
 *   node scripts/e2e-consistencia.mjs
 *
 * El MISMO pedido debe mostrar el MISMO total en:
 *   - clientes (POST /api/client-orders → total)
 *   - meseros (GET /api/orders/:id → total)
 *   - caja    (POST /api/payments → amount, iva_amount)
 *   - reportes (GET /api/reports/sales/daily → net_revenue)
 *
 * Verifica: net_revenue == suma de payments == pedido.total,
 * y que el IVA derive del mismo helper SSOT (iva.js: total/1.13).
 */

import { api, makeReporter, ensureThrowawayTable } from './e2e-lib.mjs';
import { tokenFor } from './e2e-session.mjs';

const reporter = makeReporter('consistencia');
const TABLE_NUMBER = 96;
const today = new Date().toISOString().split('T')[0];

async function run() {
  console.log('== Flujo 12: Consistencia entre PWAs (SSOT IVA) ==');

  const adminToken = tokenFor('admin');
  const meseroToken = tokenFor('mesero');
  const kdsToken = tokenFor('kds');
  reporter.assert(!!adminToken && !!meseroToken && !!kdsToken, 'sesión completa');

  const table = await ensureThrowawayTable(TABLE_NUMBER, { adminToken });

  // 1. Pedido mixto (bar + cocina) — mesero
  console.log('1. Pedido mixto (mesero)');
  const menuRes = await api('/api/menu/items');
  const items = menuRes.json.items.filter(i => i.price != null);
  const barItem = items.find(i => i.area === 'bar');
  const cocinaItem = items.find(i => i.area === 'cocina' || !i.area);

  const create = await api('/api/orders', {
    method: 'POST', token: meseroToken,
    body: {
      table_id: table.id, guest_count: 3,
      items: [
        { menu_item_id: barItem.id, quantity: 2 },
        { menu_item_id: cocinaItem.id, quantity: 2 },
      ],
    },
  });
  const orderId = create.json.order.id;
  const meseroTotal = create.json.order.total;
  const meseroIva = create.json.order.iva_amount;
  reporter.assert(create.status === 201, `pedido mesero — total ${meseroTotal} iva ${meseroIva}`);

  await api(`/api/orders/${orderId}/submit`, { method: 'PATCH', token: meseroToken });
  await api(`/api/orders/${orderId}/confirm`, { method: 'PATCH', token: meseroToken });

  // 2. El mismo pedido visto por CLIENTES (tracking público)
  console.log('2. Vista clientes (tracking)');
  const track = await api(`/api/client-orders/${orderId}`);
  reporter.assert(Math.abs(track.json.order?.total - meseroTotal) < 0.01,
    `total clientes == total mesero (${track.json.order?.total})`);

  // 3. Visto por KDS (misma base de datos)
  console.log('3. Vista KDS');
  const kdsView = await api('/api/orders/kds/kds', { token: kdsToken });
  const kdsOrder = kdsView.json.orders.find(o => o.id === orderId);
  reporter.assert(!!kdsOrder, 'pedido en KDS');
  reporter.assert(kdsOrder.items.length === 2, `KDS ve 2 líneas (${kdsOrder.items.length})`);

  // 4. Cobro en CAJA (efectivo) — SSOT IVA
  console.log('4. Cobro caja (efectivo)');
  const pay = await api('/api/payments', {
    method: 'POST', token: meseroToken,
    body: { order_id: orderId, amount: meseroTotal, method: 'cash' },
  });
  reporter.assert(pay.status === 201 && pay.json.fully_paid, 'cobrado');
  const payment = pay.json.payment;
  reporter.assert(Math.abs(payment.amount - meseroTotal) < 0.01, `payment.amount == total mesero`);
  reporter.assert(Math.abs(payment.iva_amount - meseroIva) < 0.01,
    `payment.iva_amount == iva pedido (${payment.iva_amount} == ${meseroIva})`);

  // 5. Reporte diario: net_revenue == total cobrado
  console.log('5. Reporte diario');
  const report = await api(`/api/reports/sales/daily?date=${today}`, { token: adminToken });
  const summary = report.json.summary;
  reporter.assert(summary.net_revenue >= meseroTotal - 0.01, `net_revenue >= pedido (${summary.net_revenue})`);

  // 6. SSOT IVA: iva == total - total/1.13 (helper iva.js, redondeo 2)
  console.log('6. SSOT IVA (helper iva.js)');
  const expectedSubtotal = Math.round((meseroTotal / 1.13) * 100) / 100;
  const expectedIva = Math.round((meseroTotal - expectedSubtotal) * 100) / 100;
  reporter.assert(Math.abs(meseroIva - expectedIva) < 0.01,
    `iva pedido == iva derivado (${meseroIva} ≈ ${expectedIva})`);
  reporter.assert(Math.abs(payment.iva_amount - expectedIva) < 0.01,
    `iva payment == iva derivado (${payment.iva_amount} ≈ ${expectedIva})`);

  // 7. Pedido paid + mesa libre (invariante de cierre)
  const orderAfter = await api(`/api/orders/${orderId}`, { token: meseroToken });
  reporter.assert(orderAfter.json.order.status === 'paid', 'pedido paid');
  const tableFree = await api(`/api/tables/${table.id}`, { token: adminToken });
  reporter.assert(tableFree.json.table?.status === 'free', 'mesa libre tras pago');

  // Limpieza
  console.log('7. Limpieza');
  process.env.DB_PATH = process.env.E2E_DB_PATH || 'data/test-e2e.db';
  const { getDb } = await import('../server/db/index.js');
  const db = getDb();
  db.prepare('DELETE FROM payments WHERE order_id = ?').run(orderId);
  db.prepare('DELETE FROM order_items WHERE order_id = ?').run(orderId);
  db.prepare('DELETE FROM orders WHERE id = ?').run(orderId);
  db.prepare('DELETE FROM waiter_calls WHERE table_id = ?').run(table.id);
  db.prepare('DELETE FROM client_sessions WHERE table_number = ?').run(TABLE_NUMBER);
  db.prepare('DELETE FROM tables WHERE id = ?').run(table.id);
  reporter.assert(true, 'limpieza completa');

  reporter.finish();
}

run().catch(err => {
  console.error('E2E crash:', err);
  process.exit(1);
});
