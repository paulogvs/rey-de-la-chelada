/**
 * Integración — Admin CRUD de menú + import-seed (2026-08-25)
 *
 * Cubre el nuevo flujo "el admin gestiona el menú en producción":
 *   POST   /api/menu/items          → crear item
 *   PATCH  /api/menu/items/:id/toggle → activar/desactivar
 *   DELETE /api/menu/items/:id      → borrar SOLO sin pedidos (409 si tiene)
 *   DELETE /api/menu/categories/:id → borrar SOLO vacía (409 si tiene items)
 *   POST   /api/menu/import-seed    → recrea items del seed borrados (no duplica)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_DB = 'data/test-menu-admin.db';

process.env.PORT = '0';
process.env.DB_PATH = TEST_DB;

let server;
let base;
let adminToken;
let meseroToken;

beforeAll(async () => {
  const mod = await import('../../server/index.js');
  server = mod.server;
  let addr = null;
  for (let i = 0; i < 50 && !addr; i++) {
    addr = server.address();
    if (!addr) await new Promise(r => setTimeout(r, 25));
  }
  if (!addr) throw new Error('El server no escuchó en tiempo razonable');
  base = `http://127.0.0.1:${addr.port}`;

  adminToken = await login('0000');
  meseroToken = await login('1111');
});

afterAll(async () => {
  await new Promise(resolve => server.close(resolve));
  const { closeDb } = await import('../../server/db/index.js');
  closeDb();
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(path.resolve(__dirname, '..', '..', TEST_DB + suffix)); } catch { /* noop */ }
  }
});

async function api(p, { method = 'GET', body, token } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${base}${p}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch { /* noop */ }
  return { status: res.status, json };
}

async function login(pin) {
  const r = await api('/api/auth/login', { method: 'POST', body: { pin } });
  return r.json?.token;
}

async function firstBarItem() {
  const menu = await api('/api/menu/items');
  return menu.json?.items?.find(i => i.price != null && i.area === 'bar');
}

describe('Admin CRUD de menú', () => {
  it('POST /api/menu/items crea un item nuevo (admin)', async () => {
    const cats = await api('/api/menu/categories?include_inactive=true', { token: adminToken });
    const cat = cats.json?.categories?.[0];
    expect(cat).toBeTruthy();

    const created = await api('/api/menu/items', {
      method: 'POST', token: adminToken,
      body: { name: 'Item Test CRUD', price: 1234, category_id: cat.id, area: 'bar' },
    });
    expect(created.status).toBe(201);
    expect(created.json?.item?.name).toBe('Item Test CRUD');
    expect(created.json?.item?.price).toBe(1234);
    expect(created.json?.item?.is_active).toBe(1);
  });

  it('PATCH toggle activa/desactiva el item', async () => {
    const menu = await api('/api/menu/items?include_inactive=true');
    const item = menu.json?.items?.find(i => i.name === 'Item Test CRUD');
    expect(item).toBeTruthy();

    const off = await api(`/api/menu/items/${item.id}/toggle`, { method: 'PATCH', token: adminToken });
    expect(off.json?.is_active).toBe(false);

    const on = await api(`/api/menu/items/${item.id}/toggle`, { method: 'PATCH', token: adminToken });
    expect(on.json?.is_active).toBe(true);
  });

  it('DELETE item sin pedidos → 200 (borrado físico permitido)', async () => {
    const menu = await api('/api/menu/items?include_inactive=true');
    const item = menu.json?.items?.find(i => i.name === 'Item Test CRUD');
    expect(item).toBeTruthy();

    const del = await api(`/api/menu/items/${item.id}`, { method: 'DELETE', token: adminToken });
    expect(del.status).toBe(200);
    expect(del.json?.deleted).toBe(true);
  });

  it('DELETE item CON pedidos → 409 ITEM_HAS_ORDERS (nunca rompe historial)', async () => {
    const item = await firstBarItem();
    expect(item).toBeTruthy();

    // Crear mesa (admin) + pedido con el item para "anclarlo" al historial
    const table = await api('/api/tables', {
      method: 'POST', token: adminToken,
      body: { number: 91, capacity: 4, section: 'e2e' },
    });
    expect(table.status).toBe(201);

    const order = await api('/api/orders', {
      method: 'POST', token: meseroToken,
      body: {
        table_id: table.json?.table?.id,
        items: [{ menu_item_id: item.id, quantity: 1 }],
      },
    });
    expect(order.status).toBe(201);

    const del = await api(`/api/menu/items/${item.id}`, { method: 'DELETE', token: adminToken });
    expect(del.status).toBe(409);
    expect(del.json?.code).toBe('ITEM_HAS_ORDERS');
  });

  it('DELETE categoría vacía → 200; con items → 409', async () => {
    // Con items → 409
    const cats = await api('/api/menu/categories?include_inactive=true', { token: adminToken });
    const catWithItems = cats.json?.categories?.find(c => c.name === 'Agua');
    expect(catWithItems).toBeTruthy();
    const blocked = await api(`/api/menu/categories/${catWithItems.id}`, { method: 'DELETE', token: adminToken });
    expect(blocked.status).toBe(409);
    expect(blocked.json?.code).toBe('CATEGORY_NOT_EMPTY');

    // Vacía → 200
    const created = await api('/api/menu/categories', {
      method: 'POST', token: adminToken,
      body: { name: 'Categoría Vacía Test', emoji: '🧪' },
    });
    expect(created.status).toBe(201);
    const del = await api(`/api/menu/categories/${created.json?.category?.id}`, { method: 'DELETE', token: adminToken });
    expect(del.status).toBe(200);
  });

  it('POST /import-seed recrea items del seed borrados y NO duplica los existentes', async () => {
    // Borrar "Vital" (Agua, del seed) — sin pedidos → borrado OK
    const menu = await api('/api/menu/items?include_inactive=true');
    const vital = menu.json?.items?.find(i => i.name === 'Vital');
    expect(vital).toBeTruthy();
    const del = await api(`/api/menu/items/${vital.id}`, { method: 'DELETE', token: adminToken });
    expect(del.status).toBe(200);

    // import-seed → lo recrea
    const imp = await api('/api/menu/import-seed', { method: 'POST', token: adminToken });
    expect(imp.status).toBe(200);
    expect(imp.json?.createdItems?.includes('Vital')).toBe(true);
    expect(imp.json?.skippedItems).toBeGreaterThan(0); // el resto no se duplica

    // Verificar que Vital volvió (recreado desde el seed)
    const after = await api('/api/menu/items');
    const vitalAgain = after.json?.items?.find(i => i.name === 'Vital');
    expect(vitalAgain).toBeTruthy();
  });
});