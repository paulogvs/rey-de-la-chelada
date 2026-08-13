/**
 * Unit tests — jwtToken helpers (staff session expiry, Capa 1).
 *
 * Verifica que:
 *   1. decodeStaffToken decodifica un JWT válido y devuelve null si es malo.
 *   2. isTokenExpired detecta expirados / sin exp / malformados.
 *   3. tokenToStaffUser reconstruye el usuario desde el token.
 *
 * Los tokens se fabrican a mano (header.payload.sig) porque jwt-decode NO
 * verifica la firma — solo decodifica el payload (la firma es del server).
 */

import { describe, it, expect } from 'vitest';
import {
  decodeStaffToken,
  isTokenExpired,
  isStaffRole,
  tokenToStaffUser,
} from '../../src/pwa/_shared/utils/jwtToken';

function makeJwt(payload: Record<string, unknown>): string {
  const enc = (obj: unknown) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  return `${enc({ alg: 'HS256', typ: 'JWT' })}.${enc(payload)}.signature`;
}

describe('decodeStaffToken', () => {
  it('decodes a valid token payload', () => {
    const payload = decodeStaffToken(makeJwt({ sub: 'u1', role: 'mesero', displayName: 'Mesero' }));
    expect(payload).toMatchObject({ sub: 'u1', role: 'mesero', displayName: 'Mesero' });
  });

  it('returns null for a malformed token', () => {
    expect(decodeStaffToken('abc')).toBeNull();
    expect(decodeStaffToken('')).toBeNull();
    expect(decodeStaffToken('a.b')).toBeNull(); // parte 2 no es JSON
  });
});

describe('isTokenExpired', () => {
  it('returns false for a token expiring in the future', () => {
    const token = makeJwt({ exp: Math.floor(Date.now() / 1000) + 3600 });
    expect(isTokenExpired(token)).toBe(false);
  });

  it('returns true for a token already expired', () => {
    const token = makeJwt({ exp: Math.floor(Date.now() / 1000) - 10 });
    expect(isTokenExpired(token)).toBe(true);
  });

  it('returns true for a token without exp', () => {
    expect(isTokenExpired(makeJwt({ sub: 'u1' }))).toBe(true);
  });

  it('returns true for a malformed token', () => {
    expect(isTokenExpired('abc')).toBe(true);
  });

  it('treats exp === now as expired (boundary)', () => {
    const now = 1_000_000_000_000;
    const token = makeJwt({ exp: now / 1000 });
    expect(isTokenExpired(token, now)).toBe(true);
  });

  it('accepts an explicit now for deterministic testing', () => {
    const now = 1_000_000_000_000;
    const token = makeJwt({ exp: now / 1000 + 5 });
    expect(isTokenExpired(token, now)).toBe(false);
  });
});

describe('isStaffRole', () => {
  it('accepts known roles', () => {
    expect(isStaffRole('admin')).toBe(true);
    expect(isStaffRole('mesero')).toBe(true);
    expect(isStaffRole('kds')).toBe(true);
    expect(isStaffRole('caja')).toBe(true);
  });

  it('rejects unknown roles and non-strings', () => {
    expect(isStaffRole('superadmin')).toBe(false);
    expect(isStaffRole(42)).toBe(false);
    expect(isStaffRole(null)).toBe(false);
  });
});

describe('tokenToStaffUser', () => {
  it('rebuilds a StaffUser from a valid token', () => {
    const token = makeJwt({ sub: 'u1', role: 'mesero', displayName: 'Mesero Uno' });
    expect(tokenToStaffUser(token)).toEqual({ id: 'u1', role: 'mesero', displayName: 'Mesero Uno' });
  });

  it('returns null when fields are missing', () => {
    expect(tokenToStaffUser(makeJwt({ sub: 'u1' }))).toBeNull();
    expect(tokenToStaffUser(makeJwt({}))).toBeNull();
    expect(tokenToStaffUser(makeJwt({ sub: 'u1', role: 'mesero' }))).toBeNull();
  });

  it('returns null for an unknown role', () => {
    expect(tokenToStaffUser(makeJwt({ sub: 'u1', role: 'hacker', displayName: 'X' }))).toBeNull();
  });

  it('returns null for a malformed token', () => {
    expect(tokenToStaffUser('abc')).toBeNull();
  });
});
