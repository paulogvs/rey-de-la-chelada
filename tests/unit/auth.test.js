/**
 * Auth Middleware Tests
 *
 * Artículo III: TDD — Pruebas antes de producción.
 * Artículo VI: Observabilidad — Fail loud.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock JWT_SECRET before importing
process.env.JWT_SECRET = 'test-secret-key';

// Mock bcryptjs
vi.mock('bcryptjs', () => ({
  default: {
    hash: vi.fn(() => Promise.resolve('$2a$10$hashed_password')),
    compare: vi.fn((plain, hash) => Promise.resolve(plain === 'correct_password')),
    compareSync: vi.fn((plain, hash) => plain === '1234'),
  },
  hash: vi.fn(() => Promise.resolve('$2a$10$hashed_password')),
  compare: vi.fn((plain, hash) => Promise.resolve(plain === 'correct_password')),
  compareSync: vi.fn((plain, hash) => plain === '1234'),
}));

import { generateToken, verifyToken, requireAuth, requireRole, optionalAuth, canAccessModule, JWT_SECRET } from '../../server/middleware/auth.js';

describe('Auth Middleware', () => {
  const mockUser = {
    id: 1,
    username: 'testuser',
    role: 'admin',
    displayName: 'Test User',
  };

  describe('generateToken', () => {
    it('should generate a valid JWT', () => {
      const token = generateToken(mockUser);
      expect(token).toBeDefined();
      expect(typeof token).toBe('string');
      expect(token.split('.')).toHaveLength(3); // header.payload.signature
    });

    it('should encode user data in the token', () => {
      const token = generateToken(mockUser);
      const decoded = verifyToken(token);
      expect(decoded).not.toBeNull();
      expect(decoded.sub).toBe(mockUser.id);
      expect(decoded.role).toBe(mockUser.role);
      expect(decoded.username).toBe(mockUser.username);
    });
  });

  describe('verifyToken', () => {
    it('should return null for expired tokens', () => {
      const result = verifyToken('expired.token.here');
      expect(result).toBeNull();
    });

    it('should return null for malformed tokens', () => {
      const result = verifyToken('not-a-token');
      expect(result).toBeNull();
    });

    it('should return null for invalid tokens', () => {
      const result = verifyToken('eyJhbGciOiJIUzI1NiJ9.dGVzdA.invalidsignature');
      expect(result).toBeNull();
    });
  });

  describe('requireAuth middleware', () => {
    it('should return 401 if no authorization header', () => {
      const req = { headers: {} };
      const res = { status: vi.fn(() => res), json: vi.fn() };
      const next = vi.fn();

      requireAuth(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        success: false,
        code: 'AUTH_REQUIRED',
      }));
      expect(next).not.toHaveBeenCalled();
    });

    it('should return 401 if token format is invalid', () => {
      const req = { headers: { authorization: 'InvalidFormat token' } };
      const res = { status: vi.fn(() => res), json: vi.fn() };
      const next = vi.fn();

      requireAuth(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        code: 'INVALID_TOKEN_FORMAT',
      }));
    });

    it('should return 401 if token is invalid', () => {
      const req = { headers: { authorization: 'Bearer invalid.jwt.token' } };
      const res = { status: vi.fn(() => res), json: vi.fn() };
      const next = vi.fn();

      requireAuth(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
    });

    it('should call next if token is valid', () => {
      const token = generateToken(mockUser);
      const req = { headers: { authorization: `Bearer ${token}` } };
      const res = { status: vi.fn(() => res), json: vi.fn() };
      const next = vi.fn();

      requireAuth(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(req.user).toBeDefined();
      expect(req.user.sub).toBe(mockUser.id);
    });
  });

  describe('requireRole middleware', () => {
    it('should return 401 if no user', () => {
      const req = {};
      const res = { status: vi.fn(() => res), json: vi.fn() };
      const next = vi.fn();

      requireRole('admin')(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
    });

    it('should return 403 if role not allowed', () => {
      const req = { user: { role: 'mesero' } };
      const res = { status: vi.fn(() => res), json: vi.fn() };
      const next = vi.fn();

      requireRole('admin')(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        code: 'FORBIDDEN_ROLE',
      }));
    });

    it('should call next if role matches', () => {
      const req = { user: { role: 'admin' } };
      const res = {};
      const next = vi.fn();

      requireRole('admin')(req, res, next);

      expect(next).toHaveBeenCalled();
    });

    it('should allow multiple roles', () => {
      const req = { user: { role: 'cocina' } };
      const res = {};
      const next = vi.fn();

      requireRole('admin', 'cocina')(req, res, next);

      expect(next).toHaveBeenCalled();
    });
  });

  describe('canAccessModule', () => {
    it('should allow public modules', () => {
      expect(canAccessModule('anyone', 'clientes')).toBe(true);
    });

    it('should allow only cocina and admin to cocina module', () => {
      expect(canAccessModule('cocina', 'cocina')).toBe(true);
      expect(canAccessModule('admin', 'cocina')).toBe(true);
      expect(canAccessModule('mesero', 'cocina')).toBe(false);
      expect(canAccessModule('bartender', 'cocina')).toBe(false);
    });

    it('should allow only admin to admin module', () => {
      expect(canAccessModule('admin', 'admin')).toBe(true);
      expect(canAccessModule('mesero', 'admin')).toBe(false);
    });

    it('should return false for unknown modules', () => {
      expect(canAccessModule('admin', 'unknown')).toBe(false);
    });
  });
});
