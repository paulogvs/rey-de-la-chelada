/**
 * Build multi-PWA — estructura de dist/ (P1-4)
 *
 * Verifica que el build de Vite emite las 6 PWAs con su tríada PWA:
 *   index.html + sw.js + manifest.json (más offline.html + workbox-*.js).
 *
 * Se SKIPEA automáticamente si no hay dist/ (evita build forzado en el
 * npm test normal). Se corre explícitamente con `npm run test:build`.
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(__dirname, '..', 'dist');
const MODULES = ['clientes', 'cocina', 'bar', 'meseros', 'caja', 'admin'];

const run = fs.existsSync(dist);

describe.skipIf(!run)('Build multi-PWA', () => {
  for (const m of MODULES) {
    it(`${m}: index.html + sw.js + manifest.json`, () => {
      expect(fs.existsSync(path.join(dist, m, 'index.html'))).toBe(true);
      expect(fs.existsSync(path.join(dist, m, 'sw.js'))).toBe(true);
      expect(fs.existsSync(path.join(dist, m, 'manifest.json'))).toBe(true);
    });
  }

  it('assets: al menos 1 chunk js', () => {
    const files = fs.readdirSync(path.join(dist, 'assets')).filter(f => f.endsWith('.js'));
    expect(files.length).toBeGreaterThan(0);
  });
});
