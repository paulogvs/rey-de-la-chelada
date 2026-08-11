/**
 * Bootstrap Tests
 *
 * TDD: ensureBootstrap() — the auto-seed that runs at server startup.
 *
 * The bug: PROD DB had schema applied but ZERO staff rows because the
 * seed script was manual-only. Bootstrap guarantees a usable DB on
 * first boot: staff (admin/mesero/kds) + tables + real menu + prices.
 *
 * Verifica:
 *  - empty DB → staff(4: admin/mesero/kds/caja) + tables(10) + categories(8) + items(49) + prices
 *  - idempotente: second run duplicates nothing
 *  - S1/v5: DB con staff existente → ensureBootstrap asegura el rol caja sin duplicar
 *  - does NOT overwrite admin-set prices on existing DB
 */

import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { applySchema } from '../../server/db/schema.js';
import { ensureBootstrap } from '../../server/db/bootstrap.js';

function makeDb() {
  const db = new Database(':memory:');
  applySchema(db);
  return db;
}

describe('ensureBootstrap', () => {
  it('seeds staff + tables + real menu + prices on empty DB', () => {
    const db = makeDb();
    const result = ensureBootstrap(db);

    // Staff: 4 roles with shared PINs (v5: + caja)
    expect(db.prepare('SELECT COUNT(*) AS n FROM staff').get().n).toBe(4);
    const roles = db.prepare('SELECT role FROM staff ORDER BY role').all().map(r => r.role);
    expect(roles).toEqual(['admin', 'caja', 'kds', 'mesero']);

    // Tables: 10
    expect(db.prepare('SELECT COUNT(*) AS n FROM tables').get().n).toBe(10);

    // Real menu: 8 categories, 49 items (NOT the generic 13)
    expect(db.prepare('SELECT COUNT(*) AS n FROM menu_categories').get().n).toBe(8);
    expect(db.prepare('SELECT COUNT(*) AS n FROM menu_items').get().n).toBe(49);
    expect(db.prepare("SELECT COUNT(*) AS n FROM menu_categories WHERE name = 'Cervezas'").get().n).toBe(0);

    // Prices: no NULL prices after bootstrap
    expect(db.prepare('SELECT COUNT(*) AS n FROM menu_items WHERE price IS NULL').get().n).toBe(0);

    // Result summary
    expect(result.seeded).toBe(true);
    db.close();
  });

  it('is idempotent — second run duplicates nothing', () => {
    const db = makeDb();
    ensureBootstrap(db);
    const second = ensureBootstrap(db);

    expect(second.seeded).toBe(false);
    expect(db.prepare('SELECT COUNT(*) AS n FROM staff').get().n).toBe(4);
    expect(db.prepare('SELECT COUNT(*) AS n FROM tables').get().n).toBe(10);
    expect(db.prepare('SELECT COUNT(*) AS n FROM menu_categories').get().n).toBe(8);
    expect(db.prepare('SELECT COUNT(*) AS n FROM menu_items').get().n).toBe(49);
    expect(db.prepare('SELECT COUNT(*) AS n FROM modifier_groups').get().n).toBeGreaterThan(0);
    db.close();
  });

  it('S1/v5: DB con staff existente SIN caja → asegura el rol caja sin duplicar los demás', () => {
    const db = makeDb();
    // Simular DB existente con 3 roles (v4) — sin caja
    db.prepare(`
      INSERT INTO staff (id, pin_hash, role, display_name)
      VALUES ('a1', 'h', 'admin', 'Administrador')
    `).run();
    db.prepare(`
      INSERT INTO staff (id, pin_hash, role, display_name)
      VALUES ('m1', 'h', 'mesero', 'Mesero')
    `).run();

    ensureBootstrap(db);

    const roles = db.prepare('SELECT role FROM staff ORDER BY role').all().map(r => r.role);
    expect(roles).toEqual(['admin', 'caja', 'kds', 'mesero']);
    // No duplica los existentes
    expect(db.prepare("SELECT COUNT(*) AS n FROM staff WHERE role = 'admin'").get().n).toBe(1);
    db.close();
  });

  it('does NOT overwrite admin-set prices on an existing DB', () => {
    const db = makeDb();
    ensureBootstrap(db);

    // Admin changes a price
    db.prepare("UPDATE menu_items SET price = 99 WHERE name = 'Cheve-Chango'").run();

    // Re-run bootstrap (simulates server restart)
    ensureBootstrap(db);

    expect(db.prepare("SELECT price FROM menu_items WHERE name = 'Cheve-Chango'").get().price).toBe(99);
    db.close();
  });

  it('logs a clear message when it seeds', () => {
    const db = makeDb();
    const logs = [];
    const result = ensureBootstrap(db, { log: msg => logs.push(msg) });

    expect(result.seeded).toBe(true);
    expect(logs.some(l => l.includes('Bootstrap'))).toBe(true);
    db.close();
  });

  // ═══ P0-1 (2026-08-11): ajustes de tamaño sobreviven a los restarts ═══

  it('P0-1: pizza size adjustments (Familiar +20 / XL +40) sobreviven al restart', () => {
    const db = makeDb();
    ensureBootstrap(db);

    // Simular restart 1: re-bootstrap
    ensureBootstrap(db);

    const rows = db.prepare(`
      SELECT mo.name, mo.price_adjustment
      FROM modifier_options mo
      JOIN modifier_groups mg ON mo.group_id = mg.id
      WHERE mg.name = 'Tamaño'
    `).all();
    const byName = Object.fromEntries(rows.map(r => [r.name, r.price_adjustment]));
    expect(byName['Familiar']).toBe(20);
    expect(byName['XL']).toBe(40);
    db.close();
  });

  it('P0-1: reaplica los adjustments aunque la DB los tenga en 0 (sanación)', () => {
    const db = makeDb();
    ensureBootstrap(db);

    // Alguien dejó los adjustments en 0 (bug P0-1 original)
    db.prepare('UPDATE modifier_options SET price_adjustment = 0').run();

    // Restart → bootstrap reaplica
    ensureBootstrap(db);

    const xl = db.prepare(`
      SELECT mo.price_adjustment
      FROM modifier_options mo
      JOIN modifier_groups mg ON mo.group_id = mg.id
      WHERE mg.name = 'Tamaño' AND mo.name = 'XL'
    `).get();
    expect(xl.price_adjustment).toBe(40);
    db.close();
  });

  it('P0-1: NO pisa precios de items editados por admin (solo ajusta tamaños)', () => {
    const db = makeDb();
    ensureBootstrap(db);

    // Admin cambia el precio de un item (y de una opción de tamaño)
    db.prepare("UPDATE menu_items SET price = 99 WHERE name = 'La Rey'").run();
    db.prepare(`
      UPDATE modifier_options SET price_adjustment = 55
      WHERE id IN (
        SELECT mo.id FROM modifier_options mo
        JOIN modifier_groups mg ON mo.group_id = mg.id
        JOIN menu_items mi ON mg.menu_item_id = mi.id
        WHERE mi.name = 'La Rey' AND mo.name = 'XL'
      )
    `).run();

    ensureBootstrap(db);

    expect(db.prepare("SELECT price FROM menu_items WHERE name = 'La Rey'").get().price).toBe(99);
    const xl = db.prepare(`
      SELECT mo.price_adjustment
      FROM modifier_options mo
      JOIN modifier_groups mg ON mo.group_id = mg.id
      JOIN menu_items mi ON mg.menu_item_id = mi.id
      WHERE mi.name = 'La Rey' AND mo.name = 'XL'
    `).get();
    // El admin puso 55 → bootstrap NO lo pisa con el plan 40 (menu-seed null conserva)
    expect(xl.price_adjustment).toBe(55);
    db.close();
  });
});
