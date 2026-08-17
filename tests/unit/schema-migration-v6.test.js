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
  it('SCHEMA_VERSION ahora es 9 (v9: price_variable/promo_price/promo_label)', () => {
    expect(SCHEMA_VERSION).toBe(9);
  });

  it('DB nueva: payments SIN columna tip, CON received/change y CHECK cash|qr', () => {
    const db = new Database(':memory:');
    applySchema(db);
    expect(hasColumn(db, 'payments', 'tip')).toBe(false);
    expect(hasColumn(db, 'payments', 'received')).toBe(true);
    expect(hasColumn(db, 'payments', 'change')).toBe(true);
    expect(hasColumn(db, 'payments', 'proof_photo')).toBe(true);
    expect(currentVersion(db)).toBe(9);
    // El CHECK solo acepta cash|qr
    const ddl = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='payments'").get().sql;
    expect(ddl).toMatch(/method\s+TEXT NOT NULL CHECK\(method IN \('cash','qr'\)\)/);
    // v7: order_items tiene columna round (default 1)
    expect(hasColumn(db, 'order_items', 'round')).toBe(true);
    const itemsDdl = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='order_items'").get().sql;
    expect(itemsDdl).toMatch(/round\s+INTEGER NOT NULL DEFAULT 1/);
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
    expect(currentVersion(db)).toBe(9);
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
    expect(currentVersion(db)).toBe(9);
    db.close();
  });

  it('upgrade v6→v7: ADD COLUMN round en order_items preserva items existentes (round=1)', () => {
    const db = new Database(':memory:');
    // Simular DB v6 (order_items SIN round) + 1 item existente
    db.prepare(`
      CREATE TABLE schema_version (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`).run();
    db.prepare('INSERT INTO schema_version (version) VALUES (6)').run();
    db.exec(`
      CREATE TABLE staff (id TEXT PRIMARY KEY, pin_hash TEXT NOT NULL, role TEXT NOT NULL, display_name TEXT NOT NULL,
        is_active INTEGER NOT NULL DEFAULT 1, current_shift TEXT, last_login_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')));
      CREATE TABLE tables (id TEXT PRIMARY KEY, number INTEGER NOT NULL UNIQUE, capacity INTEGER NOT NULL DEFAULT 4);
      CREATE TABLE orders (id TEXT PRIMARY KEY, table_id TEXT NOT NULL, table_number INTEGER NOT NULL,
        waiter_id TEXT NOT NULL, waiter_name TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'draft', total REAL NOT NULL DEFAULT 0);
      CREATE TABLE order_items (
        id TEXT PRIMARY KEY, order_id TEXT NOT NULL, menu_item_id TEXT NOT NULL, menu_item_name TEXT NOT NULL,
        quantity INTEGER NOT NULL DEFAULT 1, unit_price REAL NOT NULL, modifiers_json TEXT, subtotal REAL NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','preparing','ready','delivered','cancelled')),
        preparation_notes TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE);
    `);
    seedMiniWorld(db);
    db.prepare(`
      INSERT INTO order_items (id, order_id, menu_item_id, menu_item_name, quantity, unit_price, subtotal, status)
      VALUES ('it1', 'o1', 'm1', 'Chelada Clásica', 2, 15, 30, 'delivered')
    `).run();

    applySchema(db);

    expect(hasColumn(db, 'order_items', 'round')).toBe(true);
    expect(currentVersion(db)).toBe(9);
    // El item existente queda en ronda 1 (no destructivo)
    const item = db.prepare('SELECT * FROM order_items WHERE id = ?').get('it1');
    expect(item.round).toBe(1);
    expect(item.menu_item_name).toBe('Chelada Clásica');
    expect(item.status).toBe('delivered');
    db.close();
  });

  it('upgrade v7→v8: ADD COLUMN proof_photo en payments preserva pagos existentes', () => {
    const db = new Database(':memory:');
    // Simular DB v7 (payments SIN proof_photo) + 1 pago existente
    db.prepare(`
      CREATE TABLE schema_version (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`).run();
    db.prepare('INSERT INTO schema_version (version) VALUES (7)').run();
    db.exec(`
      CREATE TABLE staff (id TEXT PRIMARY KEY, pin_hash TEXT NOT NULL, role TEXT NOT NULL, display_name TEXT NOT NULL,
        is_active INTEGER NOT NULL DEFAULT 1, current_shift TEXT, last_login_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')));
      CREATE TABLE tables (id TEXT PRIMARY KEY, number INTEGER NOT NULL UNIQUE, capacity INTEGER NOT NULL DEFAULT 4);
      CREATE TABLE orders (id TEXT PRIMARY KEY, table_id TEXT NOT NULL, table_number INTEGER NOT NULL,
        waiter_id TEXT NOT NULL, waiter_name TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'draft', total REAL NOT NULL DEFAULT 0);
      CREATE TABLE payments (
        id TEXT PRIMARY KEY, order_id TEXT NOT NULL, method TEXT NOT NULL CHECK(method IN ('cash','qr')),
        amount REAL NOT NULL, iva_amount REAL NOT NULL DEFAULT 0, received REAL NOT NULL DEFAULT 0,
        change REAL NOT NULL DEFAULT 0, reference TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'completed' CHECK(status IN ('pending','completed','failed','refunded')),
        processed_by TEXT NOT NULL, processed_at TEXT NOT NULL DEFAULT (datetime('now')),
        notes TEXT NOT NULL DEFAULT '', synced_at TEXT,
        FOREIGN KEY (order_id) REFERENCES orders(id), FOREIGN KEY (processed_by) REFERENCES staff(id));
    `);
    seedMiniWorld(db);
    db.prepare(`
      INSERT INTO payments (id, order_id, method, amount, received, change, status, processed_by)
      VALUES ('p-v7', 'o1', 'qr', 40, 0, 0, 'completed', 'w1')
    `).run();

    applySchema(db);

    expect(hasColumn(db, 'payments', 'proof_photo')).toBe(true);
    expect(currentVersion(db)).toBe(9);
    // El pago existente queda con proof_photo '' (no destructivo)
    const p = db.prepare('SELECT * FROM payments WHERE id = ?').get('p-v7');
    expect(p.proof_photo).toBe('');
    expect(p.method).toBe('qr');
    expect(p.amount).toBe(40);
    // INSERT nuevo con proof_photo funciona
    db.prepare(`
      INSERT INTO payments (id, order_id, method, amount, received, change, status, processed_by, proof_photo)
      VALUES ('p-v8', 'o1', 'qr', 10, 0, 0, 'completed', 'w1', '/payment-proofs/x.jpg')
    `).run();
    const p2 = db.prepare('SELECT * FROM payments WHERE id = ?').get('p-v8');
    expect(p2.proof_photo).toBe('/payment-proofs/x.jpg');
    db.close();
  });
});
