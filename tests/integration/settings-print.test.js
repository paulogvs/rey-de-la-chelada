/**
 * Integración — Settings (NIT/impresora) + rutas Print (v14 2026-08-28).
 *
 * Server real + DB_PATH temp (patrón caja-role.test.js):
 *  - GET /api/settings requiere admin (403 para caja)
 *  - PUT /api/settings guarda NIT/paper_width y los relee
 *  - effective refleja settings (NIT configurado)
 *  - POST /api/print/ticket valida orderId (400) y pedido inexistente (404)
 *    (no dispara impresora real en tests)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_DB = 'data/test-settings-print.db';

process.env.PORT = '0';
process.env.DB_PATH = TEST_DB;

let server;
let base;
let cajaToken;
let adminToken;

beforeAll(async () => {
  const mod = await import('../../server/index.js');
  server = mod.server;
  let addr = null;
  for (let i = 0; i < 50 && !addr; i++) {
    addr = server.address();
    if (!addr) await new Promise(r => setTimeout(r, 25));
  }
  if (!addr) throw new Error('El server no escuchó en tiempo razonable');
  base = `http://127.0.0.1:${addr.port}`;

  cajaToken = await login('3333');
  adminToken = await login('0000');
});

afterAll(async () => {
  await new Promise(resolve => server.close(resolve));
  const { closeDb } = await import('../../server/db/index.js');
  closeDb();
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(path.resolve(__dirname, '..', '..', TEST_DB + suffix)); } catch { /* noop */ }
  }
});

async function api(p, { method = 'GET', body, token } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${base}${p}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch { /* noop */ }
  return { status: res.status, json };
}

async function login(pin) {
  const r = await api('/api/auth/login', { method: 'POST', body: { pin } });
  return r.json?.token;
}

describe('Settings API', () => {
  it('GET /api/settings requiere admin (caja → 403)', async () => {
    const r = await api('/api/settings', { token: cajaToken });
    expect(r.status).toBe(403);
  });

  it('PUT guarda NIT/paper_width y GET los relee con effective', async () => {
    const put = await api('/api/settings', {
      method: 'PUT',
      token: adminToken,
      body: { nit: '1029394029', business_name: 'Rey de la Chelada SRL', paper_width: '80mm' },
    });
    expect(put.status).toBe(200);
    expect(put.json.success).toBe(true);
    expect(put.json.settings.nit).toBe('1029394029');
    expect(put.json.effective.business.nit).toBe('1029394029');
    expect(put.json.effective.paperSize).toBe('80mm');

    const get = await api('/api/settings', { token: adminToken });
    expect(get.json.settings.nit).toBe('1029394029');
  });
});

describe('Print API (validaciones, sin impresora real)', () => {
  it('POST /api/print/ticket sin orderId → 400', async () => {
    const r = await api('/api/print/ticket', { method: 'POST', token: cajaToken, body: {} });
    expect(r.status).toBe(400);
    expect(r.json.code).toBe('ORDER_ID_REQUIRED');
  });

  it('POST /api/print/ticket con orderId inexistente → 404', async () => {
    const r = await api('/api/print/ticket', {
      method: 'POST',
      token: cajaToken,
      body: { orderId: 'no-existe' },
    });
    expect(r.status).toBe(404);
    expect(r.json.code).toBe('ORDER_NOT_FOUND');
  });

  it('POST /api/print/test requiere admin (caja → 403)', async () => {
    const r = await api('/api/print/test', { method: 'POST', token: cajaToken });
    expect(r.status).toBe(403);
  });
});