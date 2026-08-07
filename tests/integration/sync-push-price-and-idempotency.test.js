/**
 * Integración — Sync Push: precios reales (A1/2.2) + idempotencia y
 * errores honestos (A2/2.3)
 *
 * 2.2 — create_order recalcula subtotal/iva/total/unit_price SERVER-SIDE
 *       desde menu_items.price (SSOT). Los montos que envía el cliente
 *       (unit_price 0.01, total 0.01) se IGNORAN — un cliente comprometido
 *       no puede facturar Bs 0.01.
 * 2.3 — idempotencia por entity id (orders.id / payments.id son UUID del
 *       cliente = deterministas): push duplicado → 'skipped' sin duplicar.
 *       Errores honestos: si algo falla → success:false + code
 *       'SYNC_PARTIAL_ERRORS' + errors[] (el cliente NO borra de la cola).
 *
 * Patrón: server real con DB_PATH = temp (NO toca data/). Mismo patrón
 * que tests/integration/payments-cash-close.test.js.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_DB = 'data/test-sync-push.db';

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

/** Menú: item real (precio del server) */
async function getRealMenuItem() {
  const menu = await api('/api/menu/items');
  const item = menu.json?.items?.find(i => i.price != null && i.area === 'bar');
  if (!item) throw new Error('No hay items de menú con precio (seed)');
  return item;
}

let tableCounter = 80;

/** Waiter id REAL (FK a staff) — el sync inserta waiter_id del cliente */
async function getRealWaiterId() {
  const staff = await api('/api/staff', { token: adminToken });
  const mesero = staff.json?.staff?.find(s => s.role === 'mesero');
  if (!mesero) throw new Error('No hay staff mesero (seed)');
  return mesero.id;
}

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

/** Push de un create_order con los montos que vienen del cliente */
async function pushCreateOrder(order, syncId = 'sync-test-1') {
  return api('/api/sync/push', {
    method: 'POST', token: meseroToken,
    body: { sync_id: syncId, orders: [order] },
  });
}

// ═══════════════════════════════════════════════════════════
// 2.2 — Precios SIEMPRE del server (nunca del cliente)
// ═══════════════════════════════════════════════════════════

describe('2.2 — sync push recalcula precios server-side', () => {
  it('create_order con precios falsos (0.01) → el pedido queda con el precio REAL del menú', async () => {
    const item = await getRealMenuItem();
    const waiterId = await getRealWaiterId();
    const tableId = await ensureTable(++tableCounter);
    const orderId = `sync-order-2-2-${Date.now()}`;

    const push = await pushCreateOrder({
      action: 'create',
      id: orderId,
      table_id: tableId,
      table_number: tableCounter,
      waiter_id: waiterId,
      waiter_name: 'Mesero',
      status: 'confirmed',
      // ⚠️ Montos falsos que intenta inyectar el cliente comprometido
      subtotal: 0.01, iva_amount: 0.0, total: 0.01, discount: 0,
      items: [{
        id: `item-${Date.now()}`,
        menu_item_id: item.id,
        menu_item_name: item.name,
        quantity: 2,
        unit_price: 0.01,   // falso
        subtotal: 0.01,     // falso
        status: 'pending',
      }],
    }, 'sync-2-2-a');

    expect(push.status).toBe(200);
    expect(push.json.success).toBe(true);
    expect(push.json.errors).toBeUndefined();
    expect(push.json.results[0].status).toBe('created');

    // El pedido en DB tiene el precio REAL (menu_items.price * 2), NO 0.01
    const order = await api(`/api/orders/${orderId}`, { token: meseroToken });
    expect(order.status).toBe(200);
    const realUnit = Math.round((item.price) * 100) / 100;
    const expectedTotal = Math.round(realUnit * 2 * 100) / 100;
    expect(order.json.order.total).toBe(expectedTotal);
    expect(order.json.order.subtotal).toBeGreaterThan(0);
    expect(order.json.order.items[0].unit_price).toBe(realUnit);
    expect(order.json.order.items[0].subtotal).toBe(expectedTotal);
    expect(order.json.order.items[0].unit_price).not.toBe(0.01);
  });

  it('create_order con item de menú inválido → error honesto (success:false + errors[])', async () => {
    const waiterId = await getRealWaiterId();
    const tableId = await ensureTable(++tableCounter);

    const push = await pushCreateOrder({
      action: 'create',
      id: `sync-order-bad-${Date.now()}`,
      table_id: tableId,
      table_number: tableCounter,
      waiter_id: waiterId,
      waiter_name: 'Mesero',
      status: 'confirmed',
      subtotal: 100, iva_amount: 11.5, total: 100,
      items: [{ menu_item_id: 'no-existe', quantity: 1, unit_price: 50, subtotal: 50 }],
    }, 'sync-2-2-b');

    // 2.3: errores honestos — success:false, el cliente NO borra de la cola
    expect(push.status).toBe(200);
    expect(push.json.success).toBe(false);
    expect(push.json.code).toBe('SYNC_PARTIAL_ERRORS');
    expect(Array.isArray(push.json.errors)).toBe(true);
    expect(push.json.errors.length).toBe(1);
    expect(push.json.errors[0].error).toContain('no-existe');
  });
});

