/**
 * Bootstrap Tests
 *
 * TDD: ensureBootstrap() — the auto-seed that runs at server startup.
 *
 * The bug: PROD DB had schema applied but ZERO staff rows because the
 * seed script was manual-only. Bootstrap guarantees a usable DB on
 * first boot: staff (admin/mesero/kds) + tables + real menu + prices.
 *
 * Verifies:
 *  - empty DB → staff(3) + tables(10) + categories(8) + items(49) + prices
 *  - idempotent: second run duplicates nothing
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

    // Staff: 3 roles with shared PINs
    expect(db.prepare('SELECT COUNT(*) AS n FROM staff').get().n).toBe(3);
    const roles = db.prepare('SELECT role FROM staff ORDER BY role').all().map(r => r.role);
    expect(roles).toEqual(['admin', 'kds', 'mesero']);

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
    expect(db.prepare('SELECT COUNT(*) AS n FROM staff').get().n).toBe(3);
    expect(db.prepare('SELECT COUNT(*) AS n FROM tables').get().n).toBe(10);
    expect(db.prepare('SELECT COUNT(*) AS n FROM menu_categories').get().n).toBe(8);
    expect(db.prepare('SELECT COUNT(*) AS n FROM menu_items').get().n).toBe(49);
    expect(db.prepare('SELECT COUNT(*) AS n FROM modifier_groups').get().n).toBeGreaterThan(0);
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
});
