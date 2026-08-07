/**
 * Integración — PUT /api/orders/:id incremental (A5/2.5)
 *
 * BUG: el PUT hacía DELETE + INSERT de TODOS los items → lost update si
 * otro agente (KDS cancelando items, otro mesero) tocaba el pedido a la vez.
 *
 * Contrato NUEVO (incremental):
 *   { notes?, items: [{ id?, menu_item_id, quantity, modifiers? }], remove_item_ids?: [] }
 *   - item con `id` existente → UPDATE (cantidad/modifiers) de ESE item
 *   - item sin `id`          → INSERT (nuevo)
 *   - remove_item_ids        → DELETE solo esos
 *   - los items NO mencionados se CONSERVAN (nada se borra implícitamente)
 *   - el server RECALCULA subtotal/iva/total
 *
 * Retrocompat: si el cliente manda la lista completa sin ids, los items se
 * insertan como nuevos y NO se elimina nada (la eliminación solo es
 * explícita vía remove_item_ids).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_DB = 'data/test-put-incremental.db';

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

let tableCounter = 60;

async function ensureTable(number) {
  const tables = await api('/api/tables', { token: adminToken });
  const existing = tables.json?.tables?.find(t => t.number === number);
  if (existing) return existing.id;
  const created = await api('/api/tables', {
    method: 'POST', token: adminToken,
    body: { number, capacity: 4, section: 'e2e' },
  });
  return created.json?.table?.id;
}

async function getMenuItems(n = 2) {
  const menu = await api('/api/menu/items');
  const priced = menu.json?.items?.filter(i => i.price != null && i.area === 'bar');
  return priced.slice(0, n);
}

/** Crea un pedido con los items dados y devuelve { orderId, items (con ids) } */
async function createOrderWithItems(tableId, menuItems) {
  const create = await api('/api/orders', {
    method: 'POST', token: meseroToken,
    body: { table_id: tableId, items: menuItems.map(m => ({ menu_item_id: m.id, quantity: 1 })) },
  });
  const order = create.json?.order;
  return { orderId: order.id, items: order.items };
}

async function getOrder(orderId) {
  const r = await api(`/api/orders/${orderId}`, { token: meseroToken });
  return r.json?.order;
}

describe('2.5 — PUT /:id incremental (conserva lo no mencionado)', () => {
  it('PUT con 1 item NUEVO (sin id) → se AGREGA; los 2 originales se conservan; total recalculado', async () => {
    const tableId = await ensureTable(++tableCounter);
    const [a, b, c] = await getMenuItems(3);
    const { orderId, items } = await createOrderWithItems(tableId, [a, b]);
    expect(items).toHaveLength(2);
    const originalTotal = (await getOrder(orderId)).total;

    const put = await api(`/api/orders/${orderId}`, {
      method: 'PUT', token: meseroToken,
      body: { items: [{ menu_item_id: c.id, quantity: 2 }] }, // sin id → nuevo
    });
    expect(put.status).toBe(200);
    expect(put.json.success).toBe(true);

    const after = await getOrder(orderId);
    expect(after.items).toHaveLength(3); // 2 originales + 1 nuevo
    const expectedNewTotal = Math.round((originalTotal + c.price * 2) * 100) / 100;
    expect(after.total).toBe(expectedNewTotal);
    // El item nuevo quedó con el precio del menú
    const newItem = after.items.find(i => i.menu_item_id === c.id && i.quantity === 2);
    expect(newItem).toBeTruthy();
  });

  it('PUT con item que trae id existente → UPDATE solo de ESE item (cantidad), el resto intacto', async () => {
    const tableId = await ensureTable(++tableCounter);
    const [a, b] = await getMenuItems(2);
    const { orderId, items } = await createOrderWithItems(tableId, [a, b]);
    const itemA = items.find(i => i.menu_item_id === a.id);

    const put = await api(`/api/orders/${orderId}`, {
      method: 'PUT', token: meseroToken,
      body: { items: [{ id: itemA.id, menu_item_id: a.id, quantity: 5 }] },
    });
    expect(put.status).toBe(200);

    const after = await getOrder(orderId);
    expect(after.items).toHaveLength(2); // NO se duplicó ni borró nada
    const updatedA = after.items.find(i => i.id === itemA.id);
    expect(updatedA.quantity).toBe(5);
    expect(updatedA.subtotal).toBe(Math.round(a.price * 5 * 100) / 100);
    // El item B sigue igual
    const itemB = after.items.find(i => i.menu_item_id === b.id);
    expect(itemB.quantity).toBe(1);
    // Total recalculado
    const expectedTotal = Math.round((a.price * 5 + b.price) * 100) / 100;
    expect(after.total).toBe(expectedTotal);
  });

  it('PUT con remove_item_ids → elimina SOLO esos; el resto se conserva', async () => {
    const tableId = await ensureTable(++tableCounter);
    const [a, b, c] = await getMenuItems(3);
    const { orderId, items } = await createOrderWithItems(tableId, [a, b, c]);
    const itemB = items.find(i => i.menu_item_id === b.id);

    const put = await api(`/api/orders/${orderId}`, {
      method: 'PUT', token: meseroToken,
      body: { remove_item_ids: [itemB.id] },
    });
    expect(put.status).toBe(200);

    const after = await getOrder(orderId);
    expect(after.items).toHaveLength(2);
    expect(after.items.some(i => i.id === itemB.id)).toBe(false);
    const expectedTotal = Math.round((a.price + c.price) * 100) / 100;
    expect(after.total).toBe(expectedTotal);
  });

  it('PUT sin items (solo notes) → NO toca los items (retrocompat con edición de notas)', async () => {
    const tableId = await ensureTable(++tableCounter);
    const [a, b] = await getMenuItems(2);
    const { orderId, items } = await createOrderWithItems(tableId, [a, b]);

    const put = await api(`/api/orders/${orderId}`, {
      method: 'PUT', token: meseroToken,
      body: { notes: 'Sin cebolla' },
    });
    expect(put.status).toBe(200);

    const after = await getOrder(orderId);
    expect(after.notes).toBe('Sin cebolla');
    expect(after.items).toHaveLength(items.length); // ningún item tocado
  });

  it('pedido paid/cancelled → PUT rechazado 409 (no se muta un pedido cerrado)', async () => {
    const tableId = await ensureTable(++tableCounter);
    const [a] = await getMenuItems(1);
    const { orderId } = await createOrderWithItems(tableId, [a]);
    const { total } = await getOrder(orderId);

    await api('/api/payments', {
      method: 'POST', token: meseroToken,
      body: { order_id: orderId, amount: total, method: 'cash' },
    });

    const put = await api(`/api/orders/${orderId}`, {
      method: 'PUT', token: meseroToken,
      body: { items: [{ menu_item_id: a.id, quantity: 9 }] },
    });
    expect(put.status).toBe(409);
    expect(put.json.code).toBe('ORDER_CLOSED');
  });
});
