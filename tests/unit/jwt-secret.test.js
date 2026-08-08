/**
 * T5 — JWT_SECRET: fail loud sin secret (fallback de desarrollo funcional)
 *
 * Sin JWT_SECRET en env:
 *  - El fallback 'dev-secret-do-not-use-in-production' sigue funcionando
 *    (login en DEV no se rompe).
 *  - Emite un warning (fail loud, never silent) al importar.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';

describe('JWT_SECRET — fallback sin env', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.JWT_SECRET;
  });

  it('sin JWT_SECRET: emite warning y el fallback genera/verifica tokens', async () => {
    delete process.env.JWT_SECRET;
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // Import dinámico con cache limpia (módulo sin estado previo en este worker)
    const mod = await import('../../server/middleware/auth.js');
    const { generateToken, verifyToken, JWT_SECRET } = mod;

    expect(JWT_SECRET).toBe('dev-secret-do-not-use-in-production');
    // Fail loud: debe haber avisado del secreto por defecto
    expect(warnSpy).toHaveBeenCalled();

    // Y el login sigue funcionando con el fallback
    const token = generateToken({ id: 'x', role: 'admin', displayName: 'A' });
    const decoded = verifyToken(token);
    expect(decoded).not.toBeNull();
    expect(decoded.role).toBe('admin');
  });
});
