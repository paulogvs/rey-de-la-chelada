/**
 * settings-service.js — upsert + efectivos con fallback al SSOT.
 *
 * v14 (2026-08-28): onboarding NIT/impresora. Valores DB ganan sobre
 * app.config; keys desconocidas se ignoran (fail-loud en consola).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';

// Mock de getDb (la DB real se crea por test)
const { dbRef } = vi.hoisted(() => ({ dbRef: { db: null } }));
vi.mock('../../server/db/index.js', () => ({ getDb: () => dbRef.db }));

const { updateSettings, getAllSettings, getEffectiveBusiness, getEffectiveTaxConfig, getEffectivePaperSize } =
  await import('../../server/services/settings.js');

const tmpDirs = [];

function makeDb() {
  const dir = mkdtempSync(join(tmpdir(), 'rdc-settings-test-'));
  tmpDirs.push(dir);
  const db = new Database(join(dir, 's.db'));
  db.exec(`CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY, value TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  return db;
}

beforeEach(() => {
  dbRef.db = makeDb();
});

afterEach(() => {
  if (dbRef.db) dbRef.db.close();
  for (const d of tmpDirs.splice(0)) {
    try { rmSync(d, { recursive: true, force: true }); } catch { /* noop */ }
  }
});

describe('settings service', () => {
  it('upsert: guarda y relee valores', () => {
    const all = updateSettings({ nit: '123456789', business_name: 'Rey de la Chelada' });
    expect(all.nit).toBe('123456789');
    expect(all.business_name).toBe('Rey de la Chelada');

    updateSettings({ nit: '987654321' }); // actualiza existente
    expect(getAllSettings().nit).toBe('987654321');
  });

  it('ignora keys desconocidas (fail-loud, no rompe)', () => {
    const all = updateSettings({ nit: '1', hack_key: 'x' });
    expect(all.hack_key).toBeUndefined();
    expect(all.nit).toBe('1');
  });

  it('efectivos con fallback: sin DB usa defaults; con DB usa settings', () => {
    expect(getEffectiveBusiness().name).toBe('Rey de la Chelada');
    expect(getEffectiveBusiness().nit).toBe('');
    expect(getEffectiveTaxConfig().iva.percentage).toBe(13);
    expect(getEffectivePaperSize()).toBe('80mm');

    updateSettings({ nit: '999', business_name: 'Mi Chela', iva_rate: '15', paper_width: '58mm' });
    const b = getEffectiveBusiness();
    expect(b.nit).toBe('999');
    expect(b.name).toBe('Mi Chela');
    expect(getEffectiveTaxConfig().iva.percentage).toBe(15);
    expect(getEffectivePaperSize()).toBe('58mm');
  });

  it('iva_rate inválido → fallback 13; paper_width inválido → 80mm', () => {
    updateSettings({ iva_rate: 'abc', paper_width: '100mm' });
    expect(getEffectiveTaxConfig().iva.percentage).toBe(13);
    expect(getEffectivePaperSize()).toBe('80mm');
  });
});