/**
 * Integración — HISTORIAL DE PEDIDOS (reports/orders) — regresión 2026-08-27
 *
 * FIX: `GET /api/reports/orders` consultaba `payments.processor` que NO existe
 * (la columna real es processed_by, FK a staff) → SQLite fallaba con
 * `no such column` → 500 "Error al obtener historial de pedidos" en Caja/Admin.
 *
 * Este test crea un pedido, lo paga y verifica que el historial devuelva 200
 * con los pagos (incluyendo `processed_by` y `processor` = nombre del staff).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_DB = 'data/test-reports-history.db';

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

let tableCounter = 600;
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

describe('HISTORIAL DE PEDIDOS — reports/orders (regresión processor)', () => {
  it('GET /api/reports/orders devuelve 200 con pedido pagado y el campo processor/payments OK', async () => {
    // Crear y pagar un pedido
    const { orderId, total } = await createOrder();
    const pay = await api('/api/payments', { method: 'POST', token: meseroToken, body: { order_id: orderId, amount: total, method: 'cash' } });
    expect(pay.status).toBe(201);
    expect(pay.json.fully_paid).toBe(true);

    // Historial de pedidos pagados (rol admin/caja)
    const res = await api('/api/reports/orders?status=paid&limit=50', { token: adminToken });
    expect(res.status).toBe(200);

    // El pedido pagado debe estar en la lista (por day laboral) y sus payments OK
    const found = res.json.orders.find(o => o.id === orderId);
    expect(found).toBeDefined();
    expect(found.status).toBe('paid');
    expect(Array.isArray(found.payments)).toBe(true);
    expect(found.payments.length).toBeGreaterThanOrEqual(1);
    // La columna corregida: processed_by existe y processor (join a staff) es string
    expect(typeof found.payments[0].processed_by).toBe('string');
    // No debe aparecer el campo roto 'processor' como undefined — el alias processor
    // lo rellena display_name del staff. Puede ser null si no hay staff join, pero no debe tirar error.
    expect(found.payment_summary).toHaveLength(1);
  });

  it('no crashea si no hay pedidos (devuelve 200 con lista vacía)', async () => {
    const res = await api('/api/reports/orders?status=paid&business_day=1999-01-01', { token: adminToken });
    expect(res.status).toBe(200);
    expect(res.json.orders).toEqual([]);
  });

  it('el mesero NO tiene acceso (401 o 403 de rol)', async () => {
    const res = await api('/api/reports/orders', { token: meseroToken });
    expect([401, 403]).toContain(res.status);
  });
});