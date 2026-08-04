/**
 * DB_PATH env var — entornos de prueba aislados.
 *
 * FASE 2 (batería de pruebas): permite levantar un servidor de DEV con
 * DB propia (PORT=3003 DB_PATH=data/test-e2e.db node server/index.js)
 * sin tocar la DB de DEV ni la de PROD.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';

async function importDbModule() {
  // Import dinámico con cache limpio (ESM)
  vi.resetModules();
  return await import('../../server/db/index.js');
}

describe('DB path resolution', () => {
  const originalEnv = process.env.DB_PATH;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.DB_PATH;
    } else {
      process.env.DB_PATH = originalEnv;
    }
    vi.resetModules();
  });

  it('usa data/rey-de-la-chelada.db por defecto (sin DB_PATH)', async () => {
    delete process.env.DB_PATH;
    const mod = await importDbModule();
    const p = mod.getDbPath();
    expect(p).toContain('rey-de-la-chelada.db');
  });

  it('respeta DB_PATH cuando está definido (env de prueba)', async () => {
    process.env.DB_PATH = 'data/test-e2e.db';
    const mod = await importDbModule();
    const p = mod.getDbPath();
    expect(p).toContain('test-e2e.db');
  });
});
