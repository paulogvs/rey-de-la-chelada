/**
 * E2E smoke test — complete happy path against the REAL server (PORT 3002).
 *
 * Flow (real server, real DB, throwaway table 99):
 *   1. Admin login (0000) → verify demo prices exist (all items priced,
 *      pizzas have size modifier options with adjustments)
 *   2. Mesero login (1111) → ensure table 99 exists
 *   3. Create order: michelada + pizza with size (Familiar) → verify
 *      server total includes the size adjustment (+20)
 *   4. Submit → Confirm → KDS
 *   5. KDS login (2222) → preparing → ready
 *   6. Mesero marks served
 *   7. Payment (cash, full amount) → order paid
 *   8. Caja daily report shows the revenue (net_revenue includes order)
 *   9. Print flow: build receipt data from the paid order (skip window.print)
 *  10. Cleanup: remove payments, order, waiter calls, table 99
 *
 * Requires: npm run dev:server (PORT 3002) + demo prices applied
 *   (node server/scripts/demo-prices.js).
 */

const BASE = process.env.SMOKE_BASE || 'http://localhost:3002';

const PIN = { admin: '0000', mesero: '1111', kds: '2222' };

let token = null;
const failures = [];
let orderId = null;
let tableId = null;

function assert(cond, label) {
  if (cond) {
    console.log(`  ✓ ${label}`);
  } else {
    failures.push(label);
    console.error(`  ✗ ${label}`);
  }
}