// ═══════════════════════════════════════════════════════════
// 2.3 — Idempotencia: el MISMO id de pedido no se duplica
// ═══════════════════════════════════════════════════════════

describe('2.3 — idempotencia del push (mismo id → skipped, sin duplicar)', () => {
  it('push duplicado del mismo create_order → 1 solo pedido en DB, segundo = skipped sin error', async () => {
    const item = await getRealMenuItem();
    const waiterId = await getRealWaiterId();
    const tableId = await ensureTable(++tableCounter);
    const orderId = `sync-order-idem-${Date.now()}`;
    const payload = {
      action: 'create',
      id: orderId,
      table_id: tableId,
      table_number: tableCounter,
      waiter_id: waiterId,
      waiter_name: 'Mesero',
      status: 'confirmed',
      subtotal: 999, iva_amount: 999, total: 999,
      items: [{
        id: `idem-item-${Date.now()}`,
        menu_item_id: item.id,
        menu_item_name: item.name,
        quantity: 1,
        unit_price: 0.01, subtotal: 0.01,
        status: 'pending',
      }],
    };

    const first = await pushCreateOrder(payload, 'sync-2-3-first');
    expect(first.json.results[0].status).toBe('created');

    const second = await pushCreateOrder(payload, 'sync-2-3-second');
    expect(second.status).toBe(200);
    expect(second.json.success).toBe(true);
    expect(second.json.errors).toBeUndefined();
    expect(second.json.results[0].status).toBe('skipped');
    expect(second.json.results[0].reason).toMatch(/duplicate|exists/i);

    // Solo 1 pedido en DB (pese a los 2 pushes)
    const order = await api(`/api/orders/${orderId}`, { token: meseroToken });
    expect(order.status).toBe(200);
    // El conteo de items del pedido no se duplicó
    expect(order.json.order.items).toHaveLength(1);
  });

  it('update_status es idempotente (mismo pedido, mismo estado → ok, no duplica)', async () => {
    const item = await getRealMenuItem();
    const waiterId = await getRealWaiterId();
    const tableId = await ensureTable(++tableCounter);
    const orderId = `sync-order-status-${Date.now()}`;
    await pushCreateOrder({
      action: 'create', id: orderId, table_id: tableId,
      table_number: tableCounter, waiter_id: waiterId, waiter_name: 'Mesero',
      status: 'confirmed', subtotal: 1, iva_amount: 1, total: 1,
      items: [{ id: `st-item-${Date.now()}`, menu_item_id: item.id, menu_item_name: item.name, quantity: 1, unit_price: 0.01, subtotal: 0.01 }],
    }, 'sync-2-3-c');

    const st = await api('/api/sync/push', {
      method: 'POST', token: meseroToken,
      body: { sync_id: 'sync-2-3-d', orders: [{ action: 'update_status', id: orderId, status: 'confirmed' }] },
    });
    expect(st.json.success).toBe(true);
    expect(st.json.results[0].status).toBe('updated');
  });
});
