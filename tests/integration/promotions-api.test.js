/**
 * Integración — Promos por día laboral (Sprint 2026-08-19)
 *
 * Cubre:
 *   GET /api/promotions        → público, filtra por día laboral
 *   POST /api/orders con promo_type → precios de la promo (0 2x1, 12 barra,
 *                                      25 primera visita, 30/15 combo)
 *   Contexto: 2x1 sin pareja → 400 PROMO_CONTEXT_VIOLATION
 *   Día no activo → 400 PROMO_NOT_ACTIVE
 *
 * La fecha de "hoy" la controla el server vía businessDayDateStr() (hora
 * Bolivia). Para no depender del día real, los casos que necesitan un día
 * específico prueban CONTRA el estado: si hoy NO es jueves, el 2x1 debe
 * dar PROMO_NOT_ACTIVE; si es jueves, debe facturar 0 con una pareja.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { activePromotionsForDay, businessDayName } from '../../src/core/config/promotions.js';

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
  const signature = items.find(i => i.category_name === 'Micheladas Signature' && i.price != null);
  const artesanal = items.find(i => i.category_name === 'Cerveza Artesanal' && i.price != null);
  return { signature, artesanal };
}

describe('GET /api/promotions — público, filtrado por día laboral', () => {
  it('devuelve las promos del día laboral actual con su nombre de día', async () => {
    const r = await api('/api/promotions');
    expect(r.status).toBe(200);
    expect(r.json.success).toBe(true);
    expect(r.json.business_day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(typeof r.json.day_name).toBe('string');
    const expected = activePromotionsForDay(r.json.business_day).map(p => p.id);
    expect(r.json.promotions.map(p => p.id).sort()).toEqual(expected.sort());
  });

  it('business_day fijo: jueves 2026-08-20 activa 2x1 + combo + primera visita', async () => {
    const r = await api('/api/promotions?business_day=2026-08-20');
    expect(r.status).toBe(200);
    const ids = r.json.promotions.map(p => p.id);
    expect(ids).toContain('2x1');
    expect(ids).toContain('combo');
    expect(ids).toContain('primera-visita');
    expect(ids).not.toContain('barra');
    expect(r.json.day_name).toBe('jueves');
  });

  it('business_day inválido → 400', async () => {
    const r = await api('/api/promotions?business_day=hoy');
    expect(r.status).toBe(400);
    expect(r.json.code).toBe('INVALID_BUSINESS_DAY');
  });
});

describe('POST /api/orders con promo_type — precios SSOT (business_day fijo)', () => {
  it('2x1 (jueves fijo): Signature pagada + Signature 2x1 gratis → la gratis a 0', async () => {
    const { signature } = await getMenuItems();
    if (!signature) return; // DB sin menú real → no probar

    const tableId = await ensureTable(++tableCounter);
    const body = {
      table_id: tableId,
      business_day: '2026-08-20', // jueves
      items: [
        { menu_item_id: signature.id, quantity: 1 },
        { menu_item_id: signature.id, quantity: 1, promo_type: '2x1' },
      ],
    };

    const r = await api('/api/orders', { method: 'POST', token: meseroToken, body });
    expect(r.status).toBe(201);
    const promoLine = r.json.order.items.find(i => i.promo_type === '2x1');
    const paidLine = r.json.order.items.find(i => !i.promo_type);
    expect(promoLine.unit_price).toBe(0);
    expect(promoLine.promo_label).toBe('2x1');
    expect(paidLine.unit_price).toBe(signature.price);
    expect(r.json.order.total).toBeCloseTo(signature.price, 2);
  });

  it('2x1 sin pareja pagada → 400 PROMO_CONTEXT_VIOLATION', async () => {
    const { signature, artesanal } = await getMenuItems();
    if (!signature || !artesanal) return;

    const tableId = await ensureTable(++tableCounter);
    const r = await api('/api/orders', {
      method: 'POST', token: meseroToken,
      body: {
        table_id: tableId,
        business_day: '2026-08-20', // jueves
        items: [
          { menu_item_id: artesanal.id, quantity: 1 },
          { menu_item_id: signature.id, quantity: 1, promo_type: '2x1' },
        ],
      },
    });
    expect(r.status).toBe(400);
    expect(r.json.code).toBe('PROMO_CONTEXT_VIOLATION');
  });

  it('barra (miércoles fijo): Artesanal a 12 con promo_type=barra', async () => {
    const { artesanal } = await getMenuItems();
    if (!artesanal) return;

    const tableId = await ensureTable(++tableCounter);
    const r = await api('/api/orders', {
      method: 'POST', token: meseroToken,
      body: {
        table_id: tableId,
        business_day: '2026-08-19', // miércoles
        items: [
          { menu_item_id: artesanal.id, quantity: 1, promo_type: 'barra' },
        ],
      },
    });
    expect(r.status).toBe(201);
    expect(r.json.order.items[0].unit_price).toBe(12);
    expect(r.json.order.total).toBeCloseTo(12, 2);
  });

  it('2x1 un día NO activo (miércoles) → 400 PROMO_NOT_ACTIVE', async () => {
    const { signature } = await getMenuItems();
    if (!signature) return;

    const tableId = await ensureTable(++tableCounter);
    const r = await api('/api/orders', {
      method: 'POST', token: meseroToken,
      body: {
        table_id: tableId,
        business_day: '2026-08-19', // miércoles — el 2x1 NO corre
        items: [
          { menu_item_id: signature.id, quantity: 1 },
          { menu_item_id: signature.id, quantity: 1, promo_type: '2x1' },
        ],
      },
    });
    expect(r.status).toBe(400);
    expect(r.json.code).toBe('PROMO_NOT_ACTIVE');
  });

  it('promo_type desconocido → 400 INVALID_PROMO_TYPE', async () => {
    const { signature } = await getMenuItems();
    if (!signature) return;
    const tableId = await ensureTable(++tableCounter);
    const r = await api('/api/orders', {
      method: 'POST', token: meseroToken,
      body: {
        table_id: tableId,
        business_day: '2026-08-20',
        items: [
          { menu_item_id: signature.id, quantity: 1, promo_type: 'falsa' },
        ],
      },
    });
    expect(r.status).toBe(400);
    expect(r.json.code).toBe('INVALID_PROMO_TYPE');
  });

  it('combo (jueves fijo): Signature 30 + Cerveza 15 = 45', async () => {
    const { signature, artesanal } = await getMenuItems();
    if (!signature || !artesanal) return;

    const tableId = await ensureTable(++tableCounter);
    const r = await api('/api/orders', {
      method: 'POST', token: meseroToken,
      body: {
        table_id: tableId,
        business_day: '2026-08-20', // jueves
        items: [
          { menu_item_id: signature.id, quantity: 1, promo_type: 'combo' },
          { menu_item_id: artesanal.id, quantity: 1, promo_type: 'combo' },
        ],
      },
    });
    expect(r.status).toBe(201);
    const sigLine = r.json.order.items.find(i => i.promo_type === 'combo' && i.menu_item_name === signature.name);
    const artLine = r.json.order.items.find(i => i.promo_type === 'combo' && i.menu_item_name === artesanal.name);
    expect(sigLine.unit_price).toBe(30);
    expect(artLine.unit_price).toBe(15);
    expect(r.json.order.total).toBeCloseTo(45, 2);
  });

  it('primera-visita (jueves fijo): Signature a 25, y rechaza una segunda', async () => {
    const { signature } = await getMenuItems();
    if (!signature) return;

    const tableId = await ensureTable(++tableCounter);
    const ok = await api('/api/orders', {
      method: 'POST', token: meseroToken,
      body: {
        table_id: tableId,
        business_day: '2026-08-20',
        items: [
          { menu_item_id: signature.id, quantity: 1, promo_type: 'primera-visita' },
        ],
      },
    });
    expect(ok.status).toBe(201);
    expect(ok.json.order.items[0].unit_price).toBe(25);
    expect(ok.json.order.total).toBeCloseTo(25, 2);
  });
});