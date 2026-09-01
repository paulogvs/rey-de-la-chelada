/**
 * Schema migration v4 → v5 — rol 'caja' real en staff
 *
 * S1/T1: SQLite NO permite ALTER TABLE para cambiar un CHECK. La migración
 * v5 recrea la tabla `staff` (nueva CHECK con 'caja') preservando los datos
 * existentes. Idempotente: si el CHECK ya incluye 'caja', no recrea.
 *
 * Verifica:
 *  - SCHEMA_VERSION = 11
 *  - DB nueva: staff acepta role 'caja'
 *  - Upgrade v4→v6: datos preservados + INSERT role 'caja' funciona
 *  - Idempotente: aplicar 2 veces no rompe nada
 */

import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { applySchema, SCHEMA_VERSION } from '../../server/db/schema.js';

// DDL de staff en SCHEMA_VERSION 4 (SIN 'caja' en el CHECK)
const V4_STAFF_DDL = `
  CREATE TABLE staff (
    id          TEXT PRIMARY KEY,
    pin_hash    TEXT NOT NULL,
    role        TEXT NOT NULL CHECK(role IN ('admin','mesero','kds')),
    display_name TEXT NOT NULL,
    is_active   INTEGER NOT NULL DEFAULT 1,
    current_shift TEXT,
    last_login_at TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
  )`;

// DDL de cash_closings en SCHEMA_VERSION 4 (con columnas fantasma)
const V4_CASH_CLOSINGS_DDL = `
  CREATE TABLE cash_closings (
    id              TEXT PRIMARY KEY,
    closing_date    TEXT NOT NULL,
    opened_at       TEXT NOT NULL,
    closed_at       TEXT,
    opened_by       TEXT NOT NULL,
    closed_by       TEXT,
    total_sales     REAL NOT NULL DEFAULT 0,
    total_iva       REAL NOT NULL DEFAULT 0,
    total_orders    INTEGER NOT NULL DEFAULT 0,
    sales_by_method TEXT,
    expected_cash   REAL NOT NULL DEFAULT 0,
    actual_cash     REAL NOT NULL DEFAULT 0,
    cash_difference REAL NOT NULL DEFAULT 0,
    is_reconciled   INTEGER NOT NULL DEFAULT 0,
    notes           TEXT NOT NULL DEFAULT '',
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (opened_by) REFERENCES staff(id),
    FOREIGN KEY (closed_by) REFERENCES staff(id)
  )`;

function hasColumn(db, table, column) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === column);
}

function currentVersion(db) {
  return db.prepare('SELECT version FROM schema_version ORDER BY version DESC LIMIT 1').get()?.version;
}

/** Mundo mínimo v4: schema_version(4) + staff viejo + cash_closings viejo + 1 staff */
function seedV4World(db) {
  db.prepare(`
    CREATE TABLE schema_version (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`).run();
  db.prepare('INSERT INTO schema_version (version) VALUES (4)').run();
  db.exec(V4_STAFF_DDL);
  db.exec(V4_CASH_CLOSINGS_DDL);
  db.prepare(`
    INSERT INTO staff (id, pin_hash, role, display_name, is_active)
    VALUES ('admin-1', 'hash', 'admin', 'Administrador', 1)
  `).run();
}

