/**
 * B2 — POST /api/payments valida amount numérico
 *
 * Antes: amount 'abc' → Number('abc') = NaN → `|| 0` → se registraba un
 * pago de Bs 0 (o fallaba con mensajes confusos río abajo).
 * Ahora: el route rechaza 400 INVALID_AMOUNT para NaN / strings no
 * numéricas / negativos. DECISIÓN (documentada): se aceptan strings
 * numéricas ("34.5") por retrocompatibilidad con clientes legacy que
 * serializan montos como string — Number("34.5") es finito ≥ 0.
 *
 * Patrón: server real con DB_PATH = temp.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_DB = 'data/test-payments-invalid-amount.db';

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
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch { /* noop */ }
  return { status: res.status, json };
}

async function login(pin) {
  const r = await api('/api/auth/login', { method: 'POST', body: { pin } });
  return r.json?.token;
}

let tableCounter = 96;

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

/**
 * Crea un pedido y devuelve { orderId, total }.
 * Si `minTotal` viene dado, se pide la cantidad necesaria de items para
 * garantizar total ≥ minTotal (determinista a runtime, sin asumir precios).
 */
async function createOrder(minTotal) {
  const tableId = await ensureTable(++tableCounter);
  const menu = await api('/api/menu/items');
  const item = menu.json?.items?.find(i => i.price != null);
  const quantity = minTotal ? Math.ceil(minTotal / item.price) + 1 : 1;
  const create = await api('/api/orders', {
    method: 'POST', token: meseroToken,
    body: { table_id: tableId, items: [{ menu_item_id: item.id, quantity }] },
  });
  const order = create.json?.order;
  return { orderId: order.id, total: order.total };
}

/** POST /api/payments → { status, json } */
function pay(orderId, amount, method = 'qr') {
  return api('/api/payments', {
    method: 'POST', token: meseroToken,
    body: { order_id: orderId, amount, method },
  });
}

describe('B2 — amount inválido en POST /api/payments', () => {
  let invalidOrderId;

  beforeAll(async () => {
    ({ orderId: invalidOrderId } = await createOrder());
  });

  afterAll(async () => {
    const { getDb } = await import('../../server/db/index.js');
    const db = getDb();
    db.prepare('DELETE FROM payments WHERE order_id = ?').run(invalidOrderId);
    db.prepare('DELETE FROM order_items WHERE order_id = ?').run(invalidOrderId);
    db.prepare('DELETE FROM orders WHERE id = ?').run(invalidOrderId);
  });

  it("amount 'abc' → 400 INVALID_AMOUNT (string no numérico)", async () => {
    const r = await pay(invalidOrderId, 'abc');
    expect(r.status).toBe(400);
    expect(r.json.code).toBe('INVALID_AMOUNT');
    expect(r.json.success).toBe(false);
  });

  it('amount NaN → 400 INVALID_AMOUNT (en el wire JSON se serializa a null)', async () => {
    const r = await pay(invalidOrderId, NaN);
    expect(r.status).toBe(400);
    expect(r.json.code).toBe('INVALID_AMOUNT');
  });

  it('amount -5 → 400 INVALID_AMOUNT (negativo)', async () => {
    const r = await pay(invalidOrderId, -5);
    expect(r.status).toBe(400);
    expect(r.json.code).toBe('INVALID_AMOUNT');
  });

  it('amount null → 400 INVALID_AMOUNT', async () => {
    const r = await pay(invalidOrderId, null);
    expect(r.status).toBe(400);
    expect(r.json.code).toBe('INVALID_AMOUNT');
  });
});

describe('B2 — amount válido en POST /api/payments', () => {
  let numericOrderId;
  let stringOrderId;
  let numericTotal;
  let stringTotal;

  beforeAll(async () => {
    // Pedido con total ≥ 3450 (Bs 34.50, centavos; cantidad calculada a runtime)
    ({ orderId: numericOrderId, total: numericTotal } = await createOrder(3450));
    // Pedido para probar tolerancia de strings numéricas
    ({ orderId: stringOrderId, total: stringTotal } = await createOrder());
  });

  afterAll(async () => {
    const { getDb } = await import('../../server/db/index.js');
    const db = getDb();
    for (const id of [numericOrderId, stringOrderId]) {
      db.prepare('DELETE FROM payments WHERE order_id = ?').run(id);
      db.prepare('DELETE FROM order_items WHERE order_id = ?').run(id);
      db.prepare('DELETE FROM orders WHERE id = ?').run(id);
    }
  });

  it('amount 3450 (número, centavos) → 201 cuando 3450 ≤ saldo del pedido', async () => {
    expect(numericTotal).toBeGreaterThanOrEqual(3450);
    const r = await pay(numericOrderId, 3450);
    expect(r.status).toBe(201);
    expect(r.json.success).toBe(true);
    expect(r.json.payment.amount).toBe(3450);
  });

  it('amount string numérica (String(total), centavos) → 201 (retrocompat legacy)', async () => {
    const r = await pay(stringOrderId, String(stringTotal));
    expect(r.status).toBe(201);
    expect(r.json.success).toBe(true);
    expect(r.json.payment.amount).toBe(stringTotal);
  });
});
