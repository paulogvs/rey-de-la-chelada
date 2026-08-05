/**
 * E2E flujo 11 — Admin: gestionar menú (item con área), mesas, staff, QR.
 *
 *   node scripts/e2e-admin.mjs
 *
 *   - Menú: crear item con area, editar precio, toggle activo
 *   - Mesas: crear, editar, eliminar
 *   - Staff: listar, cambiar display_name
 *   - QR estático: POST /api/client-sessions (admin) → url estable
 */

import { api, makeReporter } from './e2e-lib.mjs';
import { tokenFor } from './e2e-session.mjs';

const reporter = makeReporter('admin');
const ITEM_NAME = `E2E Item ${Date.now()}`;
const TABLE_NUMBER = 97; // throwaway reutilizado

async function run() {
  console.log('== Flujo 11: Admin ==');

  const adminToken = tokenFor('admin');
  reporter.assert(!!adminToken, 'sesión admin');
  if (!adminToken) reporter.finish();

  // 1. Menú: crear item con área
  console.log('1. Crear item de menú (área bar)');
  const cats = await api('/api/menu/categories');
  const cat = cats.json.categories?.[0];
  reporter.assert(!!cat, 'categoría disponible');
  const createItem = await api('/api/menu/items', {
    method: 'POST', token: adminToken,
    body: {
      category_id: cat.id, name: ITEM_NAME, description: 'Item E2E temporal',
      price: 25, area: 'bar', is_active: true, is_available: true,
      iva_percentage: 13, preparation_time: 5, sort_order: 999,
    },
  });
  reporter.assert(createItem.status === 201 && createItem.json.item, `item creado (${createItem.status})`);
  const itemId = createItem.json.item.id;

  // 2. Editar precio
  console.log('2. Editar precio del item');
  const edit = await api(`/api/menu/items/${itemId}`, {
    method: 'PUT', token: adminToken, body: { price: 30 },
  });
  reporter.assert(edit.status === 200, `precio editado (${edit.status})`);
  const verify = await api(`/api/menu/items/${itemId}`);
  reporter.assert(verify.json.item?.price === 30, `precio verificado (${verify.json.item?.price})`);
  reporter.assert(verify.json.item?.area === 'bar', `área bar (${verify.json.item?.area})`);

  // 3. Toggle desactivar
  console.log('3. Toggle activo');
  const toggle = await api(`/api/menu/items/${itemId}/toggle`, { method: 'PATCH', token: adminToken });
  reporter.assert(toggle.status === 200, `toggle (${toggle.status})`);
  const afterToggle = await api(`/api/menu/items/${itemId}`);
  // SQLite devuelve 0/1 entero — check falsy
  reporter.assert(!afterToggle.json.item?.is_active, 'item inactivo tras toggle');

  // 4. Mesas: crear throwaway (idempotente)
  console.log('4. Crear mesa');
  const listTables = await api('/api/tables', { token: adminToken });
  let tableId = listTables.json.tables?.find(t => t.number === TABLE_NUMBER)?.id;
  if (tableId) {
    console.log('  (mesa ya existe — reutilizada)');
    reporter.assert(true, 'mesa existente');
  } else {
    const createTable = await api('/api/tables', {
      method: 'POST', token: adminToken,
      body: { number: TABLE_NUMBER, capacity: 4, section: 'admin-e2e' },
    });
    reporter.assert(createTable.status === 201 && createTable.json.table, `mesa creada (${createTable.status})`);
    tableId = createTable.json.table?.id;
  }

  // 5. Editar mesa
  const editTable = await api(`/api/tables/${tableId}`, {
    method: 'PUT', token: adminToken, body: { capacity: 6 },
  });
  reporter.assert(editTable.status === 200, `mesa editada (${editTable.status})`);

  // 6. Staff: listar + editar display_name
  console.log('5. Staff');
  const staff = await api('/api/staff', { token: adminToken });
  reporter.assert(staff.status === 200 && staff.json.staff?.length >= 3, `staff listado (${staff.json.staff?.length})`);
  const kdsUser = staff.json.staff.find(s => s.role === 'kds');
  const editStaff = await api(`/api/staff/${kdsUser.id}`, {
    method: 'PUT', token: adminToken,
    body: { display_name: 'KDS Barra' },
  });
  reporter.assert(editStaff.status === 200, `staff editado (${editStaff.status})`);
  // Restaurar nombre original para no ensuciar
  await api(`/api/staff/${kdsUser.id}`, {
    method: 'PUT', token: adminToken, body: { display_name: kdsUser.display_name },
  });

  // 7. QR estático de mesa (admin)
  console.log('6. QR estático de mesa');
  const qr = await api('/api/client-sessions', {
    method: 'POST', token: adminToken,
    body: { tableNumber: TABLE_NUMBER },
  });
  reporter.assert(qr.status === 201 && qr.json.sessionId, `QR creado (${qr.status})`);
  reporter.assert(qr.json.url.includes(`mesa=${TABLE_NUMBER}`), `url QR: ${qr.json.url}`);
  // Validar que el QR resuelve a sesión válida
  const validate = await api(`/api/client-sessions/${qr.json.sessionId}/validate?mesa=${TABLE_NUMBER}`);
  reporter.assert(validate.status === 200, `sesión QR válida (${validate.status})`);

  // Limpieza
  console.log('7. Limpieza');
  process.env.DB_PATH = process.env.E2E_DB_PATH || 'data/test-e2e.db';
  const { getDb } = await import('../server/db/index.js');
  const db = getDb();
  db.prepare('DELETE FROM menu_items WHERE id = ?').run(itemId);
  db.prepare('DELETE FROM client_sessions WHERE session_id = ?').run(qr.json.sessionId);
  // Mesa: borrar dependencias (pedidos + sesiones + calls de la mesa)
  const orphans = db.prepare('SELECT id FROM orders WHERE table_id = ?').all(tableId);
  for (const o of orphans) {
    db.prepare('DELETE FROM payments WHERE order_id = ?').run(o.id);
    db.prepare('DELETE FROM order_items WHERE order_id = ?').run(o.id);
    db.prepare('DELETE FROM orders WHERE id = ?').run(o.id);
  }
  db.prepare('DELETE FROM client_sessions WHERE table_number = ?').run(TABLE_NUMBER);
  db.prepare('DELETE FROM waiter_calls WHERE table_id = ?').run(tableId);
  db.prepare('DELETE FROM tables WHERE id = ?').run(tableId);
  reporter.assert(true, 'limpieza completa');
  reporter.finish();
}

run().catch(err => {
  console.error('E2E crash:', err);
  process.exit(1);
});
