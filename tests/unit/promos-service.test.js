/**
 * promos-service + extras-service — promos data-driven (v15 2026-08-29).
 *
 * Valida: CRUD de promos, schedule por día/rango, activas del día laboral,
 * y extras por grupo (con su precio).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';

const { dbRef } = vi.hoisted(() => ({ dbRef: { db: null } }));
vi.mock('../../server/db/index.js', () => ({ getDb: () => dbRef.db }));

const { listPromos, createPromo, updatePromo, setPromoActive, deletePromo, activePromosForBusinessDay } =
  await import('../../server/services/promos-service.js');
const { createExtra, activeExtrasForCategory, deleteExtra } =
  await import('../../server/services/extras-service.js');

const tmpDirs = [];

function makeDb() {
  const dir = mkdtempSync(join(tmpdir(), 'rdc-promos-test-'));
  tmpDirs.push(dir);
  const db = new Database(join(dir, 'p.db'));
  db.exec(`
    CREATE TABLE menu_categories (id TEXT PRIMARY KEY, name TEXT);
    CREATE TABLE menu_items (id TEXT PRIMARY KEY, category_id TEXT, name TEXT, price INTEGER);
    CREATE TABLE category_extras (
      id TEXT PRIMARY KEY, category_id TEXT NOT NULL, name TEXT NOT NULL,
      price INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE promos (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, label TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '', price_total INTEGER NOT NULL DEFAULT 0,
      price_mode TEXT NOT NULL DEFAULT 'FIXED', price_value INTEGER NOT NULL DEFAULT 0,
      max_per_order INTEGER NOT NULL DEFAULT 1, active INTEGER NOT NULL DEFAULT 1,
      created_by TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE promo_lines (
      id TEXT PRIMARY KEY, promo_id TEXT NOT NULL, item_id TEXT, group_id TEXT,
      quantity INTEGER NOT NULL DEFAULT 1, extra_id TEXT, extra_price INTEGER
    );
    CREATE TABLE promo_schedule (
      id TEXT PRIMARY KEY, promo_id TEXT NOT NULL, day_of_week INTEGER,
      start_date TEXT, end_date TEXT
    );
    INSERT INTO menu_categories VALUES ('pizzas','Pizzas'),('micheladas','Micheladas Especiales');
    INSERT INTO menu_items VALUES ('p1','pizzas','Pizza Grande',5000),('m1','micheladas','Michelada Rubia',3000);
  `);
  return db;
}

beforeEach(() => { dbRef.db = makeDb(); });
afterEach(() => {
  if (dbRef.db) dbRef.db.close();
  for (const d of tmpDirs.splice(0)) { try { rmSync(d, { recursive: true, force: true }); } catch {} }
});

describe('promos-service (data-driven)', () => {
  it('CRUD: crea promo con líneas + schedule, la lista y la borra', () => {
    const promo = createPromo({
      name: '2x1 Quesadillas',
      label: '2x1 Quesadillas',
      price_total: 2000,
      lines: [{ group_id: 'pizzas', quantity: 2 }],
      schedule: [{ day_of_week: 6 }], // sábado
    }, 'admin');
    expect(promo.id).toBeTruthy();
    expect(promo.lines).toHaveLength(1);
    expect(promo.schedule).toHaveLength(1);

    expect(listPromos()).toHaveLength(1);
    deletePromo(promo.id);
    expect(listPromos()).toHaveLength(0);
  });

  it('activa el día correcto: sábado (dow 6) sí, lunes (dow 1) no', () => {
    const promo = createPromo({
      name: '2x1 Quesadillas', label: '2x1', price_total: 2000,
      lines: [{ group_id: 'pizzas', quantity: 2 }],
      schedule: [{ day_of_week: 6 }],
    }, 'admin');
    const sat = activePromosForBusinessDay('2026-09-05'); // sábado 05/09/2026
    expect(sat.some(p => p.id === promo.id)).toBe(true);
    const mon = activePromosForBusinessDay('2026-09-07'); // lunes
    expect(mon.some(p => p.id === promo.id)).toBe(false);
  });

  it('toggle: al desactivar, deja de aparecer activa', () => {
    const promo = createPromo({
      name: 'Combo Pizza + Michelada', label: 'Combo', price_total: 6000,
      lines: [{ group_id: 'pizzas' }, { item_id: 'm1' }],
      schedule: [{ day_of_week: 0 }], // domingo
    }, 'admin');
    expect(activePromosForBusinessDay('2026-09-06').some(p => p.id === promo.id)).toBe(true);
    setPromoActive(promo.id, false);
    expect(activePromosForBusinessDay('2026-09-06').some(p => p.id === promo.id)).toBe(false);
  });

  it('rango de fechas: activa dentro del rango, inactiva fuera', () => {
    const promo = createPromo({
      name: 'Promo 05-07 sep', label: 'Promo', price_total: 1000,
      lines: [{ item_id: 'p1' }],
      schedule: [{ start_date: '2026-09-05', end_date: '2026-09-07' }],
    }, 'admin');
    expect(activePromosForBusinessDay('2026-09-06').some(p => p.id === promo.id)).toBe(true);
    expect(activePromosForBusinessDay('2026-09-10').some(p => p.id === promo.id)).toBe(false);
  });
});

describe('extras-service (por grupo)', () => {
  it('crea extra en un grupo y lo devuelve activo', () => {
    const extra = createExtra('pizzas', { name: 'Extra queso', price: 1000 });
    expect(extra.id).toBeTruthy();
    const active = activeExtrasForCategory('pizzas');
    expect(active).toHaveLength(1);
    expect(active[0].name).toBe('Extra queso');
    expect(active[0].price).toBe(1000);
    // no se filtra a otro grupo
    expect(activeExtrasForCategory('micheladas')).toHaveLength(0);
  });

  it('elimina extra', () => {
    const extra = createExtra('micheladas', { name: 'Extra limón', price: 500 });
    deleteExtra(extra.id);
    expect(activeExtrasForCategory('micheladas')).toHaveLength(0);
  });
});