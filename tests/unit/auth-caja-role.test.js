/**
 * Auth — rol 'caja' real (S1/T1 + T5)
 *
 * 1. MODULE_ROLES.caja = ['caja', 'admin'] → el rol caja entra a la PWA caja.
 * 2. requireRole('admin') sigue EXCLUYENDO al rol caja (rutas admin-only).
 * 3. T5: sin JWT_SECRET el fallback de desarrollo sigue funcionando (fail loud).
 */

import { describe, it, expect, vi, beforeAll } from 'vitest';

// ⚠️ ESM hoisting: los imports estáticos corren ANTES del cuerpo del módulo,
// así que el env debe setearse ANTES del import dinámico (y con módulos limpios).
process.env.JWT_SECRET = 'test-secret-key';
vi.resetModules();
const mod = await import('../../server/middleware/auth.js');
const { canAccessModule, MODULE_ROLES, requireRole, JWT_SECRET } = mod;

describe('Auth — rol caja en MODULE_ROLES', () => {
  it('caja puede acceder al módulo caja', () => {
    expect(canAccessModule('caja', 'caja')).toBe(true);
  });

  it('admin también puede acceder al módulo caja (backward compat)', () => {
    expect(canAccessModule('admin', 'caja')).toBe(true);
  });

  it('MODULE_ROLES.caja contiene exactamente caja y admin', () => {
    expect(MODULE_ROLES.caja).toEqual(['caja', 'admin']);
  });

  it('caja NO puede acceder a admin/meseros/cocina/bar', () => {
    expect(canAccessModule('caja', 'admin')).toBe(false);
    expect(canAccessModule('caja', 'meseros')).toBe(false);
    expect(canAccessModule('caja', 'cocina')).toBe(false);
    expect(canAccessModule('caja', 'bar')).toBe(false);
  });

  it('mesero sigue sin poder acceder a caja', () => {
    expect(canAccessModule('mesero', 'caja')).toBe(false);
  });

  it('kds sigue sin poder acceder a caja', () => {
    expect(canAccessModule('kds', 'caja')).toBe(false);
  });
});

describe('Auth — requireRole excluye caja de rutas admin-only', () => {
  it('requireRole("admin") rechaza al rol caja con 403', () => {
    const req = { user: { role: 'caja' } };
    const res = { status: vi.fn(() => res), json: vi.fn() };
    const next = vi.fn();

    requireRole('admin')(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'FORBIDDEN_ROLE' }));
  });

  it('requireRole("admin", "caja") acepta al rol caja', () => {
    const req = { user: { role: 'caja' } };
    const res = {};
    const next = vi.fn();

    requireRole('admin', 'caja')(req, res, next);

    expect(next).toHaveBeenCalled();
  });
});

describe('T5 — JWT_SECRET', () => {
  it('con JWT_SECRET configurado, auth usa el secreto de env', () => {
    expect(JWT_SECRET).toBe('test-secret-key');
  });
});
