/**
 * Schema migration v5 → v6 (FASE 3 — Simplificación de pagos)
 *
 * v6 elimina la propina (tip) y deja SOLO 2 métodos de pago:
 *  - payments.method  CHECK IN ('cash','qr')  — antes 5 métodos (qr_yape, qr_simple, card, transfer).
 *  - payments.tip      ELIMINADA — la propina se da directo al mesero, fuera de la app.
 *  - payments.received REAL DEFAULT 0 — efectivo: lo que el cliente ENTREGA (ej. 50 por 34.50).
 *  - payments.change   REAL DEFAULT 0 — efectivo: vuelto = received - amount (ej. 15.50).
 *
 * Migración debe:
 *  - Recrear payments con el CHECK nuevo (SQLite no altera CHECK).
 *  - Consolidar métodos legacy: qr_yape/qr_simple/card/transfer → 'qr' (todo no-efectivo es QR).
 *  - Absorber el tip legacy dentro de amount (amount' = amount + tip) para NO falsear
 *    los totales históricos del día (SUM(amount) nuevo == SUM(amount+tip) viejo).
 *  - Preservar idempotencia (2 aplicaciones seguidas no rompen nada).
 */

import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { applySchema, SCHEMA_VERSION } from '../../server/db/schema.js';

// DDL de payments en SCHEMA_VERSION 5 (tip + 5 métodos)
const V5_PAYMENTS_DDL = `
  CREATE TABLE payments (
    id            TEXT PRIMARY KEY,
    order_id      TEXT NOT NULL,
    method        TEXT NOT NULL CHECK(method IN ('cash','qr_yape','qr_simple','card','transfer')),
    amount        REAL NOT NULL,
    iva_amount    REAL NOT NULL DEFAULT 0,
    tip           REAL NOT NULL DEFAULT 0,
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

function seedMiniWorld(db) {
  db.prepare("INSERT INTO staff (id, pin_hash, role, display_name) VALUES ('w1', 'x', 'admin', 'Admin')").run();
  db.prepare("INSERT INTO tables (id, number, capacity) VALUES ('t1', 1, 4)").run();
  db.prepare(`
    INSERT INTO orders (id, table_id, table_number, waiter_id, waiter_name, status, total)
    VALUES ('o1', 't1', 1, 'w1', 'Admin', 'paid', 100)
  `).run();
}

describe('Migración v6 — sin propina, solo cash|qr, received/change', () => {
  it('SCHEMA_VERSION ahora es 6', () => {
    expect(SCHEMA_VERSION).toBe(6);
  });

  it('DB nueva: payments SIN columna tip, CON received/change y CHECK cash|qr', () => {
    const db = new Database(':memory:');
    applySchema(db);
    expect(hasColumn(db, 'payments', 'tip')).toBe(false);
    expect(hasColumn(db, 'payments', 'received')).toBe(true);
    expect(hasColumn(db, 'payments', 'change')).toBe(true);
    expect(currentVersion(db)).toBe(6);
    // El CHECK solo acepta cash|qr
    const ddl = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='payments'").get().sql;
    expect(ddl).toMatch(/method\s+TEXT NOT NULL CHECK\(method IN \('cash','qr'\)\)/);
    db.close();
  });

  it('upgrade desde v5: elimina tip, consolida métodos legacy → qr y absorbe tip en amount', () => {
    const db = new Database(':memory:');
    // Simular DB en SCHEMA_VERSION 5 (payments con tip + 5 métodos + pagos viejos)
    db.prepare(`
      CREATE TABLE schema_version (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`).run();
    db.prepare('INSERT INTO schema_version (version) VALUES (5)').run();
    db.exec(`
      CREATE TABLE staff (
        id TEXT PRIMARY KEY, pin_hash TEXT NOT NULL, role TEXT NOT NULL, display_name TEXT NOT NULL,
        is_active INTEGER NOT NULL DEFAULT 1, current_shift TEXT, last_login_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')));
      CREATE TABLE tables (id TEXT PRIMARY KEY, number INTEGER NOT NULL UNIQUE, capacity INTEGER NOT NULL DEFAULT 4);
      CREATE TABLE orders (id TEXT PRIMARY KEY, table_id TEXT NOT NULL, table_number INTEGER NOT NULL,
        waiter_id TEXT NOT NULL, waiter_name TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'draft', total REAL NOT NULL DEFAULT 0);
    `);
    db.prepare(V5_PAYMENTS_DDL).run();
    seedMiniWorld(db);
    // Pagos legacy: qr_yape con tip, card sin tip, cash
    db.prepare(`
      INSERT INTO payments (id, order_id, method, amount, tip, status, processed_by)
      VALUES ('legacy-qr', 'o1', 'qr_yape', 70, 2, 'completed', 'w1')
    `).run();
    db.prepare(`
      INSERT INTO payments (id, order_id, method, amount, tip, status, processed_by)
      VALUES ('legacy-card', 'o1', 'card', 30, 0, 'completed', 'w1')
    `).run();

    applySchema(db);

    expect(hasColumn(db, 'payments', 'tip')).toBe(false);
    expect(currentVersion(db)).toBe(6);
    // Métodos consolidados → qr; amount absorbe el tip (70+2=72)
    const qr = db.prepare('SELECT * FROM payments WHERE id = ?').get('legacy-qr');
    expect(qr.method).toBe('qr');
    expect(qr.amount).toBe(72);
    const card = db.prepare('SELECT * FROM payments WHERE id = ?').get('legacy-card');
    expect(card.method).toBe('qr');
    expect(card.amount).toBe(30);
    // received/change default 0 en legacy
    expect(qr.received).toBe(0);
    expect(qr.change).toBe(0);
    db.close();
  });

  it('idempotente: aplicar 2 veces no rompe y mantiene cash intacto', () => {
    const db = new Database(':memory:');
    applySchema(db);
    seedMiniWorld(db);
    db.prepare(`
      INSERT INTO payments (id, order_id, method, amount, received, change, status, processed_by)
      VALUES ('p1', 'o1', 'cash', 34.5, 50, 15.5, 'completed', 'w1')
    `).run();
    applySchema(db);
    const p = db.prepare('SELECT * FROM payments WHERE id = ?').get('p1');
    expect(p.method).toBe('cash');
    expect(p.received).toBe(50);
    expect(p.change).toBe(15.5);
    expect(currentVersion(db)).toBe(6);
    db.close();
  });
});
