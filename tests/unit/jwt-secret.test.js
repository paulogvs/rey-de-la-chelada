/**
 * T5 — JWT_SECRET: fail loud sin secret (fallback fail-closed)
 *
 * Sin JWT_SECRET en env:
 *  - Se usa un UUID aleatorio (no funcional): los tokens NO son válidos
 *    entre reinicios del server (fail-closed, no secret predecible).
 *  - Emite un warning (fail loud, never silent) al importar.
 *  - Con JWT_SECRET real en env: el login funciona normal.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';

describe('JWT_SECRET — fallback sin env', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    delete process.env.JWT_SECRET;
  });

  it('sin JWT_SECRET: emite warning y usa un fallback aleatorio (fail-closed)', async () => {
    delete process.env.JWT_SECRET;
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // Import dinámico con cache limpia (módulo sin estado previo en este worker)
    const mod = await import('../../server/middleware/auth.js');
    const { generateToken, verifyToken, JWT_SECRET } = mod;

    // El fallback NO es un valor fijo/predescible — es un UUID aleatorio
    // (fail-closed): ningún secret estático en producción.
    expect(JWT_SECRET).not.toBe('dev-secret-do-not-use-in-production');
    expect(typeof JWT_SECRET).toBe('string');
    expect(JWT_SECRET.length).toBeGreaterThanOrEqual(20);
    // Fail loud: debe haber avisado del secreto por defecto
    expect(warnSpy).toHaveBeenCalled();

    // Un token firmado con el fallback aleatorio se verifica con el MISMO
    // proceso (mismo valor en memoria) — el flujo interno sigue íntegro.
    const token = generateToken({ id: 'x', role: 'admin', displayName: 'A' });
    const decoded = verifyToken(token);
    expect(decoded).not.toBeNull();
    expect(decoded.role).toBe('admin');
  });

  it('con JWT_SECRET en env: no emite warning y los tokens funcionan', async () => {
    process.env.JWT_SECRET = 'test-real-secret-12345';
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const mod = await import('../../server/middleware/auth.js');
    const { generateToken, verifyToken, JWT_SECRET } = mod;

    expect(JWT_SECRET).toBe('test-real-secret-12345');
    expect(warnSpy).not.toHaveBeenCalled();

    const token = generateToken({ id: 'x', role: 'caja', displayName: 'Cajero' });
    const decoded = verifyToken(token);
    expect(decoded).not.toBeNull();
    expect(decoded.role).toBe('caja');
  });
});
