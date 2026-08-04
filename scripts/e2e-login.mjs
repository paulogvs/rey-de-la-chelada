/**
 * E2E flujo 1 — Login: 3 roles + PIN incorrecto + auth round-trip.
 *
 *   node scripts/e2e-login.mjs
 *
 * Roles: admin 0000, mesero 1111, kds 2222.
 *
 * DISEÑO CONTRA RATE LIMIT (hallazgo FASE 2):
 * authLimiter = 5 requests/min por IP sobre TODO /api/auth/* (login,
 * me, logout). Un E2E con 6+ requests auth en el mismo minuto recibe
 * 429 (AUTH_RATE_LIMIT). Este script se queda en 5 requests auth:
 *   1. admin login   2. mesero login   3. kds login
 *   4. PIN incorrecto (401)   5. me con token admin (200)
 * Logout y navegación-sin-auth se cubren en flujos con sesión fresca.
 */

import { api, login, makeReporter } from './e2e-lib.mjs';

const reporter = makeReporter('login');

async function run() {
  console.log('== Flujo 1: Login (3 roles) ==');

  // 1. Admin
  console.log('1. Admin (0000)');
  const admin = await login('0000');
  reporter.assert(admin.ok, 'admin login OK');
  reporter.assert(admin.user?.role === 'admin', `role = admin (${admin.user?.role})`);
  reporter.assert(admin.token?.length > 20, 'token presente');
  const adminToken = admin.token;

  // 2. Mesero
  console.log('2. Mesero (1111)');
  const mesero = await login('1111');
  reporter.assert(mesero.ok, 'mesero login OK');
  reporter.assert(mesero.user?.role === 'mesero', `role = mesero (${mesero.user?.role})`);

  // 3. KDS
  console.log('3. KDS (2222)');
  const kds = await login('2222');
  reporter.assert(kds.ok, 'kds login OK');
  reporter.assert(kds.user?.role === 'kds', `role = kds (${kds.user?.role})`);

  // 4. PIN incorrecto → rechazo
  console.log('4. PIN incorrecto (9999) → debe rechazar');
  const bad = await login('9999');
  reporter.assert(!bad.ok, 'PIN incorrecto rechazado');
  reporter.assert(bad.status === 401, `HTTP 401 (${bad.status})`);

  // 5. /api/auth/me con token válido (round-trip — 5º request auth)
  console.log('5. Auth round-trip (me)');
  const me = await api('/api/auth/me', { token: adminToken });
  reporter.assert(me.status === 200 && me.json?.user?.role === 'admin', 'me devuelve admin');

  // 6. Ruta protegida sin auth → 401 (NO cuenta contra authLimiter)
  console.log('6. Ruta protegida sin auth → 401');
  const noAuthOrders = await api('/api/orders');
  reporter.assert(noAuthOrders.status === 401, `GET /api/orders sin token → 401 (${noAuthOrders.status})`);
  const noAuthKds = await api('/api/orders/kds/cocina');
  reporter.assert(noAuthKds.status === 401, `GET /api/orders/kds/cocina sin token → 401 (${noAuthKds.status})`);

  reporter.finish();
}

run().catch(err => {
  console.error('E2E crash:', err);
  process.exit(1);
});
