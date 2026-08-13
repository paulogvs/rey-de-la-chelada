/**
 * JWT token helpers for staff sessions (pure, framework-free, testable).
 *
 * jwt-decode decodes the payload WITHOUT verifying the signature or the
 * expiration — that's intentional: the server is the only authority that
 * verifies the signature (JWT_SECRET never reaches the client). The client
 * only needs to know whether a *locally persisted* token is still usable so
 * it doesn't restore a dead token and get stuck in a 401 loop.
 *
 * Payload shape (signed by server/middleware/auth.js `generateToken`):
 *   { sub, username, role, displayName, iat, exp, iss }
 */

import { jwtDecode } from 'jwt-decode';
import type { StaffUser } from '../api/apiFetch';

/** Known staff roles (single source of truth on the client). */
const STAFF_ROLES: StaffUser['role'][] = ['admin', 'mesero', 'kds', 'caja'];

export interface StaffTokenPayload {
  sub?: string;
  username?: string;
  role?: StaffUser['role'];
  displayName?: string;
  iat?: number;
  exp?: number;
  iss?: string;
}

/** Type guard for the `role` field so a malformed token can't inject a bogus role. */
export function isStaffRole(role: unknown): role is StaffUser['role'] {
  return typeof role === 'string' && (STAFF_ROLES as string[]).includes(role);
}

/**
 * Decode a JWT payload. Returns null if the token is malformed (jwt-decode
 * throws InvalidTokenError). Does NOT verify signature (server's job) nor
 * expiration (see isTokenExpired).
 */
export function decodeStaffToken(token: string): StaffTokenPayload | null {
  try {
    return jwtDecode<StaffTokenPayload>(token);
  } catch {
    return null;
  }
}

/**
 * True if the token has no `exp`, can't be decoded, or is already expired.
 * `exp` is seconds since the Unix epoch; `now` is in milliseconds.
 * Comparison is `<=` so a token whose exp equals "now" is treated as expired.
 */
export function isTokenExpired(token: string, now: number = Date.now()): boolean {
  const payload = decodeStaffToken(token);
  if (!payload || typeof payload.exp !== 'number') return true;
  return payload.exp * 1000 <= now;
}

/**
 * Rebuild a StaffUser from a decoded token (sub → id, role → role,
 * displayName → displayName). Returns null if the payload is incomplete or
 * carries an unknown role. Used to restore the header name after a reload.
 */
export function tokenToStaffUser(token: string): StaffUser | null {
  const payload = decodeStaffToken(token);
  if (!payload) return null;
  if (
    typeof payload.sub !== 'string' ||
    typeof payload.displayName !== 'string' ||
    !isStaffRole(payload.role)
  ) {
    return null;
  }
  return {
    id: payload.sub,
    role: payload.role,
    displayName: payload.displayName,
  };
}
