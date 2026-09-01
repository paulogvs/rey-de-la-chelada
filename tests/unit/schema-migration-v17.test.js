/**
 * Unit — Migración v17 (2026-09-01): area en menu_categories + herencia a items
 *
 * Verifica:
 *   - schema v17: menu_categories tiene columna `area` (aditiva, sin pérdida).
 *   - inferencia: categoría con items → area = área del PRIMER item.
 *   - categoría vacía → default 'cocina'.
 *   - "FORZAR TODO": todos los items del grupo se alinean al área del grupo.
 *   - La migración es idempotente (aplicar 2 veces no rompe).
 */

import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { applySchema, SCHEMA_VERSION } from '../../server/db/schema.js';

/** Simula una DB v16 (menu_categories SIN area, menu_items CON area). */
function seedV16World(db) {
  db.exec(`
    CREATE TABLE menu_categories (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
      emoji TEXT NOT NULL DEFAULT '🍽', sort_order INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE menu_items (
      id TEXT PRIMARY KEY, category_id TEXT NOT NULL, name TEXT NOT NULL,
      price INTEGER, area TEXT NOT NULL DEFAULT 'cocina',
      is_active INTEGER NOT NULL DEFAULT 1, is_available INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0, preparation_time INTEGER NOT NULL DEFAULT 15,
      currency TEXT NOT NULL DEFAULT 'BOB', iva_percentage REAL NOT NULL DEFAULT 13,
      created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE schema_version (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (datetime('now')));
    INSERT INTO schema_version (version) VALUES (16);
  `);
  db.prepare("INSERT INTO menu_categories (id, name) VALUES ('cat-cocina', 'Ensaladas')").run();
  db.prepare("INSERT INTO menu_categories (id, name) VALUES ('cat-bar', 'Micheladas')").run();
  db.prepare("INSERT INTO menu_categories (id, name) VALUES ('cat-vacia', 'Vacía')").run();
  // primer item cocina → el grupo se infiere 'cocina'
  db.prepare("INSERT INTO menu_items (id, category_id, name, price, area) VALUES ('i1', 'cat-cocina', 'Ensalada', 1000, 'cocina')").run();
  // primer item bar → el grupo se infiere 'bar'
  db.prepare("INSERT INTO menu_items (id, category_id, name, price, area) VALUES ('i2', 'cat-bar', 'Mixta', 500, 'bar')").run();
  // item "stale": pertenece a un grupo cocina pero su area es 'bar' → se FUERZA a cocina
  db.prepare("INSERT INTO menu_items (id, category_id, name, price, area) VALUES ('i3', 'cat-cocina', 'Otro', 800, 'bar')").run();
}

describe('Migración v17 — área del grupo (menu_categories.area)', () => {
  it('SCHEMA_VERSION ahora es 17', () => {
    expect(SCHEMA_VERSION).toBe(17);
  });

  it('DB v16 → v17: añade area, infiere por primer item, fuerza items', () => {
    const db = new Database(':memory:');
    seedV16World(db);
    applySchema(db);

    // Columna `area` existe en menu_categories
    const cols = db.prepare('PRAGMA table_info(menu_categories)').all().map(c => c.name);
    expect(cols).toContain('area');

    // Inferencia por primer item
    expect(db.prepare("SELECT area FROM menu_categories WHERE id = 'cat-cocina'").get().area).toBe('cocina');
    expect(db.prepare("SELECT area FROM menu_categories WHERE id = 'cat-bar'").get().area).toBe('bar');
    // Categoría vacía → default cocina
    expect(db.prepare("SELECT area FROM menu_categories WHERE id = 'cat-vacia'").get().area).toBe('cocina');

    // FORZAR TODO: el item stale i3 (bar) se alinea al área de su grupo (cocina)
    expect(db.prepare("SELECT area FROM menu_items WHERE id = 'i3'").get().area).toBe('cocina');
    expect(db.prepare("SELECT area FROM menu_items WHERE id = 'i1'").get().area).toBe('cocina');
    expect(db.prepare("SELECT area FROM menu_items WHERE id = 'i2'").get().area).toBe('bar');

    // Versión registrada
    expect(db.prepare('SELECT version FROM schema_version ORDER BY version DESC LIMIT 1').get().version).toBe(17);
    db.close();
  });

  it('es idempotente: aplicar 2 veces no rompe ni duplica la columna', () => {
    const db = new Database(':memory:');
    seedV16World(db);
    applySchema(db);
    applySchema(db);
    const areaCols = db.prepare('PRAGMA table_info(menu_categories)').all().filter(c => c.name === 'area');
    expect(areaCols).toHaveLength(1);
    expect(db.prepare("SELECT area FROM menu_categories WHERE id = 'cat-bar'").get().area).toBe('bar');
    db.close();
  });
});
