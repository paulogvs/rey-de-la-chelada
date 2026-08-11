/**
 * S2-B — PATCH /api/orders/:id/deliver (flujo mesero)
 *
 * El mesero NO puede marcar items como entregados con el endpoint KDS
 * (requireRole admin/kds → 403). Este test exige una ruta dedicada
 * (admin|mesero) que marque los items 'ready' como 'delivered' y deje
 * el pedido en 'served' cuando no quedan items activos — así la mesa
 * queda lista para el cobro de la caja.
 *
 * Usa server real + DB_PATH temp (patrón caja-role.test.js).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_DB = 'data/test-deliver-order.db';

process.env.PORT = '0';
process.env.DB_PATH = TEST_DB;

let server;
let base;
let adminToken;
let meseroToken;
let kdsToken;
let tableId;
let orderId;
let itemIds = [];

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

describe('S2-B — deliver: pedido → items ready → served', () => {
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
    kdsToken = await login('2222');

    // Mesa throwaway 91
    const tables = await api('/api/tables', { token: adminToken });
    const existing = tables.json?.tables?.find(t => t.number === 91);
    if (existing) {
      tableId = existing.id;
    } else {
      const created = await api('/api/tables', {
        method: 'POST', token: adminToken,
        body: { number: 91, capacity: 4, section: 'e2e' },
      });
      tableId = created.json?.table?.id;
    }

    const menu = await api('/api/menu/items');
    const items = menu.json?.items?.filter(i => i.price != null);
    const bar = items.find(i => i.area === 'bar');
    const cocina = items.find(i => i.area === 'cocina' || !i.area);

    const create = await api('/api/orders', {
      method: 'POST', token: meseroToken,
      body: {
        table_id: tableId, guest_count: 2,
        items: [
          { menu_item_id: bar.id, quantity: 1 },
          { menu_item_id: cocina.id, quantity: 1 },
        ],
      },
    });
    orderId = create.json?.order?.id;
    // FASE 4A: POST crea directo 'confirmed' (1 llamada)

    const kds = await api(`/api/orders/kds/kds`, { token: kdsToken });
    const order = kds.json?.orders?.find(o => o.id === orderId);
    itemIds = order?.items?.map(i => i.id) || [];
  });

  afterAll(async () => {
    await new Promise(resolve => server.close(resolve));
    const { closeDb } = await import('../../server/db/index.js');
    closeDb();
    for (const suffix of ['', '-wal', '-shm']) {
      try { fs.unlinkSync(path.resolve(__dirname, '..', '..', TEST_DB + suffix)); } catch { /* noop */ }
    }
  });

  it('rechaza deliver cuando NO hay items ready (409 NO_READY_ITEMS)', async () => {
    const r = await api(`/api/orders/${orderId}/deliver`, { method: 'PATCH', token: meseroToken });
    expect(r.status).toBe(409);
    expect(r.json?.code).toBe('NO_READY_ITEMS');
  });

  it('exige rol mesero/admin — el rol kds recibe 403', async () => {
    const r = await api(`/api/orders/${orderId}/deliver`, { method: 'PATCH', token: kdsToken });
    expect(r.status).toBe(403);
    expect(r.json?.code).toBe('FORBIDDEN_ROLE');
  });

  it('marca todos los items ready como delivered y deja el pedido en served', async () => {
    // KDS marca ambos items ready
    for (const itemId of itemIds) {
      const r = await api(`/api/orders/${orderId}/items/${itemId}/status`, {
        method: 'PATCH', token: kdsToken, body: { status: 'ready' },
      });
      expect(r.status).toBe(200);
    }

    const r = await api(`/api/orders/${orderId}/deliver`, { method: 'PATCH', token: meseroToken });
    expect(r.status).toBe(200);
    expect(r.json?.success).toBe(true);
    expect(r.json?.status).toBe('served');

    const order = await api(`/api/orders/${orderId}`, { token: meseroToken });
    expect(order.json?.order?.status).toBe('served');
    const itemStatuses = order.json?.order?.items?.map(i => i.status);
    expect(itemStatuses.every(s => s === 'delivered')).toBe(true);
  });

  it('rechaza deliver cuando el pedido ya está served (409 ORDER_CLOSED)', async () => {
    const r = await api(`/api/orders/${orderId}/deliver`, { method: 'PATCH', token: meseroToken });
    expect(r.status).toBe(409);
    expect(r.json?.code).toBe('ORDER_CLOSED');
  });

  it('404 para pedido inexistente', async () => {
    const r = await api('/api/orders/no-existe/deliver', { method: 'PATCH', token: meseroToken });
    expect(r.status).toBe(404);
  });
});
