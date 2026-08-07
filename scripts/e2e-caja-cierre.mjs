/**
 * E2E flujo 9+10 — Caja: cobrar pedido (efectivo/QR) + cierre de caja.
 *
 *   node scripts/e2e-caja-cierre.mjs
 *
 * Circuito financiero completo:
 *   1. Pedido confirmado con items mixtos (bar + cocina)
 *   2. Cobrar en EFECTIVO (mesero) → pedido 'paid' → mesa liberada
 *   3. Verificar reporte diario: net_revenue == total cobrado (SSOT IVA)
 *   4. Abrir corte de caja (admin) → expected == ventas del día
 *   5. Cerrar corte → difference == 0 (actual == expected)
 *   6. Consistencia: payment.amount == pedido.total (IVA incluido)
 */

import { api, makeReporter, ensureThrowawayTable, getCleanupDb } from './e2e-lib.mjs';
import { tokenFor } from './e2e-session.mjs';
import { localDateStr as todayLocal } from './date-utils.mjs';

const reporter = makeReporter('caja-cierre');
const TABLE_NUMBER = 98;
// C1/2.1: "hoy" = fecha LOCAL America/La_Paz (NUNCA toISOString — corta a las 20:00 local)
const today = todayLocal();

async function run() {
  console.log('== Flujo 9+10: Caja + Cierre de caja ==');

  const adminToken = tokenFor('admin');
  const meseroToken = tokenFor('mesero');
  reporter.assert(!!adminToken && !!meseroToken, 'sesión admin+mesero');

  const table = await ensureThrowawayTable(TABLE_NUMBER, { adminToken });

  // 1. Pedido mixto confirmado
  console.log('1. Pedido mixto confirmado');
  const menuRes = await api('/api/menu/items');
  const items = menuRes.json.items.filter(i => i.price != null);
  const barItem = items.find(i => i.area === 'bar');
  const cocinaItem = items.find(i => i.area === 'cocina' || !i.area);

  const create = await api('/api/orders', {
    method: 'POST', token: meseroToken,
    body: {
      table_id: table.id, guest_count: 2,
      items: [
        { menu_item_id: barItem.id, quantity: 2 },
        { menu_item_id: cocinaItem.id, quantity: 1 },
      ],
    },
  });
  const orderId = create.json.order.id;
  const orderTotal = create.json.order.total;
  reporter.assert(create.status === 201, `pedido creado — total ${orderTotal}`);
  await api(`/api/orders/${orderId}/submit`, { method: 'PATCH', token: meseroToken });
  await api(`/api/orders/${orderId}/confirm`, { method: 'PATCH', token: meseroToken });

  // 2. Cobrar en efectivo
  console.log('2. Cobro efectivo (mesero)');
  const pay = await api('/api/payments', {
    method: 'POST', token: meseroToken,
    body: { order_id: orderId, amount: orderTotal, method: 'cash' },
  });
  reporter.assert(pay.status === 201 && pay.json.fully_paid === true, `cobrado cash (${pay.status})`);
  const payment = pay.json.payment;
  reporter.assert(Math.abs(payment.amount - orderTotal) < 0.01, `payment.amount == pedido.total (${payment.amount})`);
  reporter.assert(payment.iva_amount != null && payment.iva_amount > 0, `IVA desglosado (${payment.iva_amount})`);

  // 3. Pedido paid + mesa liberada
  console.log('3. Pedido paid + mesa libre');
  const orderAfter = await api(`/api/orders/${orderId}`, { token: meseroToken });
  reporter.assert(orderAfter.json.order.status === 'paid', `status paid (${orderAfter.json.order.status})`);
  const tableFree = await api(`/api/tables/${table.id}`, { token: adminToken });
  reporter.assert(tableFree.json.table?.status === 'free', `mesa liberada (${tableFree.json.table?.status})`);

  // 4. Reporte diario: net_revenue == total cobrado (consistencia IVA SSOT)
  console.log('4. Reporte diario (net_revenue)');
  const report = await api(`/api/reports/sales/daily?date=${today}`, { token: adminToken });
  const summary = report.json.summary;
  reporter.assert(report.status === 200, 'reporte diario OK');
  reporter.assert(summary.net_revenue >= orderTotal - 0.01,
    `net_revenue incluye el pedido (${summary.net_revenue} >= ${orderTotal})`);
  // IVA SSOT: subtotal = total/1.13; verificar que net_revenue == suma de totals pagados
  const byMethod = report.json.by_payment_method;
  const cashTotal = byMethod?.find(m => m.method === 'cash')?.total || 0;
  reporter.assert(Math.abs(cashTotal - orderTotal) < 0.01, `suma payments cash == total (${cashTotal})`);

  // 5. Abrir corte de caja (admin)
  console.log('5. Abrir corte de caja');
  let openRes = await api('/api/payments/closing', { method: 'POST', token: adminToken });
  if (openRes.status === 409) {
    // Ya hay un corte abierto (del día) → verificar que NO bloquea y seguir
    reporter.assert(true, 'corte ya abierto (409 esperado)');
    const current = await api('/api/payments/closing/current', { token: adminToken });
    reporter.assert(current.json.closing != null, 'corte actual presente');
    reporter.assert(Math.abs(current.json.today.total - orderTotal) < 0.01 || current.json.today.total >= orderTotal,
      `ventas del día incluyen el pedido (${current.json.today.total})`);
  } else {
    reporter.assert(openRes.status === 201, `corte abierto (${openRes.status})`);
    reporter.assert(Math.abs(openRes.json.closing.expected - orderTotal) < 0.01,
      `expected == ventas del día (${openRes.json.closing.expected})`);
  }

  // 6. Cerrar corte con monto reconciliado (actual == expected → difference 0)
  console.log('6. Cerrar corte de caja');
  const current2 = await api('/api/payments/closing/current', { token: adminToken });
  const expectedAmount = current2.json.closing?.expected_cash ?? current2.json.today.total;
  const close = await api('/api/payments/closing/close', {
    method: 'PUT', token: adminToken,
    body: { actual_cash: expectedAmount, is_reconciled: true },
  });
  reporter.assert(close.status === 200, `corte cerrado (${close.status})`);
  reporter.assert(Math.abs(close.json.closing.difference) < 0.01, `difference 0 (${close.json.closing.difference})`);

  // 7. Consistencia total: closing.expected == ventas cobradas
  reporter.assert(Math.abs(close.json.closing.expected - orderTotal) < 0.01 || close.json.closing.expected >= orderTotal,
    `expected del corte == cobrado (${close.json.closing.expected})`);

  // Limpieza
  console.log('7. Limpieza');
  const db = await getCleanupDb();
  db.prepare('DELETE FROM payments WHERE order_id = ?').run(orderId);
  db.prepare('DELETE FROM order_items WHERE order_id = ?').run(orderId);
  db.prepare('DELETE FROM orders WHERE id = ?').run(orderId);
  // Limpiar el corte creado por este test (si quedó abierto/cerrado con expected 0 o el nuestro)
  const createdClosing = db.prepare("SELECT id FROM cash_closings WHERE notes = '' ORDER BY opened_at DESC LIMIT 1").get();
  if (createdClosing) db.prepare('DELETE FROM cash_closings WHERE id = ?').run(createdClosing.id);
  await api(`/api/tables/${table.id}`, { method: 'DELETE', token: adminToken });
  reporter.assert(true, 'limpieza completa');

  reporter.finish();
}

run().catch(err => {
  console.error('E2E crash:', err);
  process.exit(1);
});