describe('Migración staff rol caja (v4 → v6)', () => {
  it('SCHEMA_VERSION ahora es 13 (motor financiero)', () => {
    expect(SCHEMA_VERSION).toBe(16);
  });

  it('DB nueva: applySchema crea staff que acepta role caja y registra versión 11', () => {
    const db = new Database(':memory:');
    applySchema(db);
    expect(currentVersion(db)).toBe(16);
    db.prepare(`
      INSERT INTO staff (id, pin_hash, role, display_name)
      VALUES ('caja-1', 'hash', 'caja', 'Cajero')
    `).run();
    const row = db.prepare('SELECT role FROM staff WHERE id = ?').get('caja-1');
    expect(row.role).toBe('caja');
    db.close();
  });

  it('upgrade v4→v6: recrea staff con CHECK nuevo, preserva datos y acepta caja', () => {
    const db = new Database(':memory:');
    seedV4World(db);

    applySchema(db);

    expect(currentVersion(db)).toBe(16);
    // Los datos existentes se preservan
    const admin = db.prepare('SELECT role, display_name FROM staff WHERE id = ?').get('admin-1');
    expect(admin.role).toBe('admin');
    expect(admin.display_name).toBe('Administrador');
    // Y ahora INSERT con role 'caja' funciona (CHECK nuevo)
    db.prepare(`
      INSERT INTO staff (id, pin_hash, role, display_name)
      VALUES ('caja-1', 'hash', 'caja', 'Cajero')
    `).run();
    expect(db.prepare('SELECT role FROM staff WHERE id = ?').get('caja-1').role).toBe('caja');
    db.close();
  });

  it('idempotente: aplicar el schema 2 veces (v6→v6) no rompe nada', () => {
    const db = new Database(':memory:');
    applySchema(db);
    applySchema(db);
    expect(currentVersion(db)).toBe(16);
    db.prepare(`
      INSERT INTO staff (id, pin_hash, role, display_name)
      VALUES ('caja-1', 'hash', 'caja', 'Cajero')
    `).run();
    db.close();
  });

  it('la migración no deja violaciones de FK (foreign_key_check vacío)', () => {
    const db = new Database(':memory:');
    seedV4World(db);
    applySchema(db);
    const violations = db.prepare('PRAGMA foreign_key_check').all();
    expect(violations).toEqual([]);
    db.close();
  });
});

// T6 — cash_closings: las columnas fantasma se eliminan preservando datos
describe('Migración cash_closings sin columnas fantasma (T6, misma v7)', () => {
  it('upgrade v4→v6: elimina total_sales/total_iva/total_orders/sales_by_method y preserva la fila real', () => {
    const db = new Database(':memory:');
    seedV4World(db);
    // Un cash_closing real en DEV (1 fila) que debe sobrevivir intacto
    db.prepare(`
      INSERT INTO cash_closings (id, closing_date, opened_at, opened_by, closed_at, closed_by,
                                 total_sales, total_iva, total_orders, sales_by_method,
                                 expected_cash, actual_cash, cash_difference, is_reconciled, notes)
      VALUES ('cc-1', '2026-08-06', '2026-08-06 20:00:00', 'admin-1', '2026-08-06 23:00:00', 'admin-1',
              500, 57.5, 12, '{"cash":400}', 400, 400, 0, 1, 'cierre demo')
    `).run();

    applySchema(db);

    expect(currentVersion(db)).toBe(16);
    // Columnas fantasma ELIMINADAS
    expect(hasColumn(db, 'cash_closings', 'total_sales')).toBe(false);
    expect(hasColumn(db, 'cash_closings', 'total_iva')).toBe(false);
    expect(hasColumn(db, 'cash_closings', 'total_orders')).toBe(false);
    expect(hasColumn(db, 'cash_closings', 'sales_by_method')).toBe(false);
    // Columnas reales intactas
    expect(hasColumn(db, 'cash_closings', 'expected_cash')).toBe(true);
    expect(hasColumn(db, 'cash_closings', 'actual_cash')).toBe(true);
    expect(hasColumn(db, 'cash_closings', 'is_reconciled')).toBe(true);
    // La fila real se preserva con sus valores (v11: ×100 → centavos)
    const row = db.prepare('SELECT * FROM cash_closings WHERE id = ?').get('cc-1');
    expect(row.expected_cash).toBe(40000);
    expect(row.actual_cash).toBe(40000);
    expect(row.is_reconciled).toBe(1);
    expect(row.notes).toBe('cierre demo');
    db.close();
  });

  it('DB nueva: cash_closings NO tiene columnas fantasma', () => {
    const db = new Database(':memory:');
    applySchema(db);
    expect(hasColumn(db, 'cash_closings', 'total_sales')).toBe(false);
    expect(hasColumn(db, 'cash_closings', 'sales_by_method')).toBe(false);
    db.close();
  });
});
