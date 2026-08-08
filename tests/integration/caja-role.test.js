/**
 * Integración — Rol 'caja' real (S1/T1)
 *
 * Server real con DB_PATH temp (patrón de payments-cash-close.test.js):
 *  - login con PIN 3333 → token con role 'caja'
 *  - caja puede usar rutas de pagos/corte (requireRole admin,caja)
 *  - caja NO puede usar rutas admin-only (staff, menu bulk)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_DB = 'data/test-caja-role.db';

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

describe('Rol caja — login y permisos', () => {
  it('el PIN 3333 inicia sesión con role caja', async () => {
    const r = await api('/api/auth/login', { method: 'POST', body: { pin: '3333' } });
    expect(r.status).toBe(200);
    expect(r.json.user.role).toBe('caja');
    expect(r.json.user.displayName).toBe('Cajero');
  });

  it('caja puede consultar el corte de caja actual', async () => {
    const r = await api('/api/payments/closing/current', { token: cajaToken });
    expect(r.status).toBe(200);
    expect(r.json.success).toBe(true);
  });

  it('caja puede abrir un corte de caja', async () => {
    const r = await api('/api/payments/closing', { method: 'POST', token: cajaToken, body: {} });
    // 201 (abrió) o 409 (ya había uno abierto de otro test) — ambos significan "autorizado"
    expect([201, 409]).toContain(r.status);
    if (r.status === 409) expect(r.json.code).toBe('CLOSING_ALREADY_OPEN');
  });

  it('caja NO puede listar staff (admin-only)', async () => {
    const r = await api('/api/staff', { token: cajaToken });
    expect(r.status).toBe(403);
    expect(r.json.code).toBe('FORBIDDEN_ROLE');
  });

  it('caja NO puede actualizar precios bulk de menú (admin-only)', async () => {
    const r = await api('/api/menu/items/bulk-prices', {
      method: 'POST', token: cajaToken, body: { updates: [] },
    });
    expect(r.status).toBe(403);
    expect(r.json.code).toBe('FORBIDDEN_ROLE');
  });

  it('caja NO puede acceder al módulo admin', async () => {
    const r = await api('/api/tables', { method: 'POST', token: cajaToken, body: {} });
    // tables POST es admin-only → 403 (aunque no auth también podría ser 401; con token válido → 403)
    expect([403]).toContain(r.status);
  });

  it('admin SÍ puede listar staff (control)', async () => {
    const r = await api('/api/staff', { token: adminToken });
    expect(r.status).toBe(200);
    const roles = r.json.staff.map(s => s.role);
    expect(roles).toContain('caja');
    expect(roles).toContain('admin');
  });

  it('/health responde 200 con DB conectada', async () => {
    const r = await api('/health');
    expect(r.status).toBe(200);
    expect(r.json.status).toBe('ok');
    expect(r.json.database).toBe('connected');
  });
});
