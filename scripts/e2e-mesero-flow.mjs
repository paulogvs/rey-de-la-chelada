/**
 * E2E smoke test — full mesero flow over HTTP (real server, real DB).
 *
 * Flow: login (PIN 1111) → list tables → create order (draft) →
 * submit (called) → confirm (confirmed) → list waiter-calls →
 * create client call → accept → process payment → table free.
 *
 * Uses a THROWAWAY table (number 99) to avoid touching real data.
 * Requires the dev server running on PORT 3002 (npm run dev:server).
 */

const BASE = process.env.SMOKE_BASE || 'http://localhost:3002';
const MESERO_PIN = '1111';

let token = null;
const failures = [];

function assert(cond, label) {
  if (cond) {
    console.log(`  ✓ ${label}`);
  } else {
    failures.push(label);
    console.error(`  ✗ ${label}`);
  }
}

async function api(path, { method = 'GET', body, auth = false } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

async function run() {
  console.log('== Mesero flow E2E ==');

  // 1. Login
  console.log('1. Login (PIN 1111)');
  const login = await api('/api/auth/login', { method: 'POST', body: { pin: MESERO_PIN } });
  assert(login.status === 200 && login.json.token, 'login returns token');
  token = login.json.token;
  assert(login.json.user?.role === 'mesero', `role = ${login.json.user?.role}`);

  // 2. Tables
  console.log('2. List tables');
  const tables = await api('/api/tables', { auth: true });
  assert(tables.status === 200 && tables.json.tables?.length > 0, 'tables listed');
  const target = tables.json.tables.find(t => t.number === 99);

  // 3. Create a throwaway table 99 (admin only — use admin PIN)
  console.log('3. Ensure throwaway table 99');
  let table99 = target;
  if (!table99) {
    const adminLogin = await api('/api/auth/login', { method: 'POST', body: { pin: '0000' } });
    token = adminLogin.json.token; // switch to admin BEFORE creating
    const create = await api('/api/tables', {
      method: 'POST',
      auth: true,
      body: { number: 99, capacity: 4, section: 'smoke' },
    });
    table99 = create.json.table;
    assert(create.status === 201 && table99, 'table 99 created');
    token = login.json.token; // back to mesero
  } else {
    console.log('  (table 99 exists)');
  }

  // 4. Menu — pick first active item with price
  console.log('4. Fetch menu');
  const menu = await api('/api/menu/items');
  const priced = menu.json.items?.find(i => i.price != null) || menu.json.items?.[0];
  assert(priced, 'menu has items');

  // 5. Create order (draft)
  console.log('5. Create order');
  const createOrder = await api('/api/orders', {
    method: 'POST',
    auth: true,
    body: {
      table_id: table99.id,
      guest_count: 2,
      items: [{ menu_item_id: priced.id, quantity: 2 }],
    },
  });
  assert(createOrder.status === 201 && createOrder.json.order, 'order created (draft)');
  const orderId = createOrder.json.order.id;
  assert(createOrder.json.order.status === 'draft', `status = draft`);

  // 6. Submit (draft → called)
  console.log('6. Submit order');
  const submit = await api(`/api/orders/${orderId}/submit`, { method: 'PATCH', auth: true });
  assert(submit.status === 200 && submit.json.status === 'called', 'submitted (called)');

  // 7. Confirm (called → confirmed → KDS)
  console.log('7. Confirm order');
  const confirm = await api(`/api/orders/${orderId}/confirm`, { method: 'PATCH', auth: true });
  assert(confirm.status === 200 && confirm.json.status === 'confirmed', 'confirmed');

  // 8. Waiter calls — create a client call for table 99
  console.log('8. Waiter call lifecycle');
  const call = await api('/api/waiter-calls', {
    method: 'POST',
    body: { table_id: table99.id, table_number: 99, session_id: 'smoke-sess', call_type: 'call_waiter' },
  });
  assert(call.status === 201 && call.json.call, 'client call created');
  const callId = call.json.call.id;

  const calls = await api('/api/waiter-calls', { auth: true });
  assert(calls.json.calls?.some(c => c.id === callId), 'call listed for mesero');

  const accept = await api(`/api/waiter-calls/${callId}/accept`, { method: 'PATCH', auth: true });
  assert(accept.status === 200, 'call accepted');

  const done = await api(`/api/waiter-calls/${callId}/done`, { method: 'PATCH', auth: true });
  assert(done.status === 200, 'call done');

  // 9. Payment (cash, full amount)
  console.log('9. Process payment');
  const pay = await api('/api/payments', {
    method: 'POST',
    auth: true,
    body: { order_id: orderId, amount: createOrder.json.order.total, method: 'cash' },
  });
  assert(pay.status === 201 && pay.json.fully_paid === true, 'payment processed (fully paid)');

  // 10. Clear table
  console.log('10. Clear table');
  const clearTable = await api(`/api/tables/${table99.id}`, {
    method: 'PUT',
    auth: true,
    body: { status: 'free' },
  });
  assert(clearTable.status === 200 && clearTable.json.table?.status === 'free', 'table free');

  // 11. Client tracking endpoint (public)
  console.log('11. Client order status (public)');
  const track = await api(`/api/client-orders/${orderId}`);
  // After payment the order is 'paid'; any known status proves tracking works.
  const known = ['called', 'confirmed', 'preparing', 'ready', 'served', 'paid'].includes(track.json.order?.status);
  assert(track.status === 200 && track.json.order?.total != null && known, `public tracking = ${track.json.order?.status}`);

  // ── Cleanup: remove throwaway table 99 + its order + payments ──
  console.log('12. Cleanup');
  // FK: orders → tables. Remove payments, items, order, calls first (direct DB).
  const { getDb } = await import('../server/db/index.js');
  const db = getDb();
  db.prepare('DELETE FROM payments WHERE order_id = ?').run(orderId);
  db.prepare('DELETE FROM order_items WHERE order_id = ?').run(orderId);
  db.prepare('DELETE FROM orders WHERE id = ?').run(orderId);
  db.prepare("DELETE FROM waiter_calls WHERE table_number = 99 AND session_id = 'smoke-sess'").run();
  const adminLogin2 = await api('/api/auth/login', { method: 'POST', body: { pin: '0000' } });
  token = adminLogin2.json.token;
  const del = await api(`/api/tables/${table99.id}`, { method: 'DELETE', auth: true });
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
