/**
 * B1 — PATCH /api/orders/:id/status restringido por rol
 *
 * Antes: cualquier rol autenticado (kds, caja) podía cambiar el estado
 * global del pedido (pasar a 'paid', retroceder flujo, etc.) — operación
 * de mesero/admin.
 * Ahora: requireRole('admin', 'mesero') — kds/caja → 403 FORBIDDEN_ROLE.
 *
 * Patrón: server real con DB_PATH = temp (NO toca data/rey-de-la-chelada.db).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_DB = 'data/test-orders-status-role.db';

process.env.PORT = '0';
process.env.DB_PATH = TEST_DB;

let server;
let base;
let adminToken;
let meseroToken;
let kdsToken;
let cajaToken;

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
  cajaToken = await login('3333');
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

describe('B1 — PATCH /orders/:id/status por rol', () => {
  let orderId;

  beforeAll(async () => {
    // Mesa throwaway 95 + pedido confirmado (POST crea directo 'confirmed')
    const tables = await api('/api/tables', { token: adminToken });
    let tableId = tables.json?.tables?.find(t => t.number === 95)?.id;
    if (!tableId) {
      const created = await api('/api/tables', {
        method: 'POST', token: adminToken,
        body: { number: 95, capacity: 4, section: 'e2e' },
      });
      tableId = created.json?.table?.id;
    }
    const menu = await api('/api/menu/items');
    const item = menu.json?.items?.find(i => i.price != null);
    const create = await api('/api/orders', {
      method: 'POST', token: meseroToken,
      body: { table_id: tableId, items: [{ menu_item_id: item.id, quantity: 1 }] },
    });
    orderId = create.json?.order?.id;
    expect(orderId).toBeTruthy();
  });

  afterAll(async () => {
    const { getDb } = await import('../../server/db/index.js');
    const db = getDb();
    db.prepare('DELETE FROM payments WHERE order_id = ?').run(orderId);
    db.prepare('DELETE FROM order_items WHERE order_id = ?').run(orderId);
    db.prepare('DELETE FROM orders WHERE id = ?').run(orderId);
  });

  it('sin token → 401 AUTH_REQUIRED (control)', async () => {
    const r = await api(`/api/orders/${orderId}/status`, { method: 'PATCH', body: { status: 'preparing' } });
    expect(r.status).toBe(401);
    expect(r.json.code).toBe('AUTH_REQUIRED');
  });

  it('rol kds → 403 FORBIDDEN_ROLE (no puede cambiar estado global)', async () => {
    const r = await api(`/api/orders/${orderId}/status`, {
      method: 'PATCH', token: kdsToken, body: { status: 'preparing' },
    });
    expect(r.status).toBe(403);
    expect(r.json.code).toBe('FORBIDDEN_ROLE');
  });

  it('rol caja → 403 FORBIDDEN_ROLE (cobra vía POST /api/payments, no PATCH status)', async () => {
    const r = await api(`/api/orders/${orderId}/status`, {
      method: 'PATCH', token: cajaToken, body: { status: 'preparing' },
    });
    expect(r.status).toBe(403);
    expect(r.json.code).toBe('FORBIDDEN_ROLE');
  });

  it('rol mesero → 200 (puede avanzar el flujo: confirmed → preparing)', async () => {
    const r = await api(`/api/orders/${orderId}/status`, {
      method: 'PATCH', token: meseroToken, body: { status: 'preparing' },
    });
    expect(r.status).toBe(200);
    expect(r.json.success).toBe(true);
    expect(r.json.status).toBe('preparing');
  });

  it('rol admin → 200 (puede avanzar el flujo: preparing → ready)', async () => {
    const r = await api(`/api/orders/${orderId}/status`, {
      method: 'PATCH', token: adminToken, body: { status: 'ready' },
    });
    expect(r.status).toBe(200);
    expect(r.json.success).toBe(true);
    expect(r.json.status).toBe('ready');
  });
});
