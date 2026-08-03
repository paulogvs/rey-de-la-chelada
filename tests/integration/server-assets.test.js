/**
 * ═══════════════════════════════════════════════════════════
 *  server-assets.test.js — Integración: mounts estáticos multi-PWA
 *
 *  Regresión del bug de "pantalla negra":
 *   - El build multi-PWA emite shared chunks a dist/assets/ (raíz)
 *   - El server DEBE montar /assets → dist/assets para que React bootee
 *   - GET / DEBE redirigir (302) a /clientes/ (UX)
 *
 *  Estrategia: import dinámico de server/index.js con PORT=0
 *  (puerto aleatorio — no choca con el server real en 3002),
 *  crea un asset temporal en dist/assets/, y verifica el mount.
 * ═══════════════════════════════════════════════════════════
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST_ASSETS = path.resolve(__dirname, '..', '..', 'dist', 'assets');
const FAKE_ASSET = '__forchi_shared_chunk_test__.js';

describe('Server multi-PWA static mounts (regresión pantalla negra)', () => {
  let mod;
  let server;
  let baseUrl;

  beforeAll(async () => {
    // ── 1. Asset temporal en dist/assets/ (simula shared chunk) ──
    fs.mkdirSync(DIST_ASSETS, { recursive: true });
    fs.writeFileSync(path.join(DIST_ASSETS, FAKE_ASSET), 'export const ok = true;\n', 'utf-8');

    // ── 2. Import del server con puerto aleatorio ───────────────
    process.env.PORT = '0';
    mod = await import('../../server/index.js');
    server = mod.server;

    // Esperar a que el server escuche (listen es async)
    let addr = null;
    for (let i = 0; i < 50 && !addr; i++) {
      addr = server.address();
      if (!addr) await new Promise(r => setTimeout(r, 25));
    }
    if (!addr) throw new Error('El server no escuchó en tiempo razonable');
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  afterAll(async () => {
    // Cleanup: asset temporal + server
    fs.rmSync(path.join(DIST_ASSETS, FAKE_ASSET), { force: true });
    await new Promise(resolve => server.close(resolve));
  });

  it('GET /assets/* sirve shared chunks desde dist/assets (200)', async () => {
    const res = await fetch(`${baseUrl}/assets/${FAKE_ASSET}`);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('ok = true');
  });

  it('GET / redirige 302 a /clientes/', async () => {
    const res = await fetch(`${baseUrl}/`, { redirect: 'manual' });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/clientes/');
  });

  it('GET /api/* NO es interceptado por el redirect raíz (JSON 404 de API)', async () => {
    // Ruta API inexistente → debe responder el 404 handler, NO un redirect
    const res = await fetch(`${baseUrl}/api/ruta-inexistente`, { redirect: 'manual' });
    expect(res.status).toBe(404);
  });

  it('Un asset inexistente en /assets/* responde 404 (no SPA-fallback camuflado)', async () => {
    const res = await fetch(`${baseUrl}/assets/no-existe-este-archivo-xyz.js`);
    expect(res.status).toBe(404);
  });
});
