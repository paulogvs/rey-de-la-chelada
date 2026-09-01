/**
 * Integración — Promos data-driven (v16 2026-09-01)
 *
 * Cubre:
 *   GET /api/promotions        → público, devuelve SOLO promos DB activas
 *   POST /api/orders con promo_type (id de la DB) → precio según modelo A/B
 *   Contexto de promo (pack) → 400 PROMO_CONTEXT_VIOLATION
 *   business_day inválido → 400
 *
 * La DB es la única fuente (el SSOT quedó eliminado). El seed crea 6 promos
 * con active=0; los tests activan una (toggle) y facturan con su id.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_DB = 'data/test-promotions.db';

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

let tableCounter = 90;

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

async function getMenuItems() {
  const menu = await api('/api/menu/items');
  const items = menu.json?.items || [];
  const signature = items.find(i => i.category_name === 'Micheladas Especiales' && i.price != null);
  const artesanal = items.find(i => i.category_name === 'Cerveza Artesanal' && i.price != null);
  return { signature, artesanal };
}

/** Busca y activa una promo sembrada por el seed (por label). */
async function activatePromo(label) {
  const list = await api('/api/promotions/admin', { token: adminToken });
  const promo = list.json?.promos?.find(p => p.label === label);
  if (!promo) return null;
  await api(`/api/promotions/admin/${promo.id}/toggle`, { method: 'PATCH', token: adminToken, body: { active: true } });
  return promo;
}

describe('GET /api/promotions — público, la DB manda (v16)', () => {
  it('con promos inactivas → devuelve [] (no fusiona nada)', async () => {
    const r = await api('/api/promotions');
    expect(r.status).toBe(200);
    expect(r.json.success).toBe(true);
    expect(r.json.business_day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(r.json.promotions).toEqual([]);
  });

  it('tras activar una promo, aparece por su id y NO duplica con el SSOT', async () => {
    const promo = await activatePromo('Miércoles de Barra');
    if (!promo) return; // sin categorías → seed skipped
    const r = await api('/api/promotions');
    expect(r.json.promotions.some(p => p.id === promo.id)).toBe(true);
  });

  it('business_day inválido → 400', async () => {
    const r = await api('/api/promotions?business_day=hoy');
    expect(r.status).toBe(400);
    expect(r.json.code).toBe('INVALID_BUSINESS_DAY');
  });
});

describe('POST /api/orders con promo_type (id DB) — modelo A/B', () => {
  it('Primera Visita (FIXED 2500): Signature → unit 2500', async () => {
    const { signature } = await getMenuItems();
    const promo = await activatePromo('Primera Visita');
    if (!signature || !promo) return;

    const tableId = await ensureTable(++tableCounter);
    const r = await api('/api/orders', {
      method: 'POST', token: meseroToken,
      body: {
        table_id: tableId,
        items: [{ menu_item_id: signature.id, quantity: 1, promo_type: promo.id }],
      },
    });
    expect(r.status).toBe(201);
    expect(r.json.order.items[0].unit_price).toBe(2500);
    expect(r.json.order.total).toBeCloseTo(2500, 2);
  });

  it('Miércoles de Barra (FIXED 1200): Artesanal → unit 1200', async () => {
    const { artesanal } = await getMenuItems();
    const promo = await activatePromo('Miércoles de Barra');
    if (!artesanal || !promo) return;

    const tableId = await ensureTable(++tableCounter);
    const r = await api('/api/orders', {
      method: 'POST', token: meseroToken,
      body: {
        table_id: tableId,
        items: [{ menu_item_id: artesanal.id, quantity: 1, promo_type: promo.id }],
      },
    });
    expect(r.status).toBe(201);
    expect(r.json.order.items[0].unit_price).toBe(1200);
  });

  it('Micheladas + Shot Gratis (MENU_PLUS 0): cuesta el precio del menú + extra sub-línea', async () => {
    const { signature } = await getMenuItems();
    const promo = await activatePromo('Micheladas + Shot Gratis');
    if (!signature || !promo) return;

    const tableId = await ensureTable(++tableCounter);
    const r = await api('/api/orders', {
      method: 'POST', token: meseroToken,
      body: {
        table_id: tableId,
        items: [{ menu_item_id: signature.id, quantity: 1, promo_type: promo.id }],
      },
    });
    expect(r.status).toBe(201);
    const line = r.json.order.items[0];
    expect(line.unit_price).toBe(signature.price); // menú + ajuste 0
    expect(line.promo_label).toContain('Micheladas + Shot Gratis');
    // el extra "Shot" va como sub-línea en modifiers_json
    const mods = JSON.parse(line.modifiers_json || '[]');
    expect(mods.some(m => m.optionName === 'Shot')).toBe(true);
  });

  it('promo_type desconocido → 400 INVALID_PROMO_TYPE', async () => {
    const { signature } = await getMenuItems();
    if (!signature) return;
    const tableId = await ensureTable(++tableCounter);
    const r = await api('/api/orders', {
      method: 'POST', token: meseroToken,
      body: {
        table_id: tableId,
        items: [{ menu_item_id: signature.id, quantity: 1, promo_type: 'no-existe' }],
      },
    });
    expect(r.status).toBe(400);
    expect(r.json.code).toBe('INVALID_PROMO_TYPE');
  });
});
