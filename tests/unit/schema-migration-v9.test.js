/**
 * Schema migration v8 → v9 (S1 — menú oficial de barra + promos)
 *
 * v9 agrega soporte de precios variable/promocionales:
 *  - menu_items.price_variable INTEGER NOT NULL DEFAULT 0 — precio MANUAL
 *    ("Consultar precio", ej. Negra Ahumada / Flor de Caña).
 *  - menu_items.promo_price REAL NULL — precio promocional (Miércoles de Barra
 *    12, Primera Visita 25); NULL = sin promo.
 *  - order_items.promo_label TEXT NULL — 'Promo' cuando la línea se facturó
 *    con promo_price (el ticket imprime "(Promo)").
 *
 * Migración debe:
 *  - Aplicar las 3 ADD COLUMN sin romper datos existentes.
 *  - Preservar idempotencia (2 aplicaciones seguidas no rompen nada).
 */

import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { applySchema, SCHEMA_VERSION } from '../../server/db/schema.js';

function hasColumn(db, table, column) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === column);
}

function currentVersion(db) {
  return db.prepare('SELECT version FROM schema_version ORDER BY version DESC LIMIT 1').get()?.version;
}

function seedMiniWorld(db) {
  db.prepare("INSERT INTO staff (id, pin_hash, role, display_name) VALUES ('w1', 'x', 'admin', 'Admin')").run();
  db.prepare("INSERT INTO tables (id, number, capacity) VALUES ('t1', 1, 4)").run();
  db.prepare(`
    INSERT INTO orders (id, table_id, table_number, waiter_id, waiter_name, status, total)
    VALUES ('o1', 't1', 1, 'w1', 'Admin', 'paid', 100)
  `).run();
}

