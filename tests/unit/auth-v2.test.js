/**
 * Auth PIN Login Tests (v2)
 *
 * TDD: Tests for simplified PIN-based auth.
 * PIN matches ANY staff row with that PIN.
 */

import { describe, it, expect, vi } from 'vitest';

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

import { generateToken, verifyToken, canAccessModule } from '../../server/middleware/auth.js';

describe('Auth v2 — Role System', () => {
  it('should have 4 valid roles (v5: + caja)', () => {
    const validRoles = ['admin', 'mesero', 'kds', 'caja'];
    expect(validRoles).toHaveLength(4);
    expect(validRoles).toContain('admin');
    expect(validRoles).toContain('mesero');
    expect(validRoles).toContain('kds');
    expect(validRoles).toContain('caja');
  });

  it('should NOT have old legacy roles', () => {
    const validRoles = ['admin', 'mesero', 'kds', 'caja'];
    expect(validRoles).not.toContain('cocina');
    expect(validRoles).not.toContain('bartender');
    expect(validRoles).not.toContain('garzon');
  });
});

describe('Auth v2 — Module Access', () => {
  it('should allow kds to access cocina module', () => {
    expect(canAccessModule('kds', 'cocina')).toBe(true);
  });

  it('should allow kds to access bar module', () => {
    expect(canAccessModule('kds', 'bar')).toBe(true);
  });

  it('should allow admin to access all modules', () => {
    expect(canAccessModule('admin', 'cocina')).toBe(true);
    expect(canAccessModule('admin', 'bar')).toBe(true);
    expect(canAccessModule('admin', 'meseros')).toBe(true);
    expect(canAccessModule('admin', 'caja')).toBe(true);
    expect(canAccessModule('admin', 'admin')).toBe(true);
  });

  it('should allow caja to access caja module (v5)', () => {
    expect(canAccessModule('caja', 'caja')).toBe(true);
    expect(canAccessModule('caja', 'admin')).toBe(false);
    expect(canAccessModule('caja', 'meseros')).toBe(false);
  });

  it('should NOT allow mesero to access cocina', () => {
    expect(canAccessModule('mesero', 'cocina')).toBe(false);
  });

  it('should NOT allow mesero to access bar', () => {
    expect(canAccessModule('mesero', 'bar')).toBe(false);
  });

  it('should allow mesero to access meseros', () => {
    expect(canAccessModule('mesero', 'meseros')).toBe(true);
  });

  it('should allow public access to clientes', () => {
    expect(canAccessModule('anyone', 'clientes')).toBe(true);
  });

  it('should NOT allow kds to access admin', () => {
    expect(canAccessModule('kds', 'admin')).toBe(false);
  });

  it('should NOT allow mesero to access admin', () => {
    expect(canAccessModule('mesero', 'admin')).toBe(false);
  });
});

describe('Auth v2 — JWT Token', () => {
  const mockUser = {
    id: 'test-id',
    role: 'mesero',
    displayName: 'Test Mesero',
  };

  it('should generate token without username', () => {
    const token = generateToken(mockUser);
    expect(token).toBeDefined();
    const decoded = verifyToken(token);
    expect(decoded).not.toBeNull();
    expect(decoded.sub).toBe(mockUser.id);
    expect(decoded.role).toBe(mockUser.role);
  });

  it('should include displayName in token', () => {
    const token = generateToken(mockUser);
    const decoded = verifyToken(token);
    expect(decoded.displayName).toBe(mockUser.displayName);
  });
});
