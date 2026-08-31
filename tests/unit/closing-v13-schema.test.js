/**
 * Unit — Cierre de caja v13 (2026-08-25): schema + desglose rediseñado
 *
 * Verifica:
 *   - schema v13: cash_closings tiene las 6 columnas nuevas (defaults 0)
 *   - la migración es idempotente (aplicar 2 veces no rompe)
 *   - DB fresh: las columnas existen
 */

import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { applySchema } from '../../server/db/schema.js';

function makeDb() {
  const db = new Database(':memory:');
  applySchema(db);
  return db;
}

const V13_COLUMNS = ['opening_cash', 'expenses_cash', 'expenses_qr', 'expected_qr', 'total_general', 'transactions'];

describe('Schema v13 — cierre de caja rediseñado', () => {
  it('DB fresh: cash_closings tiene las 6 columnas nuevas con defaults 0', () => {
    const db = makeDb();
    const cols = db.prepare('PRAGMA table_info(cash_closings)').all();
    const names = cols.map(c => c.name);
    for (const col of V13_COLUMNS) {
      expect(names).toContain(col);
    }
    // Las columnas son INTEGER con default 0
    const opening = cols.find(c => c.name === 'opening_cash');
    expect(opening.type).toContain('INTEGER');
    expect(String(opening.dflt_value)).toBe('0');
    // Versión registrada
    expect(db.prepare('SELECT version FROM schema_version').get().version).toBe(15);
    db.close();
  });

  it('migración idempotente: aplicar schema 2 veces no rompe nada', () => {
    const db = makeDb();
    applySchema(db);
    const cols = db.prepare('PRAGMA table_info(cash_closings)').all();
    expect(cols.filter(c => c.name === 'opening_cash')).toHaveLength(1);
    // Insertar una fila con los defaults y leerla
    db.prepare("INSERT INTO staff (id, pin_hash, role, display_name) VALUES ('s1', 'x', 'admin', 'Admin')").run();
    db.prepare(`
      INSERT INTO cash_closings (id, closing_date, opened_at, opened_by)
      VALUES ('c1', '2026-08-25', '2026-08-25T12:00:00Z', 's1')
    `).run();
    const row = db.prepare('SELECT * FROM cash_closings WHERE id = ?').get('c1');
    expect(row.opening_cash).toBe(0);
    expect(row.expenses_cash).toBe(0);
    expect(row.expected_qr).toBe(0);
    expect(row.total_general).toBe(0);
    expect(row.transactions).toBe(0);
    db.close();
  });

  it('DB vieja (v12) migra a v13 añadiendo las columnas sin perder datos', () => {
    // Simular una DB v12: crear la tabla SIN columnas v13 + insertar una fila
    const db = new Database(':memory:');
    db.exec(`
      CREATE TABLE staff (id TEXT PRIMARY KEY, pin_hash TEXT, role TEXT CHECK(role IN ('admin','mesero','kds')), display_name TEXT, is_active INTEGER DEFAULT 1, current_shift TEXT, last_login_at TEXT, created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')));
      CREATE TABLE cash_closings (
        id TEXT PRIMARY KEY, closing_date TEXT NOT NULL, opened_at TEXT NOT NULL,
        closed_at TEXT, opened_by TEXT NOT NULL, closed_by TEXT,
        expected_cash INTEGER NOT NULL DEFAULT 0, actual_cash INTEGER NOT NULL DEFAULT 0,
        cash_difference INTEGER NOT NULL DEFAULT 0, is_reconciled INTEGER NOT NULL DEFAULT 0,
        notes TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO cash_closings (id, closing_date, opened_at, opened_by, expected_cash, actual_cash)
      VALUES ('old1', '2026-08-24', '2026-08-24T12:00:00Z', 's1', 5000, 5000);
      CREATE TABLE schema_version (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (datetime('now')));
      INSERT INTO schema_version (version) VALUES (12);
    `);
    // staff para la FK
    db.prepare("INSERT INTO staff (id, pin_hash, role, display_name) VALUES ('s1', 'x', 'admin', 'Admin')").run();
    applySchema(db);
    const row = db.prepare('SELECT * FROM cash_closings WHERE id = ?').get('old1');
    expect(row.expected_cash).toBe(5000); // dato viejo preservado
    expect(row.opening_cash).toBe(0);     // columna nueva con default
    expect(row.transactions).toBe(0);
    expect(db.prepare('SELECT version FROM schema_version ORDER BY version DESC LIMIT 1').get().version).toBe(15);
    db.close();
  });
});