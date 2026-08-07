/**
 * Integración — Mesa free tras pago (A3/2.4)
 *
 * Confirmación del invariante SERVER-side que hace seguro quitar el
 * "force-free" del cliente (PaymentPanel.tsx llamaba PUT /api/tables/:id
 * con status 'free' — forzaba la mesa libre incluso con OTRO pedido activo).
 *
 * El servidor (processPayment en payments.js) ya libera la mesa SOLO si no
 * hay otros pedidos activos:
 *   1. Un pedido pagado → mesa 'free'.
 *   2. Dos pedidos en la misma mesa → pagar 1 → mesa sigue 'occupied'
 *      (hay otro pedido activo); pagar el 2º → mesa 'free'.
 *
 * Patrón: server real con DB_PATH = temp.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_DB = 'data/test-table-free.db';

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

let tableCounter = 70;

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

async function createOrderOnTable(tableId, qty = 1) {
  const menu = await api('/api/menu/items');
  const item = menu.json?.items?.find(i => i.price != null && i.area === 'bar');
  const create = await api('/api/orders', {
    method: 'POST', token: meseroToken,
    body: { table_id: tableId, items: [{ menu_item_id: item.id, quantity: qty }] },
  });
  const order = create.json?.order;
  return { orderId: order.id, total: order.total };
}

async function tableStatus(tableId) {
  const r = await api(`/api/tables/${tableId}`, { token: adminToken });
  return r.json?.table?.status;
}

describe('2.4 — la mesa se libera server-side (sin force-free del cliente)', () => {
  it('un pedido pagado → mesa free (el server la libera)', async () => {
    const tableId = await ensureTable(++tableCounter);
    const { orderId, total } = await createOrderOnTable(tableId);
    expect(await tableStatus(tableId)).toBe('occupied');

    const pay = await api('/api/payments', {
      method: 'POST', token: meseroToken,
      body: { order_id: orderId, amount: total, method: 'cash' },
    });
    expect(pay.status).toBe(201);
    expect(pay.json.fully_paid).toBe(true);

    expect(await tableStatus(tableId)).toBe('free');
  });

  it('DOS pedidos en la misma mesa: pagar 1 → mesa SIGUE occupied; pagar el 2º → free', async () => {
    const tableId = await ensureTable(++tableCounter);
    const a = await createOrderOnTable(tableId);
    const b = await createOrderOnTable(tableId);
    expect(await tableStatus(tableId)).toBe('occupied');

    // Pagar SOLO el primer pedido → queda otro activo → la mesa NO se libera
    const payA = await api('/api/payments', {
      method: 'POST', token: meseroToken,
      body: { order_id: a.orderId, amount: a.total, method: 'cash' },
    });
    expect(payA.json.fully_paid).toBe(true);
    expect(await tableStatus(tableId)).toBe('occupied');

    // Pagar el segundo → ya no quedan activos → la mesa se libera
    const payB = await api('/api/payments', {
      method: 'POST', token: meseroToken,
      body: { order_id: b.orderId, amount: b.total, method: 'cash' },
    });
    expect(payB.json.fully_paid).toBe(true);
    expect(await tableStatus(tableId)).toBe('free');
  });
});