describe('Migración v9 — precio manual (price_variable), promo_price y promo_label', () => {
  it('SCHEMA_VERSION ahora es 13 (motor financiero)', () => {
    expect(SCHEMA_VERSION).toBe(13);
  });

  it('DB nueva: menu_items con price_variable + promo_price y order_items con promo_label', () => {
    const db = new Database(':memory:');
    applySchema(db);
    expect(hasColumn(db, 'menu_items', 'price_variable')).toBe(true);
    expect(hasColumn(db, 'menu_items', 'promo_price')).toBe(true);
    expect(hasColumn(db, 'order_items', 'promo_label')).toBe(true);
    expect(hasColumn(db, 'order_items', 'promo_type')).toBe(true); // v10
    expect(currentVersion(db)).toBe(13);

    // Defaults correctos
    const itemsDdl = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='menu_items'").get().sql;
    expect(itemsDdl).toMatch(/price_variable\s+INTEGER NOT NULL DEFAULT 0/);
    expect(itemsDdl).toMatch(/promo_price\s+INTEGER/); // v11: centavos
    const itemsDdl2 = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='order_items'").get().sql;
    expect(itemsDdl2).toMatch(/promo_label\s+TEXT/);
    expect(itemsDdl2).toMatch(/promo_type\s+TEXT/); // v10
    db.close();
  });

  it('upgrade v8→v9: ADD COLUMN preserva items existentes (price_variable=0, promo_price=NULL)', () => {
    const db = new Database(':memory:');
    // Simular DB v8 (menu_items SIN price_variable/promo_price, order_items SIN promo_label)
    db.prepare(`
      CREATE TABLE schema_version (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`).run();
    db.prepare('INSERT INTO schema_version (version) VALUES (8)').run();
    db.exec(`
      CREATE TABLE staff (
        id TEXT PRIMARY KEY, pin_hash TEXT NOT NULL, role TEXT NOT NULL, display_name TEXT NOT NULL,
        is_active INTEGER NOT NULL DEFAULT 1, current_shift TEXT, last_login_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')));
      CREATE TABLE tables (id TEXT PRIMARY KEY, number INTEGER NOT NULL UNIQUE, capacity INTEGER NOT NULL DEFAULT 4);
      CREATE TABLE orders (id TEXT PRIMARY KEY, table_id TEXT NOT NULL, table_number INTEGER NOT NULL,
        waiter_id TEXT NOT NULL, waiter_name TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'draft', total REAL NOT NULL DEFAULT 0);
      CREATE TABLE menu_items (
        id TEXT PRIMARY KEY, category_id TEXT NOT NULL, name TEXT NOT NULL, subtitle TEXT,
        description TEXT NOT NULL DEFAULT '', price REAL, currency TEXT NOT NULL DEFAULT 'BOB',
        iva_percentage REAL NOT NULL DEFAULT 13, image_url TEXT, is_active INTEGER NOT NULL DEFAULT 1,
        is_available INTEGER NOT NULL DEFAULT 1, preparation_time INTEGER NOT NULL DEFAULT 15,
        sort_order INTEGER NOT NULL DEFAULT 0, area TEXT NOT NULL CHECK(area IN ('bar','cocina')),
        has_ice INTEGER NOT NULL DEFAULT 0, ingredient_list TEXT, garnish_list TEXT,
        recipe_json TEXT, size_variants TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')));
      CREATE TABLE order_items (
        id TEXT PRIMARY KEY, order_id TEXT NOT NULL, menu_item_id TEXT NOT NULL, menu_item_name TEXT NOT NULL,
        quantity INTEGER NOT NULL DEFAULT 1, unit_price REAL NOT NULL, modifiers_json TEXT, subtotal REAL NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','preparing','ready','delivered','cancelled')),
        round INTEGER NOT NULL DEFAULT 1, preparation_notes TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE);
    `);
    seedMiniWorld(db);
    // Item existente v8 con precio normal
    db.prepare(`
      INSERT INTO menu_items (id, category_id, name, price, area)
      VALUES ('m1', 'c1', 'Isla Dorada', 15, 'bar')
    `).run();
    db.prepare(`
      INSERT INTO order_items (id, order_id, menu_item_id, menu_item_name, quantity, unit_price, subtotal, status)
      VALUES ('it1', 'o1', 'm1', 'Isla Dorada', 2, 15, 30, 'delivered')
    `).run();

    applySchema(db);

    expect(hasColumn(db, 'menu_items', 'price_variable')).toBe(true);
    expect(hasColumn(db, 'menu_items', 'promo_price')).toBe(true);
    expect(hasColumn(db, 'order_items', 'promo_label')).toBe(true);
    expect(currentVersion(db)).toBe(13);

    // No destructivo: item existente queda con defaults v9
    const item = db.prepare('SELECT * FROM menu_items WHERE id = ?').get('m1');
    expect(item.price_variable).toBe(0);
    expect(item.promo_price).toBe(null);
    expect(item.price).toBe(1500);
    const oi = db.prepare('SELECT * FROM order_items WHERE id = ?').get('it1');
    expect(oi.promo_label).toBe(null);
    expect(oi.unit_price).toBe(1500);

    // INSERT con las columnas nuevas funciona
    db.prepare(`
      INSERT INTO menu_items (id, category_id, name, price, price_variable, promo_price, area)
      VALUES ('m2', 'c1', 'Negra Ahumada', NULL, 1, NULL, 'bar')
    `).run();
    const m2 = db.prepare('SELECT * FROM menu_items WHERE id = ?').get('m2');
    expect(m2.price_variable).toBe(1);
    expect(m2.price).toBe(null);
    db.prepare(`
      INSERT INTO order_items (id, order_id, menu_item_id, menu_item_name, quantity, unit_price, promo_label, subtotal, status)
      VALUES ('it2', 'o1', 'm2', 'Negra Ahumada', 1, 30, 'Promo', 30, 'pending')
    `).run();
    const it2 = db.prepare('SELECT * FROM order_items WHERE id = ?').get('it2');
    expect(it2.promo_label).toBe('Promo');
    db.close();
  });

  it('idempotente: aplicar 2 veces no rompe nada', () => {
    const db = new Database(':memory:');
    applySchema(db);
    seedMiniWorld(db);
    db.prepare("INSERT INTO menu_categories (id, name, sort_order) VALUES ('c1', 'Micheladas Signature', 0)").run();
    db.prepare(`
      INSERT INTO menu_items (id, category_id, name, price, price_variable, promo_price, area)
      VALUES ('m1', 'c1', 'Isla Dorada', 1500, 0, 1200, 'bar')
    `).run();
    applySchema(db);
    const item = db.prepare('SELECT * FROM menu_items WHERE id = ?').get('m1');
    expect(item.promo_price).toBe(1200);
    expect(item.price_variable).toBe(0);
    expect(currentVersion(db)).toBe(13);
    db.close();
  });

  it('DB parcial (solo falta promo_label): migra solo lo que falta', () => {
    const db = new Database(':memory:');
    applySchema(db); // v9 completa
    // Simular que ALGUIEN borró promo_label (DB parcial)
    db.exec(`ALTER TABLE order_items DROP COLUMN promo_label`);
    // sube el version a 9 → no debe migrar (version >= SCHEMA_VERSION)
    applySchema(db);
    expect(currentVersion(db)).toBe(13);
    expect(hasColumn(db, 'order_items', 'promo_label')).toBe(false);
    db.close();
  });
});
