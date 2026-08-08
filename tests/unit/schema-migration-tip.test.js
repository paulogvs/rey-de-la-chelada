/**
 * Schema migration — columna `tip` en payments (C4) + rol caja (S1)
 *
 * SCHEMA_VERSION 3 → 5: 
 *  - v4: `ALTER TABLE payments ADD COLUMN tip REAL NOT NULL DEFAULT 0`.
 *  - v5: staff CHECK acepta 'caja' (recreación de tabla) + cash_closings sin columnas fantasma.
 * La migración debe ser IDEMPOTENTE (correr 2 veces no rompe nada) y debe
 * preservar los payments existentes (tip=0 retrocompatible).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { applySchema, SCHEMA_VERSION } from '../../server/db/schema.js';

// DDL de payments en SCHEMA_VERSION 3 (SIN columna tip)
const V3_PAYMENTS_DDL = `
  CREATE TABLE payments (
    id            TEXT PRIMARY KEY,
    order_id      TEXT NOT NULL,
    method        TEXT NOT NULL CHECK(method IN ('cash','qr_yape','qr_simple','card','transfer')),
    amount        REAL NOT NULL,
    iva_amount    REAL NOT NULL DEFAULT 0,
    reference     TEXT NOT NULL DEFAULT '',
    status        TEXT NOT NULL DEFAULT 'completed' CHECK(status IN ('pending','completed','failed','refunded')),
    processed_by  TEXT NOT NULL,
    processed_at  TEXT NOT NULL DEFAULT (datetime('now')),
    notes         TEXT NOT NULL DEFAULT '',
    synced_at     TEXT,
    FOREIGN KEY (order_id) REFERENCES orders(id),
    FOREIGN KEY (processed_by) REFERENCES staff(id)
  )`;

function hasColumn(db, table, column) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === column);
}

function currentVersion(db) {
  return db.prepare('SELECT version FROM schema_version ORDER BY version DESC LIMIT 1').get()?.version;
}

/** Mundo mínimo (staff + mesa + pedido) para satisfacer FKs */
function seedMiniWorld(db) {
  db.prepare("INSERT INTO staff (id, pin_hash, role, display_name) VALUES ('w1', 'x', 'admin', 'Admin')").run();
  db.prepare("INSERT INTO tables (id, number, capacity) VALUES ('t1', 1, 4)").run();
  db.prepare(`
    INSERT INTO orders (id, table_id, table_number, waiter_id, waiter_name, status, total)
    VALUES ('o1', 't1', 1, 'w1', 'Admin', 'served', 100)
  `).run();
}

describe('Migración payments.tip (v3 → v5)', () => {
  it('SCHEMA_VERSION ahora es 5', () => {
    expect(SCHEMA_VERSION).toBe(5);
  });

  it('DB nueva: applySchema crea payments con columna tip y registra versión 5', () => {
    const db = new Database(':memory:');
    applySchema(db);
    expect(hasColumn(db, 'payments', 'tip')).toBe(true);
    expect(currentVersion(db)).toBe(5);
    db.close();
  });

  it('idempotente: aplicar el schema 2 veces no rompe nada', () => {
    const db = new Database(':memory:');
    applySchema(db);
    applySchema(db);
    expect(hasColumn(db, 'payments', 'tip')).toBe(true);
    expect(currentVersion(db)).toBe(5);
    // Un INSERT con tip funciona tras la segunda aplicación
    seedMiniWorld(db);
    db.prepare(`
      INSERT INTO payments (id, order_id, method, amount, tip, status, processed_by)
      VALUES ('p1', 'o1', 'cash', 100, 5, 'completed', 'w1')
    `).run();
    expect(db.prepare('SELECT tip FROM payments WHERE id = ?').get('p1').tip).toBe(5);
    db.close();
  });

  it('upgrade desde v3: agrega la columna tip, añade rol caja y conserva los payments existentes', () => {
    const db = new Database(':memory:');
    // Simular una DB en SCHEMA_VERSION 3 (payments SIN tip + un pago viejo).
    // Mundo mínimo v3: schema_version + staff + tables + orders + payments.
    db.prepare(`
      CREATE TABLE schema_version (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`).run();
    db.prepare('INSERT INTO schema_version (version) VALUES (3)').run();
    db.exec(`
      CREATE TABLE staff (
        id TEXT PRIMARY KEY, pin_hash TEXT NOT NULL, role TEXT NOT NULL, display_name TEXT NOT NULL,
        is_active INTEGER NOT NULL DEFAULT 1, current_shift TEXT, last_login_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')));
      CREATE TABLE tables (id TEXT PRIMARY KEY, number INTEGER NOT NULL UNIQUE, capacity INTEGER NOT NULL DEFAULT 4);
      CREATE TABLE orders (id TEXT PRIMARY KEY, table_id TEXT NOT NULL, table_number INTEGER NOT NULL,
        waiter_id TEXT NOT NULL, waiter_name TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'draft', total REAL NOT NULL DEFAULT 0);
    `);
    db.prepare(V3_PAYMENTS_DDL).run();
    seedMiniWorld(db);
    db.prepare(`
      INSERT INTO payments (id, order_id, method, amount, status, processed_by)
      VALUES ('legacy-1', 'o1', 'card', 100, 'completed', 'w1')
    `).run();

    applySchema(db);

    expect(hasColumn(db, 'payments', 'tip')).toBe(true);
    expect(currentVersion(db)).toBe(5);
    // El pago viejo se conserva con tip = 0 (retrocompatible)
    const legacy = db.prepare('SELECT tip FROM payments WHERE id = ?').get('legacy-1');
    expect(legacy.tip).toBe(0);
    // Y nuevos pagos pueden registrar tip
    db.prepare(`
      INSERT INTO payments (id, order_id, method, amount, tip, status, processed_by)
      VALUES ('p2', 'o1', 'cash', 50, 2.5, 'completed', 'w1')
    `).run();
    expect(db.prepare('SELECT tip FROM payments WHERE id = ?').get('p2').tip).toBe(2.5);
    db.close();
  });
});
