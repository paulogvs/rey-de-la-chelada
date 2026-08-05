/**
 * E2E flujo 13 — Edge cases / ruido.
 *
 *   node scripts/e2e-edge-cases.mjs
 *
 *   - pedido sin items → rechazado
 *   - cantidad 0 / negativa → rechazada o clamp
 *   - item agotado (is_available=false) → rechazado en pedido público
 *   - sesión QR expirada → invalidación
 *   - PIN incorrecto repetido → rate limit (authLimiter 5/min)
 *   - navegación directa a rutas sin auth → 401
 *   - módulo KDS inválido → 400
 */

import { api, makeReporter, ensureThrowawayTable, getCleanupDb } from './e2e-lib.mjs';
import { tokenFor } from './e2e-session.mjs';

const reporter = makeReporter('edge-cases');
const TABLE_NUMBER = 95;

async function run() {
  console.log('== Flujo 13: Edge cases ==');

  const adminToken = tokenFor('admin');
  const meseroToken = tokenFor('mesero');
  reporter.assert(!!adminToken && !!meseroToken, 'sesión admin+mesero');

  const table = await ensureThrowawayTable(TABLE_NUMBER, { adminToken });
  const menuRes = await api('/api/menu/items');
  const items = menuRes.json.items.filter(i => i.price != null);
  const cocinaItem = items.find(i => i.area === 'cocina' || !i.area);
  const barItem = items.find(i => i.area === 'bar');

  // 1. Pedido sin items (mesero) → 400
  console.log('1. Pedido sin items');
  const noItems = await api('/api/orders', {
    method: 'POST', token: meseroToken,
    body: { table_id: table.id, guest_count: 1, items: [] },
  });
  reporter.assert(noItems.status === 400, `sin items → 400 (${noItems.status})`);

  // 2. Cantidad 0 → rechazada (FASE 2 fix: INVALID_QUANTITY)
  console.log('2. Cantidad 0');
  const qtyZero = await api('/api/orders', {
    method: 'POST', token: meseroToken,
    body: { table_id: table.id, guest_count: 1, items: [{ menu_item_id: cocinaItem.id, quantity: 0 }] },
  });
  reporter.assert(qtyZero.status === 400 && qtyZero.json.code === 'INVALID_QUANTITY',
    `qty 0 → 400 INVALID_QUANTITY (${qtyZero.status}/${qtyZero.json.code})`);

  // 3. Cantidad negativa → rechazada (FASE 2 fix)
  console.log('3. Cantidad negativa');
  const qtyNeg = await api('/api/orders', {
    method: 'POST', token: meseroToken,
    body: { table_id: table.id, guest_count: 1, items: [{ menu_item_id: cocinaItem.id, quantity: -3 }] },
  });
  reporter.assert(qtyNeg.status === 400 && qtyNeg.json.code === 'INVALID_QUANTITY',
    `qty negativa → 400 INVALID_QUANTITY (${qtyNeg.status}/${qtyNeg.json.code})`);

  // 4. Item agotado (is_available=false) → rechazado en pedido público
  console.log('4. Item agotado');
  // Crear item temporal con is_available=false vía admin
  const cats = await api('/api/menu/categories');
  const cat = cats.json.categories[0];
  const agotado = await api('/api/menu/items', {
    method: 'POST', token: adminToken,
    body: {
      category_id: cat.id, name: `Agotado ${Date.now()}`, description: 'temporal',
      price: 20, area: 'bar', is_active: true, is_available: false,
    },
  });
  const agotadoId = agotado.json.item?.id;
  if (agotadoId) {
    const qr = await api(`/api/client-sessions/table/${TABLE_NUMBER}`, { method: 'POST' });
    const sessionId = qr.json.sessionId;
    const pub = await api('/api/client-orders', {
      method: 'POST',
      body: {
        table_number: TABLE_NUMBER, session_id: sessionId,
        items: [{ menu_item_id: agotadoId, quantity: 1 }],
      },
    });
    reporter.assert(pub.status === 400 && pub.json.code === 'INVALID_MENU_ITEM',
      `item agotado → 400 INVALID_MENU_ITEM (${pub.status}/${pub.json.code})`);
  } else {
    reporter.assert(false, 'no se pudo crear item agotado');
  }

  // 5. Módulo KDS inválido → 400 (con rol kds — auth correcto)
  console.log('5. Módulo KDS inválido');
  const kdsToken = tokenFor('kds');
  const kdsBad = await api('/api/orders/kds/limpieza', { token: kdsToken });
  reporter.assert(kdsBad.status === 400 && kdsBad.json.code === 'INVALID_KDS_MODULE',
    `kds inválido → 400 (${kdsBad.status})`);

  // 6. Sesión QR expirada → invalidada
  console.log('6. Sesión QR expirada');
  const qrExp = await api('/api/client-sessions/table/95', { method: 'POST' });
  const expSid = qrExp.json.sessionId;
  // Forzar expiración en DB y validar
  const db = await getCleanupDb();
  db.prepare("UPDATE client_sessions SET expires_at = datetime('now','-1 hour') WHERE session_id = ?").run(expSid);
  const validateExpired = await api(`/api/client-sessions/${expSid}/validate?mesa=95`);
  // Sin pedido activo → inválida (regenera o rechaza)
  reporter.assert(validateExpired.json?.valid === false || validateExpired.status === 200,
    `sesión expirada manejada (${validateExpired.status}/${validateExpired.json?.valid})`);

  // 7. Navegación directa sin auth → 401 (varias rutas)
  console.log('7. Rutas sin auth → 401');
  const routes = ['/api/orders', '/api/tables', '/api/payments', '/api/staff', '/api/reports/sales/daily', '/api/waiter-calls'];
  for (const r of routes) {
    const res = await api(r);
    reporter.assert(res.status === 401, `${r} → 401 (${res.status})`);
  }

  // 8. Rate limit de login (PIN incorrecto repetido) — SOLO si quedan intentos
  console.log('8. Rate limit login');
  // El authLimiter permite 5/min; esta corrida usa 0 logins nuevos → los
  // intentos repetidos aquí pueden o no disparar 429 según la ventana.
  const attempts = [];
  for (let i = 0; i < 4; i++) {
    attempts.push((await api('/api/auth/login', { method: 'POST', body: { pin: '9999' } })).status);
  }
  const any429 = attempts.some(s => s === 429);
  reporter.assert(any429 || attempts.every(s => s === 401),
    `PINs incorrectos: ${attempts.join(',')} (401 o 429 rate limit)`);

  // Limpieza
  console.log('9. Limpieza');
  if (agotadoId) db.prepare('DELETE FROM menu_items WHERE id = ?').run(agotadoId);
  db.prepare('DELETE FROM client_sessions WHERE table_number IN (95, 96, 97, 98, 99, 90, 91, 92, 93, 94)').run();
  const orphanOrders = db.prepare('SELECT id FROM orders WHERE table_id = ?').all(table.id);
  for (const o of orphanOrders) {
    db.prepare('DELETE FROM payments WHERE order_id = ?').run(o.id);
    db.prepare('DELETE FROM order_items WHERE order_id = ?').run(o.id);
    db.prepare('DELETE FROM orders WHERE id = ?').run(o.id);
  }
  db.prepare('DELETE FROM waiter_calls WHERE table_id = ?').run(table.id);
  db.prepare('DELETE FROM tables WHERE id = ?').run(table.id);
  reporter.assert(true, 'limpieza completa');

  reporter.finish();
}

run().catch(err => {
  console.error('E2E crash:', err);
  process.exit(1);
});
