/**
 * Env Guard Tests (P0-2)
 *
 * assertProdSecret: en producción JWT_SECRET es OBLIGATORIO (fail-loud).
 * En desarrollo la ausencia de secret NO debe romper el arranque (el warn
 * del middleware auth.js sigue cubriendo el aviso).
 */

import { describe, it, expect } from 'vitest';
import { assertProdSecret } from '../../server/config/env-guard.js';

describe('assertProdSecret (env-guard)', () => {
  it('(a) NODE_ENV=production sin JWT_SECRET → throw', () => {
    const env = { NODE_ENV: 'production' };
    expect(() => assertProdSecret(env)).toThrow(/JWT_SECRET/);
  });

  it('(b) production CON secret → ok (no throw)', () => {
    const env = { NODE_ENV: 'production', JWT_SECRET: 'x'.repeat(32) };
    expect(() => assertProdSecret(env)).not.toThrow();
  });

  it('(c) NODE_ENV=development sin secret → ok', () => {
    const env = { NODE_ENV: 'development' };
    expect(() => assertProdSecret(env)).not.toThrow();
  });

  it('secret muy corto en producción → el guard no valida longitud (lo exige la doc) — solo presencia', () => {
    // El guard verifica PRESENCIA; la longitud mínima (32 chars) es un
    // contrato documentado en MANUAL_DE_INSTALACION.md.
    const env = { NODE_ENV: 'production', JWT_SECRET: 'abc' };
    expect(() => assertProdSecret(env)).not.toThrow();
  });
});
