/**
 * Integración — "Nº de transacciones del cierre" = PEDIDOS, no pagos (2026-08-27)
 *
 * Bug: `transactions` se calculaba con COUNT(*) FROM payments WHERE status='completed'.
 * Un pedido pagado con efectivo+QR (mixto) o con retiro QR generaba 2+ filas en
 * `payments` → se contaba como 2+ transacciones aunque fuera UNA sola venta.
 *
 * FIX: COUNT(DISTINCT order_id) — cada pedido pagado cuenta como 1 transacción.
 * Se aplica en AMBOS bloques: /closing/current (breakdown.transactions) y
 * /closing/close (closing.transactions).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_DB = 'data/test-transacciones-pedidos.db';

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
  for (let i = 0; i < 50 && !addr; i++) { addr = server.address(); if (!addr) await new Promise(r => setTimeout(r, 25)); }
  if (!addr) throw new Error('El server no escuchó en tiempo razonable');
  base = `http://127.0.0.1:${addr.port}`;
  adminToken = await login('0000');
  meseroToken = await login('1111');
});

afterAll(async () => {
  await new Promise(resolve => server.close(resolve));
  const { closeDb } = await import('../../server/db/index.js');
  closeDb();
  for (const suffix of ['', '-wal', '-shm']) { try { fs.unlinkSync(path.resolve(__dirname, '..', '..', TEST_DB + suffix)); } catch { /* noop */ } }
});

async function api(p, { method = 'GET', body, token } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${base}${p}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let json = null;
  try { json = await res.json(); } catch { /* noop */ }
  return { status: res.status, json };
}

async function login(pin) { const r = await api('/api/auth/login', { method: 'POST', body: { pin } }); return r.json?.token; }

let tableCounter = 300;
async function ensureTable(number) {
  const tables = await api('/api/tables', { token: adminToken });
  const existing = tables.json?.tables?.find(t => t.number === number);
  if (existing) return existing.id;
  const created = await api('/api/tables', { method: 'POST', token: adminToken, body: { number, capacity: 4, section: 'txn' } });
  return created.json?.table?.id;
}

async function createOrder() {
  const tableId = await ensureTable(++tableCounter);
  const menu = await api('/api/menu/items');
  const item = menu.json?.items?.find(i => i.price != null && i.area === 'bar');
  const create = await api('/api/orders', { method: 'POST', token: meseroToken, body: { table_id: tableId, items: [{ menu_item_id: item.id, quantity: 1 }] } });
  return { orderId: create.json?.order?.id, total: create.json?.order?.total };
}

async function current() { return api('/api/payments/closing/current', { token: adminToken }); }
async function pay(body) { return api('/api/payments', { method: 'POST', token: meseroToken, body }); }

describe('transactions = pedidos pagados distintos (no pagos)', () => {
  it('un pedido pagado MIXTO (cash+qr = 2 pagos) cuenta como 1 transacción', async () => {
    const { orderId, total } = await createOrder();
    const before = (await current()).json.breakdown;
    const cash = total - 1000;
    const qr = 1000;
    const mixed = await api('/api/payments/mixed', { method: 'POST', token: meseroToken, body: {
      order_id: orderId, idempotency_key: crypto.randomUUID(),
      allocations: [{ method: 'cash', amount: cash, received: cash, change: 0 }, { method: 'qr', amount: qr }],
    } });
    expect(mixed.status).toBe(201);
    expect(mixed.json.is_fully_paid).toBe(true);

    const after = (await current()).json.breakdown;
    // Antes contaba COUNT(*) = 2 (2 filas de pago). Ahora COUNT(DISTINCT order_id) = 1.
    expect(after.transactions - before.transactions).toBe(1);
  });

  it('un pedido pagado en efectivo simple cuenta como 1 transacción', async () => {
    const { orderId, total } = await createOrder();
    const before = (await current()).json.breakdown;
    const p = await pay({ order_id: orderId, amount: total, method: 'cash' });
    expect(p.status).toBe(201);
    expect(p.json.fully_paid).toBe(true);
    const after = (await current()).json.breakdown;
    expect(after.transactions - before.transactions).toBe(1);
  });

  it('2 pedidos pagados cada uno con 1 pago → 2 transacciones (no subcuenta)', async () => {
    const before = (await current()).json.breakdown;
    for (let i = 0; i < 2; i++) {
      const { orderId, total } = await createOrder();
      const p = await pay({ order_id: orderId, amount: total, method: i % 2 === 0 ? 'cash' : 'qr' });
      expect(p.status).toBe(201);
    }
    const after = (await current()).json.breakdown;
    expect(after.transactions - before.transactions).toBe(2);
  });

  it('Al CERRAR el cierre, closing.transactions cuenta pedidos distintos', async () => {
    // Abrir el cierre (no hay uno abierto en este flujo) y cerrarlo.
    const open = await api('/api/payments/closing', { method: 'POST', token: adminToken, body: {} });
    expect(open.status).toBe(201);
    const cur = await current();
    const expected = cur.json.breakdown.expected_cash;
    const close = await api('/api/payments/closing/close', { method: 'PUT', token: adminToken, body: { actual_cash: expected } });
    expect(close.status).toBe(200);
    // El día tiene: 1 mixto (2 pagos) + 1 efectivo + 2 (uno cash, uno qr) = 4 pedidos pagados.
    expect(close.json.closing.transactions).toBe(4);
  });
});
