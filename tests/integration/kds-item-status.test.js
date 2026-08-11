/**
 * KDS item status endpoint — persistencia de estados de items.
 *
 * RED (FASE 2): el KDS marcaba items "listo" solo en memoria del cliente
 * (orderEngine.updateItemStatus) y el servidor nunca se enteraba:
 *   - al refrescar, el item volvía a 'pending'
 *   - meseros/otros KDS no recibían el cambio
 *
 * Este test pide el endpoint PATCH /api/orders/:id/items/:itemId/status
 * que persiste order_items.status y emite broadcast (item_ready/status_change).
 * Usa el server real con PORT=0 (puerto aleatorio) — patrón server-assets.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

let server;
let base;

beforeAll(async () => {
  process.env.PORT = '0';
  const mod = await import('../../server/index.js');
  server = mod.server;
  let addr = null;
  for (let i = 0; i < 50 && !addr; i++) {
    addr = server.address();
    if (!addr) await new Promise(r => setTimeout(r, 25));
  }
  if (!addr) throw new Error('El server no escuchó en tiempo razonable');
  base = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  await new Promise(resolve => server.close(resolve));
});

async function api(path, { method = 'GET', body, token } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${base}${path}`, {
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

describe('KDS item status persistence', () => {
  let adminToken;
  let meseroToken;
  let kdsToken;
  let tableId;
  let orderId;
  let itemIds = [];

  beforeAll(async () => {
    // Auth (rate limit 5/min — aquí solo 3 logins)
    adminToken = await login('0000');
    meseroToken = await login('1111');
    kdsToken = await login('2222');

    // Mesa throwaway 92
    const tables = await api('/api/tables', { token: adminToken });
    const existing = tables.json?.tables?.find(t => t.number === 92);
    if (existing) {
      tableId = existing.id;
    } else {
      const created = await api('/api/tables', {
        method: 'POST', token: adminToken,
        body: { number: 92, capacity: 4, section: 'e2e' },
      });
      tableId = created.json?.table?.id;
    }

    // Menu items mixtos
    const menu = await api('/api/menu/items');
    const items = menu.json?.items?.filter(i => i.price != null);
    const bar = items.find(i => i.area === 'bar');
    const cocina = items.find(i => i.area === 'cocina' || !i.area);

    // Pedido mixto confirmado
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
    const { getDb } = await import('../../server/db/index.js');
    const db = getDb();
    db.prepare('DELETE FROM payments WHERE order_id = ?').run(orderId);
    db.prepare('DELETE FROM order_items WHERE order_id = ?').run(orderId);
    db.prepare('DELETE FROM orders WHERE id = ?').run(orderId);
    if (tableId) db.prepare('DELETE FROM tables WHERE id = ?').run(tableId);
  });

  it('persiste item pending → preparing (vía endpoint KDS)', async () => {
    const r = await api(`/api/orders/${orderId}/items/${itemIds[0]}/status`, {
      method: 'PATCH', token: kdsToken, body: { status: 'preparing' },
    });
    expect(r.status).toBe(200);
    expect(r.json?.success).toBe(true);
  });

  it('persiste item preparing → ready y lo refleja en GET kds', async () => {
    const r = await api(`/api/orders/${orderId}/items/${itemIds[0]}/status`, {
      method: 'PATCH', token: kdsToken, body: { status: 'ready' },
    });
    expect(r.status).toBe(200);

    const kds = await api(`/api/orders/kds/kds`, { token: kdsToken });
    const order = kds.json?.orders?.find(o => o.id === orderId);
    const item = order?.items?.find(i => i.id === itemIds[0]);
    expect(item?.item_status).toBe('ready');
  });

  it('persiste item ready → delivered', async () => {
    const r = await api(`/api/orders/${orderId}/items/${itemIds[0]}/status`, {
      method: 'PATCH', token: kdsToken, body: { status: 'delivered' },
    });
    expect(r.status).toBe(200);
  });

  it('rechaza estado inválido con 400', async () => {
    const r = await api(`/api/orders/${orderId}/items/${itemIds[0]}/status`, {
      method: 'PATCH', token: kdsToken, body: { status: 'vuelo-libre' },
    });
    expect(r.status).toBe(400);
  });

  it('exige rol kds/admin (mesero → 403)', async () => {
    const r = await api(`/api/orders/${orderId}/items/${itemIds[0]}/status`, {
      method: 'PATCH', token: meseroToken, body: { status: 'ready' },
    });
    expect(r.status).toBe(403);
  });

  it('404 para item inexistente', async () => {
    const r = await api(`/api/orders/${orderId}/items/no-existe/status`, {
      method: 'PATCH', token: kdsToken, body: { status: 'ready' },
    });
    expect(r.status).toBe(404);
  });

  it('marca el pedido served cuando todos los items están delivered/cancelled', async () => {
    await api(`/api/orders/${orderId}/items/${itemIds[1]}/status`, {
      method: 'PATCH', token: kdsToken, body: { status: 'delivered' },
    });
    const r = await api(`/api/orders/${orderId}`, { token: meseroToken });
    expect(r.json?.order?.status).toBe('served');
  });

  it('P0-FIX: pedido mixto — un módulo ready NO saca el pedido del KDS del otro módulo', async () => {
    // Pedido mixto nuevo (1 bar + 1 cocina) en su PROPIA mesa throwaway
    // (la mesa 92 del beforeAll sigue con pedido activo hasta el afterAll)
    const mkTable = await api('/api/tables', {
      method: 'POST', token: adminToken,
      body: { number: 93, capacity: 4, section: 'e2e' },
    });
    const table = mkTable.json?.table;
    const menu = await api('/api/menu/items');
    const items = menu.json?.items?.filter(i => i.price != null);
    const bar = items.find(i => i.area === 'bar');
    const cocina = items.find(i => i.area === 'cocina' || !i.area);
    const create = await api('/api/orders', {
      method: 'POST', token: meseroToken,
      body: { table_id: table.id, items: [
        { menu_item_id: bar.id, quantity: 1 },
        { menu_item_id: cocina.id, quantity: 1 },
      ] },
    });
    const oid = create.json?.order?.id;
    // FASE 4A: POST crea directo 'confirmed'

    const kds = await api(`/api/orders/kds/kds`, { token: kdsToken });
    const order = kds.json?.orders?.find(o => o.id === oid);
    const barItem = order?.items?.find(i => i.kds_module === 'bar');
    const cocinaItem = order?.items?.find(i => i.kds_module === 'cocina');

    // Bartender marca SU item ready (el de bar) — el pedido NO debe cerrarse
    await api(`/api/orders/${oid}/items/${barItem.id}/status`, {
      method: 'PATCH', token: kdsToken, body: { status: 'ready' },
    });

    // 1) El pedido sigue activo (confirmed/preparing/ready) — no served/cerrado
    const after = await api(`/api/orders/${oid}`, { token: meseroToken });
    expect(['confirmed', 'preparing', 'ready'].includes(after.json?.order?.status)).toBe(true);
    // El item de bar está ready, el de cocina sigue pending
    const barAfter = after.json?.order?.items?.find(i => i.id === barItem.id);
    const cocinaAfter = after.json?.order?.items?.find(i => i.id === cocinaItem.id);
    expect(barAfter?.status).toBe('ready');
    expect(cocinaAfter?.status).toBe('pending');

    // 2) El KDS de COCINA sigue viendo el pedido (con su item pending)
    const kdsCocina = await api(`/api/orders/kds/cocina`, { token: kdsToken });
    const cocinaView = kdsCocina.json?.orders?.find(o => o.id === oid);
    expect(cocinaView).toBeDefined();
    expect(cocinaView?.items?.every(i => i.kds_module === 'cocina')).toBe(true);

    // Cleanup
    const { getDb } = await import('../../server/db/index.js');
    const db = getDb();
    db.prepare('DELETE FROM payments WHERE order_id = ?').run(oid);
    db.prepare('DELETE FROM order_items WHERE order_id = ?').run(oid);
    db.prepare('DELETE FROM orders WHERE id = ?').run(oid);
    if (table?.id) db.prepare('DELETE FROM tables WHERE id = ?').run(table.id);
  });
});
