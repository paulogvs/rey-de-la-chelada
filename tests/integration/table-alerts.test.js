/**
 * Integración — FASE 4.5: alertas de salón por módulo (GET /api/tables)
 *
 * Cada mesa con pedido activo expone `active_order`:
 *   { id, status, modules: { bar?: 'ready'|'preparing', cocina?: ... } }
 *
 * - 'ready'     → hay items listos de ese módulo (verde, entregable)
 * - 'preparing' → hay items en proceso (amarillo)
 * - served      → todo entregado → el salón muestra "💰 Por cobrar"
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_DB = 'data/test-table-alerts.db';

process.env.PORT = '0';
process.env.DB_PATH = TEST_DB;

let server;
let base;
let adminToken;
let meseroToken;
let kdsToken;

beforeAll(async () => {
  const mod = await import('../../server/index.js');
  server = mod.server;
  let addr = null;
  for (let i = 0; i < 50 && !addr; i++) {
    addr = server.address();
    if (!addr) await new Promise(r => setTimeout(r, 25));
  }
  base = `http://127.0.0.1:${addr.port}`;
  adminToken = await login('0000');
  meseroToken = await login('1111');
  kdsToken = await login('2222');
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
    method, headers, body: body ? JSON.stringify(body) : undefined,
  });
  let json = null; try { json = await res.json(); } catch { /* noop */ }
  return { status: res.status, json };
}

async function login(pin) {
  const r = await api('/api/auth/login', { method: 'POST', body: { pin } });
  return r.json?.token;
}

let counter = 75;
async function ensureTable() {
  const n = ++counter;
  const tables = await api('/api/tables', { token: adminToken });
  const existing = tables.json?.tables?.find(t => t.number === n);
  if (existing) return existing;
  const created = await api('/api/tables', {
    method: 'POST', token: adminToken,
    body: { number: n, capacity: 4, section: 'alerts' },
  });
  return created.json?.table;
}

async function menuItems() {
  const menu = await api('/api/menu/items');
  const items = menu.json?.items?.filter(i => i.price != null);
  return { bar: items.find(i => i.area === 'bar'), cocina: items.find(i => i.area === 'cocina') };
}

describe('FASE 4.5 — alertas de salón por módulo', () => {
  let tableId;
  let orderId;

  beforeAll(async () => {
    const table = await ensureTable();
    tableId = table.id;
    const { bar, cocina } = await menuItems();
    const create = await api('/api/orders', {
      method: 'POST', token: meseroToken,
      body: { table_id: tableId, items: [
        { menu_item_id: bar.id, quantity: 1 },
        { menu_item_id: cocina.id, quantity: 1 },
      ] },
    });
    orderId = create.json?.order?.id;
  });

  it('pedido recién creado → ambos módulos en proceso (preparing)', async () => {
    const tables = await api('/api/tables', { token: meseroToken });
    const table = tables.json?.tables?.find(t => t.id === tableId);
    expect(table.active_order).toBeDefined();
    expect(table.active_order.id).toBe(orderId);
    expect(table.active_order.status).toBe('confirmed');
    expect(table.active_order.modules.bar).toBe('preparing');
    expect(table.active_order.modules.cocina).toBe('preparing');
  });

  it('cocina lista → módulo cocina ready, bar sigue preparing', async () => {
    await api(`/api/orders/${orderId}/kds-status`, {
      method: 'PATCH', token: kdsToken,
      body: { status: 'ready', module: 'cocina', round: 1 },
    });
    const tables = await api('/api/tables', { token: meseroToken });
    const table = tables.json?.tables?.find(t => t.id === tableId);
    expect(table.active_order.modules.cocina).toBe('ready');
    expect(table.active_order.modules.bar).toBe('preparing');
  });

  it('ronda 2 agregada → bar preparing (item nuevo pending), cocina sigue ready', async () => {
    const { bar } = await menuItems();
    await api(`/api/orders/${orderId}/items`, {
      method: 'POST', token: meseroToken,
      body: { menu_item_id: bar.id, quantity: 1 },
    });
    const tables = await api('/api/tables', { token: meseroToken });
    const table = tables.json?.tables?.find(t => t.id === tableId);
    // ronda 2 bar nueva (pending) → bar 'preparing' (no hay bar ready aún)
    expect(table.active_order.modules.bar).toBe('preparing');
    expect(table.active_order.modules.cocina).toBe('ready');
    expect(table.active_order.status).toBe('confirmed'); // reactivado
  });

  it('entregar TODO → served (mesa "por cobrar") y sin módulos activos', async () => {
    // Marcar todo ready y entregar por ronda+módulo
    await api(`/api/orders/${orderId}/kds-status`, { method: 'PATCH', token: kdsToken, body: { status: 'ready', module: 'bar', round: 1 } });
    await api(`/api/orders/${orderId}/kds-status`, { method: 'PATCH', token: kdsToken, body: { status: 'ready', module: 'bar', round: 2 } });
    const kdsOrders = (await api(`/api/orders/kds/kds`, { token: kdsToken })).json.orders;
    const order = kdsOrders.find(o => o.id === orderId);
    for (const it of order.items) {
      // marcar cada item ready (defensivo, por si la ronda 2 tiene module distinto)
    }
    await api(`/api/orders/${orderId}/deliver`, { method: 'PATCH', token: meseroToken, body: { module: 'bar', round: 1 } });
    await api(`/api/orders/${orderId}/deliver`, { method: 'PATCH', token: meseroToken, body: { module: 'cocina', round: 1 } });
    await api(`/api/orders/${orderId}/deliver`, { method: 'PATCH', token: meseroToken, body: { module: 'bar', round: 2 } });

    const tables = await api('/api/tables', { token: meseroToken });
    const table = tables.json?.tables?.find(t => t.id === tableId);
    expect(table.active_order.status).toBe('served');
    // Sin items activos → modules vacío → salón muestra "Por cobrar"
    expect(Object.keys(table.active_order.modules)).toHaveLength(0);
  });
});
