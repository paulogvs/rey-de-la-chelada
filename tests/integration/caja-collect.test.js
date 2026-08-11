/**
 * S2-C — Caja: pedidos pendientes de cobro (GET /api/orders?pending=1)
 *
 * Flujo primario cerrado desde la caja:
 *   mesero crea/confirma pedido → caja lo ve en pending
 *   (con totals y paid_amount) → caja cobra (POST /api/payments)
 *   → pedido paid → ya no aparece en pending → mesa queda libre.
 *
 * Usa server real + DB_PATH temp (patrón caja-role.test.js).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_DB = 'data/test-caja-collect.db';

process.env.PORT = '0';
process.env.DB_PATH = TEST_DB;

let server;
let base;
let adminToken;
let meseroToken;
let cajaToken;
let kdsToken;
let tableId;
let orderId;
let total;

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

describe('S2-C — caja: pending list + cobro', () => {
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
    cajaToken = await login('3333');
    kdsToken = await login('2222');

    // Mesa throwaway 93
    const tables = await api('/api/tables', { token: adminToken });
    const existing = tables.json?.tables?.find(t => t.number === 93);
    if (existing) {
      tableId = existing.id;
    } else {
      const created = await api('/api/tables', {
        method: 'POST', token: adminToken,
        body: { number: 93, capacity: 4, section: 'e2e' },
      });
      tableId = created.json?.table?.id;
    }

    const menu = await api('/api/menu/items');
    const items = menu.json?.items?.filter(i => i.price != null);
    const bar = items.find(i => i.area === 'bar');
    const cocina = items.find(i => i.area === 'cocina' || !i.area);

    // FASE 4A: POST /api/orders crea la orden DIRECTAMENTE 'confirmed'
    // (1 sola llamada — adiós draft→submit→confirm). El KDS la ve al instante.
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
    total = create.json?.order?.total;
    expect(create.json?.order?.status).toBe('confirmed');

    // Contrato SSOT: NO puede haber 2º pedido activo en la misma mesa
    const dup = await api('/api/orders', {
      method: 'POST', token: meseroToken,
      body: { table_id: tableId, guest_count: 1, items: [{ menu_item_id: bar.id, quantity: 1 }] },
    });
    expect(dup.status).toBe(409);
    expect(dup.json?.code).toBe('TABLE_HAS_ACTIVE_ORDER');

    // KDS marca items ready → mesero entrega → served (listo para cobrar)
    const kds = await api(`/api/orders/kds/kds`, { token: kdsToken });
    const kdsOrder = kds.json?.orders?.find(o => o.id === orderId);
    for (const it of kdsOrder?.items || []) {
      await api(`/api/orders/${orderId}/items/${it.id}/status`, {
        method: 'PATCH', token: kdsToken, body: { status: 'ready' },
      });
    }
    const deliver = await api(`/api/orders/${orderId}/deliver`, { method: 'PATCH', token: meseroToken });
    expect(deliver.status).toBe(200);
    expect(deliver.json?.status).toBe('served');
  });

  afterAll(async () => {
    await new Promise(resolve => server.close(resolve));
    const { closeDb } = await import('../../server/db/index.js');
    closeDb();
    for (const suffix of ['', '-wal', '-shm']) {
      try { fs.unlinkSync(path.resolve(__dirname, '..', '..', TEST_DB + suffix)); } catch { /* noop */ }
    }
  });

  it('caja puede listar pedidos pendientes con totals y paid_amount', async () => {
    const r = await api('/api/orders?pending=1', { token: cajaToken });
    expect(r.status).toBe(200);
    expect(r.json?.success).toBe(true);
    const pending = r.json?.orders || [];
    const target = pending.find(o => o.id === orderId);
    expect(target).toBeDefined();
    expect(target.status).toBe('served');
    expect(typeof target.total).toBe('number');
    expect(target.total).toBeGreaterThan(0);
    expect(target.paid_amount).toBe(0);
    expect(Array.isArray(target.items)).toBe(true);
  });

  it('caja cobra el pedido completo → paid y mesa libre', async () => {
    const pay = await api('/api/payments', {
      method: 'POST', token: cajaToken,
      body: { order_id: orderId, amount: total, method: 'cash' },
    });
    expect(pay.status).toBe(201);
    expect(pay.json?.fully_paid).toBe(true);

    // Ya no aparece en pending
    const pending = await api('/api/orders?pending=1', { token: cajaToken });
    expect(pending.json?.orders?.some(o => o.id === orderId)).toBe(false);

    // El pedido quedó paid
    const order = await api(`/api/orders/${orderId}`, { token: cajaToken });
    expect(order.json?.order?.status).toBe('paid');
    expect(order.json?.order?.is_paid).toBe(1);
  });

  it('mesa queda libre cuando NO hay otros pedidos activos', async () => {
    // Sin otros pedidos activos → la mesa se libera al pagar
    const tables = await api('/api/tables', { token: adminToken });
    const table = tables.json?.tables?.find(t => t.id === tableId);
    expect(table?.status).toBe('free');
    expect(table?.current_order_id).toBeNull();
  });

  it('pending=1 no incluye pedidos paid ni cancelled', async () => {
    const r = await api('/api/orders?pending=1', { token: cajaToken });
    const statuses = (r.json?.orders || []).map(o => o.status);
    expect(statuses.every(s => s !== 'paid' && s !== 'cancelled')).toBe(true);
  });
});