async function api(path, { method = 'GET', body, auth = false, useToken } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  const tk = useToken || token;
  if (auth && tk) headers.Authorization = `Bearer ${tk}`;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

async function login(pin, expectedRole) {
  const res = await api('/api/auth/login', { method: 'POST', body: { pin } });
  assert(res.status === 200 && res.json.token, `login PIN ${pin} → token`);
  if (expectedRole) {
    assert(res.json.user?.role === expectedRole, `role = ${res.json.user?.role}`);
  }
  return res.json.token;
}

async function run() {
  console.log('== Full flow E2E (mesero → KDS → pago → caja → print) ==');

  // ── 1. Admin login + verify demo prices ─────────────────────────
  console.log('1. Demo prices check (admin)');
  token = await login(PIN.admin, 'admin');

  const menu = await api('/api/menu/items');
  const items = menu.json.items || [];
  assert(items.length > 0, 'menu has items');

  const priced = items.filter(i => i.price != null && i.price > 0);
  const nullPrice = items.filter(i => i.price == null);
  assert(priced.length > 0, `priced items exist (${priced.length})`);
  assert(nullPrice.length === 0, `no items left without price (${nullPrice.length} null)`);

  // Find a michelada (bar area) and a pizza (has size variants)
  const michelada = items.find(i => i.area === 'bar') || items[0];
  assert(michelada && michelada.price > 0, `michelada priced: ${michelada?.name} = ${michelada?.price}`);

  // Pizza + size modifiers via detail endpoint
  const pizzaCandidates = items.filter(i => i.category_name === 'Pizzas');
  let pizza = null;
  let pizzaOptions = null;
  for (const cand of pizzaCandidates) {
    const detail = await api(`/api/menu/items/${cand.id}`);
    const mods = detail.json.modifiers || [];
    // Flat list of { option_name, option_price } — one entry per size option
    if (mods.some(o => o.option_name === 'Familiar' && o.option_price > 0)) {
      pizza = cand;
      pizzaOptions = mods;
      break;
    }
  }
  assert(pizza != null, 'pizza with priced size options found');
  const familiarOpt = (pizzaOptions || []).find(o => o.option_name === 'Familiar');
  assert(familiarOpt && familiarOpt.option_price > 0, `Familiar size adjustment = +${familiarOpt?.option_price}`);

  // ── 2. Mesero login + throwaway table 99 ────────────────────────
  console.log('2. Mesero + table 99');
  const meseroToken = await login(PIN.mesero, 'mesero');

  const tables = await api('/api/tables', { auth: true, useToken: meseroToken });
  let table99 = (tables.json.tables || []).find(t => t.number === 99);
  if (!table99) {
    token = await login(PIN.admin, 'admin');
    const create = await api('/api/tables', {
      method: 'POST',
      auth: true,
      body: { number: 99, capacity: 4, section: 'e2e' },
    });
    table99 = create.json.table;
    assert(create.status === 201 && table99, 'table 99 created');
  } else {
    console.log('  (table 99 exists)');
  }
  tableId = table99.id;

  // ── 3. Create order: michelada + pizza Familiar ──────────────────
  console.log('3. Create order (michelada + pizza Familiar)');
  token = meseroToken;
  const createRes = await api('/api/orders', {
    method: 'POST',
    auth: true,
    body: {
      table_id: tableId,
      guest_count: 2,
      items: [
        { menu_item_id: michelada.id, quantity: 1 },
        {
          menu_item_id: pizza.id,
          quantity: 1,
          modifiers: [{ groupName: 'Tamaño', optionName: 'Familiar', priceAdjustment: familiarOpt.option_price }],
        },
      ],
    },
  });
  assert(createRes.status === 201 && createRes.json.order, 'order created (draft)');
  orderId = createRes.json.order.id;
  const expectedSubtotal = Math.round((michelada.price + pizza.price + familiarOpt.option_price) * 100) / 100;
  const expectedTotal = Math.round(expectedSubtotal * 1.13 * 100) / 100;
  assert(
    Math.abs(createRes.json.order.total - expectedTotal) < 0.01,
    `server total includes size: ${createRes.json.order.total} ≈ ${expectedTotal}`
  );
  const pizzaItem = createRes.json.order.items.find(i => i.menu_item_id === pizza.id);
  assert(
    pizzaItem && Math.abs(pizzaItem.unit_price - (pizza.price + familiarOpt.option_price)) < 0.01,
    `pizza unit_price includes +${familiarOpt.option_price} (${pizzaItem?.unit_price})`
  );

  // ── 4. Submit → Confirm ──────────────────────────────────────────
  console.log('4. Submit → Confirm');
  const submit = await api(`/api/orders/${orderId}/submit`, { method: 'PATCH', auth: true });
  assert(submit.status === 200 && submit.json.status === 'called', 'submitted (called)');
  const confirm = await api(`/api/orders/${orderId}/confirm`, { method: 'PATCH', auth: true });
  assert(confirm.status === 200 && confirm.json.status === 'confirmed', 'confirmed (KDS)');

  // ── 5. KDS: preparing → ready ────────────────────────────────────
  console.log('5. KDS flow');
  token = await login(PIN.kds, 'kds');
  const kdsView = await api('/api/orders/kds/cocina', { auth: true });
  assert(kdsView.json.orders?.some(o => o.id === orderId), 'order visible in KDS cocina');

  const prep = await api(`/api/orders/${orderId}/status`, { method: 'PATCH', auth: true, body: { status: 'preparing' } });
  assert(prep.status === 200 && prep.json.status === 'preparing', 'KDS → preparing');
  const ready = await api(`/api/orders/${orderId}/status`, { method: 'PATCH', auth: true, body: { status: 'ready' } });
  assert(ready.status === 200 && ready.json.status === 'ready', 'KDS → ready');

  // ── 6. Mesero marks served ───────────────────────────────────────
  console.log('6. Serve');
  token = meseroToken;
  const served = await api(`/api/orders/${orderId}/status`, { method: 'PATCH', auth: true, body: { status: 'served' } });
  assert(served.status === 200 && served.json.status === 'served', 'mesero → served');

  // ── 7. Payment (cash, full amount) ───────────────────────────────
  console.log('7. Payment');
  const orderRes = await api(`/api/orders/${orderId}`, { auth: true });
  const orderTotal = orderRes.json.order.total;
  const pay = await api('/api/payments', {
    method: 'POST',
    auth: true,
    body: { order_id: orderId, amount: orderTotal, method: 'cash' },
  });
  assert(pay.status === 201 && pay.json.fully_paid === true, `payment processed (${orderTotal})`);

  const paidOrder = await api(`/api/orders/${orderId}`, { auth: true });
  assert(paidOrder.json.order.status === 'paid', 'order status = paid');

  // ── 8. Caja daily report shows the revenue ───────────────────────
  console.log('8. Caja daily report');
  token = await login(PIN.admin, 'admin');
  const report = await api('/api/reports/sales/daily', { auth: true });
  assert(report.status === 200 && report.json.summary != null, 'daily report fetched');
  const net = report.json.summary.net_revenue;
  const cash = (report.json.by_payment_method || []).find(p => p.method === 'cash');
  assert(typeof net === 'number' && net >= orderTotal - 0.01, `net_revenue includes order (${net} >= ${orderTotal})`);
  assert(cash && cash.total >= orderTotal - 0.01, `byMethod.cash includes order (${cash?.total} >= ${orderTotal})`);

  // ── 9. Print flow: verify receipt data (skip window.print) ───────
  console.log('9. Print receipt data');
  const receiptOrder = paidOrder.json.order;
  assert(receiptOrder.id === orderId, 'receipt: order id');
  assert(receiptOrder.table_number === 99, 'receipt: table 99');
  assert(receiptOrder.items?.length === 2, 'receipt: 2 items');
  assert(receiptOrder.total > 0, 'receipt: total > 0');
  const receiptLines = receiptOrder.items.map(i => `${i.quantity} x ${i.menu_item_name} = ${i.subtotal}`);
  console.log('  receipt lines:');
  for (const line of receiptLines) console.log(`    - ${line}`);
  assert(receiptLines.length === 2 && receiptLines.every(l => l.length > 0), 'receipt: printable lines built');

  // ── 10. Cleanup ──────────────────────────────────────────────────
  console.log('10. Cleanup');
  const { getDb } = await import('../server/db/index.js');
  const db = getDb();
  db.prepare('DELETE FROM payments WHERE order_id = ?').run(orderId);
  db.prepare('DELETE FROM order_items WHERE order_id = ?').run(orderId);
  db.prepare('DELETE FROM orders WHERE id = ?').run(orderId);
  db.prepare('DELETE FROM waiter_calls WHERE table_id = ?').run(tableId);

  // Reuse the admin token from step 8 (avoid extra login vs authLimiter)
  const del = await api(`/api/tables/${tableId}`, { method: 'DELETE', auth: true });
  assert(del.status === 200, 'table 99 deleted');

  console.log('');
  if (failures.length > 0) {
    console.error(`FAILED: ${failures.length} check(s): ${failures.join(', ')}`);
    process.exit(1);
  }
  console.log('ALL CHECKS PASSED ✅');
}

run().catch(err => {
  console.error('E2E crashed:', err);
  process.exit(1);
});
