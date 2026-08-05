/**
 * E2E flujo 3 — Mesero crea pedido MIXTO → KDS cocina vs KDS bar separados.
 *
 *   node scripts/e2e-kds-separado.mjs
 *
 * Valida el corazón de FASE 1:
 *   - pedido con items bar + cocina
 *   - GET /api/orders/kds/cocina → SOLO comidas (pizza etc.)
 *   - GET /api/orders/kds/bar     → SOLO bebidas (micheladas etc.)
 *   - cada pedido mantiene su mesa, mesero y estado
 *   - limpieza completa al final (pedido + mesa throwaway)
 */

import { api, makeReporter, getMenu, ensureThrowawayTable, pickMixedItems, getCleanupDb } from './e2e-lib.mjs';
import { tokenFor } from './e2e-session.mjs';

const reporter = makeReporter('kds-separado');
const TABLE_NUMBER = 91; // throwaway

async function run() {
  console.log('== Flujo 3: KDS separado (bar vs cocina) ==');

  // 1. Tokens de sesión compartida (evita rate limit)
  console.log('1. Tokens de sesión');
  const adminToken = tokenFor('admin');
  const meseroToken = tokenFor('mesero');
  const kdsToken = tokenFor('kds');
  reporter.assert(!!adminToken && !!meseroToken && !!kdsToken, 'sesión admin+mesero+kds');
  if (!adminToken || !meseroToken || !kdsToken) {
    console.error('  → Ejecuta primero: node scripts/e2e-session.mjs');
    reporter.finish();
  }

  // 2. Mesa throwaway
  console.log('2. Mesa throwaway 91');
  const table = await ensureThrowawayTable(TABLE_NUMBER, { adminToken });
  reporter.assert(table.id != null, `mesa 91 lista (${table.id})`);

  // 3. Items mixtos (2 bebidas DISTINTAS + 1 comida → conteo real por área)
  console.log('3. Items mixtos del menú');
  const menu = await getMenu();
  const mixed = await pickMixedItems();
  const secondBar = menu.barItems.find(i => i.id !== mixed.bar.id);
  reporter.assert(mixed.bar?.area === 'bar', `item bar 1: ${mixed.bar?.name}`);
  reporter.assert(secondBar?.area === 'bar', `item bar 2: ${secondBar?.name}`);
  reporter.assert(mixed.cocina?.area === 'cocina', `item cocina: ${mixed.cocina?.name}`);

  // 4. Crear pedido mixto: 2 bebidas distintas + 1 comida
  console.log('4. Crear pedido mixto (2 bebidas + 1 comida)');
  const create = await api('/api/orders', {
    method: 'POST',
    token: meseroToken,
    body: {
      table_id: table.id,
      guest_count: 2,
      items: [
        { menu_item_id: mixed.bar.id, quantity: 1 },
        { menu_item_id: secondBar.id, quantity: 1 },
        { menu_item_id: mixed.cocina.id, quantity: 1 },
      ],
    },
  });
  reporter.assert(create.status === 201 && create.json?.order, `pedido creado (HTTP ${create.status})`);
  const orderId = create.json.order.id;
  reporter.assert(create.json.order.status === 'draft', 'status draft');

  // 5. Submit → called
  console.log('5. Submit → called');
  const submit = await api(`/api/orders/${orderId}/submit`, { method: 'PATCH', token: meseroToken });
  reporter.assert(submit.status === 200 && submit.json?.status === 'called', `submit → called (${submit.json?.status})`);

  // 6. Confirm → confirmed (entra a KDS)
  console.log('6. Confirm → confirmed (KDS)');
  const confirm = await api(`/api/orders/${orderId}/confirm`, { method: 'PATCH', token: meseroToken });
  reporter.assert(confirm.status === 200 && confirm.json?.status === 'confirmed', `confirm → confirmed (${confirm.json?.status})`);

  // 7. KDS cocina — SOLO comidas
  console.log('7. KDS cocina → solo comidas');
  const cocinaKds = await api('/api/orders/kds/cocina', { token: kdsToken });
  reporter.assert(cocinaKds.status === 200, `kds cocina HTTP 200 (${cocinaKds.status})`);
  const cocinaOrder = cocinaKds.json?.orders?.find(o => o.id === orderId);
  reporter.assert(cocinaOrder != null, 'pedido visible en KDS cocina');
  if (cocinaOrder) {
    const names = cocinaOrder.items.map(i => i.item_name);
    reporter.assert(cocinaOrder.items.length === 1, `cocina ve 1 item (${cocinaOrder.items.length})`);
    reporter.assert(names[0] === mixed.cocina.name, `item cocina = ${mixed.cocina.name}`);
    reporter.assert(cocinaOrder.items.every(i => i.kds_module === 'cocina'), 'todos los items cocina son area=cocina');
  }

  // 8. KDS bar — SOLO bebidas
  console.log('8. KDS bar → solo bebidas');
  const barKds = await api('/api/orders/kds/bar', { token: kdsToken });
  reporter.assert(barKds.status === 200, `kds bar HTTP 200 (${barKds.status})`);
  const barOrder = barKds.json?.orders?.find(o => o.id === orderId);
  reporter.assert(barOrder != null, 'pedido visible en KDS bar');
  if (barOrder) {
    const names = barOrder.items.map(i => i.item_name);
    reporter.assert(barOrder.items.length === 2, `bar ve 2 items (${barOrder.items.length})`);
    reporter.assert(names.every(n => [mixed.bar.name, secondBar.name].includes(n)), 'los 2 items son bebidas');
    reporter.assert(barOrder.items.every(i => i.kds_module === 'bar'), 'todos los items bar son area=bar');
  }

  // 9. Aislamiento: bar NO ve la comida, cocina NO ve las bebidas
  console.log('9. Aislamiento cruzado');
  const cocinaNames = cocinaKds.json?.orders?.find(o => o.id === orderId)?.items?.map(i => i.item_name) || [];
  const barNames = barKds.json?.orders?.find(o => o.id === orderId)?.items?.map(i => i.item_name) || [];
  reporter.assert(!cocinaNames.includes(mixed.bar.name), 'cocina NO ve la bebida');
  reporter.assert(!barNames.includes(mixed.cocina.name), 'bar NO ve la comida');

  // 10. KDS unificado (module=kds) ve AMBOS
  console.log('10. KDS unificado (module=kds) ve ambos');
  const allKds = await api('/api/orders/kds/kds', { token: kdsToken });
  const allOrder = allKds.json?.orders?.find(o => o.id === orderId);
  reporter.assert(allOrder?.items?.length === 3, `kds unificado ve 3 items (${allOrder?.items?.length})`);

  // 11. Limpieza (directa por DB — apunta a la MISMA DB del servidor de
  //     pruebas, vía DB_PATH, NO a la DB de DEV por defecto)
  console.log('11. Limpieza');
  const db = await getCleanupDb();
  db.prepare('DELETE FROM payments WHERE order_id = ?').run(orderId);
  db.prepare('DELETE FROM order_items WHERE order_id = ?').run(orderId);
  db.prepare('DELETE FROM orders WHERE id = ?').run(orderId);
  const del = await api(`/api/tables/${table.id}`, { method: 'DELETE', token: adminToken });
  reporter.assert(del.status === 200, 'mesa 91 eliminada');

  reporter.finish();
}

run().catch(err => {
  console.error('E2E crash:', err);
  process.exit(1);
});
