/**
 * Integración — CIERRE DE CAJA AL CENTAVO (2026-08-26)
 *
 * Recorre TODOS los flujos de cobro y verifica el DESGLOSE del día laboral
 * con DELTAS (antes/después) porque todos corren sobre el MISMO día
 * (la caja acumula). Verifica que el cálculo cuadre al centavo.
 *
 * Flujos:
 *   1. Efectivo simple (recibido = monto)
 *   2. Efectivo con vuelto EN EFECTIVO (received > monto, change > 0)
 *   3. Efectivo con cambio POR QR (retiro transfer_out)
 *   4. QR simple
 *   5. Mixto (efectivo + QR)
 *   6. Varios pedidos → transacciones + total general coherencia
 *   7. Cierre exacto → difference 0 + is_reconciled 1
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_DB = 'data/test-cierre-centavo.db';

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

let tableCounter = 200;
async function ensureTable(number) {
  const tables = await api('/api/tables', { token: adminToken });
  const existing = tables.json?.tables?.find(t => t.number === number);
  if (existing) return existing.id;
  const created = await api('/api/tables', { method: 'POST', token: adminToken, body: { number, capacity: 4, section: 'e2e' } });
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
async function closeClosing(body) { return api('/api/payments/closing/close', { method: 'PUT', token: adminToken, body }); }
async function pay(body) { return api('/api/payments', { method: 'POST', token: meseroToken, body }); }

// Delta del desglose entre dos estados del cierre current
async function deltaOf(getter) {
  const before = await current();
  const b = before.json.breakdown;
  const res = await getter();
  const after = await current();
  const a = after.json.breakdown;
  return { res, before: b, after: a, d: getter('__delta') ? null : { cash: a.cash_today - b.cash_today, qr: a.qr_today - b.qr_today, tx: a.transactions - b.transactions } };
}

describe('CIERRE DE CAJA AL CENTAVO — todos los flujos', () => {
  it('1. Efectivo simple: cash_today suma el monto', async () => {
    const { orderId, total } = await createOrder();
    const before = (await current()).json.breakdown;
    const p = await pay({ order_id: orderId, amount: total, method: 'cash' });
    expect(p.status).toBe(201);
    expect(p.json.fully_paid).toBe(true);
    const after = (await current()).json.breakdown;
    expect(after.cash_today - before.cash_today).toBe(total);
    expect(after.qr_today - before.qr_today).toBe(0);
  });

  it('2. Vuelto en efectivo: cash_today sube SOLO el monto (received−change)', async () => {
    const { orderId, total } = await createOrder();
    const before = (await current()).json.breakdown;
    const p = await pay({ order_id: orderId, amount: total, method: 'cash', received: total + 2000, change: 2000 });
    expect(p.status).toBe(201);
    expect(p.json.payment.change).toBe(2000);
    const after = (await current()).json.breakdown;
    expect(after.cash_today - before.cash_today).toBe(total); // (total+2000)−2000
  });

  it('3. Cambio por QR (retiro): cash_today = recibido (todo al cajón), qr_today = −retiro', async () => {
    const { orderId, total } = await createOrder();
    const extra = 5000;
    const before = (await current()).json.breakdown;
    await pay({ order_id: orderId, amount: total, method: 'cash', received: total + extra, change: 0 });
    const retiro = await pay({ order_id: orderId, amount: extra, method: 'qr', transfer_out: true });
    expect(retiro.status).toBe(201);
    expect(retiro.json.payment.amount).toBe(-extra);
    const after = (await current()).json.breakdown;
    expect(after.cash_today - before.cash_today).toBe(total + extra);
    expect(after.qr_today - before.qr_today).toBe(-extra);
    // neto del día (cash+qr) = total
    expect((after.cash_today + after.qr_today) - (before.cash_today + before.qr_today)).toBe(total);
  });

  it('4. QR simple: qr_today suma el monto', async () => {
    const { orderId, total } = await createOrder();
    const before = (await current()).json.breakdown;
    const p = await pay({ order_id: orderId, amount: total, method: 'qr' });
    expect(p.status).toBe(201);
    expect(p.json.fully_paid).toBe(true);
    const after = (await current()).json.breakdown;
    expect(after.qr_today - before.qr_today).toBe(total);
  });

  it('5. Mixto (cash + qr): suma ambas', async () => {
    const { orderId, total } = await createOrder();
    const cash = total - 1000;
    const qr = 1000;
    const before = (await current()).json.breakdown;
    const mixed = await api('/api/payments/mixed', { method: 'POST', token: meseroToken, body: {
      order_id: orderId, idempotency_key: crypto.randomUUID(),
      allocations: [{ method: 'cash', amount: cash, received: cash, change: 0 }, { method: 'qr', amount: qr }],
    } });
    expect(mixed.status).toBe(201);
    expect(mixed.json.is_fully_paid).toBe(true);
    const after = (await current()).json.breakdown;
    expect(after.cash_today - before.cash_today).toBe(cash);
    expect(after.qr_today - before.qr_today).toBe(qr);
  });

  it('6. Varios pedidos: transacciones y total general con coherencia', async () => {
    const before = (await current()).json.breakdown;
    const pedidos = [];
    for (let i = 0; i < 4; i++) pedidos.push(await createOrder());
    for (let idx = 0; idx < pedidos.length; idx++) {
      const { orderId, total } = pedidos[idx];
      const method = idx % 2 === 0 ? 'cash' : 'qr';
      const p = await pay({ order_id: orderId, amount: total, method });
      expect(p.status).toBe(201);
    }
    const after = (await current()).json.breakdown;
    expect(after.transactions - before.transactions).toBe(pedidos.length);
    expect(after.total_general).toBe(after.opening_cash + after.cash_today + after.qr_today);
  });

  it('7. Cierre exacto: actual = esperado → difference 0, reconciled 1', async () => {
    // Abrir el cierre (no había uno abierto en los tests previos)
    const open = await api('/api/payments/closing', { method: 'POST', token: adminToken, body: {} });
    expect(open.status).toBe(201);
    const cur = await current();
    const expected = cur.json.breakdown.expected_cash;
    const close = await closeClosing({ actual_cash: expected });
    expect(close.status).toBe(200);
    expect(close.json.closing.difference).toBe(0);
    expect(close.json.closing.is_reconciled).toBe(1);
  });
});