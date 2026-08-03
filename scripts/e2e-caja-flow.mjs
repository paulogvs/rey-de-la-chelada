/**
 * E2E smoke test — caja (cashier) flow over HTTP (real server, real DB).
 *
 * Flow: login (PIN 0000 admin — no 'caja' role exists) → daily report →
 * opening/closing lifecycle → unauthorized check (mesero PIN cannot access).
 *
 * Requires the dev server running on PORT 3002 (npm run dev:server).
 */

const BASE = process.env.SMOKE_BASE || 'http://localhost:3002';

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
  console.log('== Caja flow E2E ==');

  // 1. Admin login (caja requires role 'admin' — no 'caja' role in seed)
  console.log('1. Login (PIN 0000 admin)');
  const login = await api('/api/auth/login', { method: 'POST', body: { pin: '0000' } });
  assert(login.status === 200 && login.json.token, 'admin login returns token');
  token = login.json.token;
  assert(login.json.user?.role === 'admin', `role = ${login.json.user?.role}`);

  // 2. Unauthorized check: mesero cannot access caja endpoints
  console.log('2. Role guard (mesero denied)');
  const mesero = await api('/api/auth/login', { method: 'POST', body: { pin: '1111' } });
  const meseroToken = mesero.json.token;
  const denied = await fetch(`${BASE}/api/reports/sales/daily`, {
    headers: { Authorization: `Bearer ${meseroToken}` },
  });
  assert(denied.status === 403, `mesero denied daily report (${denied.status})`);

  // 3. Daily report
  console.log('3. Daily sales report');
  const report = await api('/api/reports/sales/daily', { auth: true });
  assert(report.status === 200 && report.json.summary != null, 'daily report fetched');
  assert(typeof report.json.summary.net_revenue === 'number', 'summary has net_revenue');
  console.log(`  report: orders=${report.json.summary.total_orders}, net=${report.json.summary.net_revenue}`);

  // 4. Closing current (may be null if none open)
  console.log('4. Closing current');
  const current = await api('/api/payments/closing/current', { auth: true });
  assert(current.status === 200, 'closing/current fetched');
  assert('closing' in current.json && 'today' in current.json, 'response has closing + today');

  // 5. Open closing
  console.log('5. Open closing');
  const openRes = await api('/api/payments/closing', { method: 'POST', auth: true });
  const openStatusOk = openRes.status === 201 || openRes.status === 409;
  assert(openStatusOk, `open closing (${openRes.status}: ${openRes.json.code || 'ok'})`);
  if (openRes.status === 409) {
    console.log('  (a closing was already open — will close it)');
  }

  // 6. Close closing (find the open one via current)
  console.log('6. Close closing');
  const cur2 = await api('/api/payments/closing/current', { auth: true });
  const openClosing = cur2.json.closing;
  assert(openClosing != null, 'an open closing exists');
  const closeRes = await api('/api/payments/closing/close', {
    method: 'PUT',
    auth: true,
    body: { actual_cash: openClosing.expected_cash ?? 0, is_reconciled: true, notes: 'e2e smoke' },
  });
  assert(closeRes.status === 200 && closeRes.json.closing?.closed_at != null, 'closing closed');
  assert(typeof closeRes.json.closing?.difference === 'number', 'difference computed');

  // 7. After close — current returns null
  console.log('7. Closing current after close');
  const cur3 = await api('/api/payments/closing/current', { auth: true });
  assert(cur3.json.closing == null, 'no open closing remains');

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
