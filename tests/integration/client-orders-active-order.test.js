/**
 * Integración — Doble pedido en la misma mesa (A7/2.6)
 *
 * BUG: el teléfono 2 de la mesa podía crear OTRO pedido público mientras
 * ya había uno activo (status NOT IN ('paid','cancelled')) → dos pedidos
 * "activos" de la misma mesa, meseros confundidos.
 *
 * Regla (documentada): UNA mesa puede tener a lo sumo UN pedido activo.
 *   - Nuevo pedido con OTRO session_id (otro teléfono) → 409
 *     TABLE_HAS_ACTIVE_ORDER.
 *   - Excepción: si el pedido activo pertenece al MISMO session_id (mismo
 *     teléfono, mismo flujo de tracking/reintento) → se permite.
 *   - Pagado/cancelado el activo → nuevo pedido OK.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_DB = 'data/test-client-active-order.db';

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

/** Crea un pedido público (sin JWT) en la mesa dada, con la sesión dada */
async function createPublicOrder(tableNumber, sessionId) {
  const menu = await api('/api/menu/items');
  const item = menu.json?.items?.find(i => i.price != null && i.area === 'bar');
  return api('/api/client-orders', {
    method: 'POST',
    body: {
      table_number: tableNumber,
      session_id: sessionId,
      items: [{ menu_item_id: item.id, quantity: 1 }],
    },
  });
}

describe('2.6 — un solo pedido activo por mesa', () => {
  it('segundo pedido con OTRO session_id → 409 TABLE_HAS_ACTIVE_ORDER', async () => {
    const first = await createPublicOrder(6, 'session-A-1');
    expect(first.status).toBe(201);

    const second = await createPublicOrder(6, 'session-B-2');
    expect(second.status).toBe(409);
    expect(second.json.code).toBe('TABLE_HAS_ACTIVE_ORDER');
  });

  it('excepción: MISMO session_id (mismo teléfono) → se permite', async () => {
    const first = await createPublicOrder(7, 'session-same');
    expect(first.status).toBe(201);

    const retry = await createPublicOrder(7, 'session-same');
    expect(retry.status).toBe(201);
  });

  it('pagado el pedido activo → nuevo pedido OK', async () => {
    const first = await createPublicOrder(8, 'session-A-3');
    expect(first.status).toBe(201);
    const orderId = first.json.orderId;

    // Mesero cobra el pedido (processPayment → paid → mesa sin activos)
    const pay = await api('/api/payments', {
      method: 'POST', token: meseroToken,
      body: { order_id: orderId, amount: first.json.total, method: 'cash' },
    });
    expect(pay.status).toBe(201);
    expect(pay.json.fully_paid).toBe(true);

    const second = await createPublicOrder(8, 'session-B-4');
    expect(second.status).toBe(201);
  });

  it('cancelado el pedido activo → nuevo pedido OK', async () => {
    const first = await createPublicOrder(9, 'session-A-5');
    expect(first.status).toBe(201);
    const orderId = first.json.orderId;

    const cancel = await api(`/api/orders/${orderId}/status`, {
      method: 'PATCH', token: meseroToken, body: { status: 'cancelled' },
    });
    expect(cancel.status).toBe(200);

    const second = await createPublicOrder(9, 'session-B-6');
    expect(second.status).toBe(201);
  });
});
