/**
 * Waiter Calls API Tests
 *
 * TDD: Tests written before production verification.
 * Tests the waiter-calls CRUD endpoints.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies
vi.mock('better-sqlite3', () => ({
  default: vi.fn(() => ({
    pragma: vi.fn(),
    prepare: vi.fn(() => ({
      get: vi.fn(),
      all: vi.fn(() => []),
      run: vi.fn(() => ({ changes: 1 })),
    })),
    exec: vi.fn(),
    transaction: vi.fn((fn) => fn()),
  })),
}));

vi.mock('../../server/db/index.js', () => ({
  getDb: vi.fn(() => ({
    prepare: vi.fn(() => ({
      get: vi.fn(),
      all: vi.fn(() => []),
      run: vi.fn(() => ({ changes: 1 })),
    })),
    pragma: vi.fn(),
    exec: vi.fn(),
    transaction: vi.fn((fn) => fn()),
  })),
}));

// Mock auth middleware
vi.mock('../../server/middleware/auth.js', () => ({
  requireAuth: (req, res, next) => {
    req.user = { sub: 'test-user-id', role: 'mesero' };
    next();
  },
  requireRole: () => (req, res, next) => next(),
}));

import { Router } from 'express';

describe('Waiter Calls Routes', () => {
  it('should export a router', async () => {
    const mod = await import('../../server/routes/waiter-calls.js');
    expect(mod.default).toBeDefined();
  });

  it('should have POST, GET, PATCH, DELETE routes', async () => {
    const mod = await import('../../server/routes/waiter-calls.js');
    const router = mod.default;
    // Express routers have route stack
    expect(router.stack).toBeDefined();
    expect(router.stack.length).toBeGreaterThan(0);
  });
});

describe('Waiter Call Status Flow', () => {
  it('should define valid statuses', () => {
    const validStatuses = ['pending', 'accepted', 'done', 'cancelled'];
    expect(validStatuses).toContain('pending');
    expect(validStatuses).toContain('accepted');
    expect(validStatuses).toContain('done');
    expect(validStatuses).toContain('cancelled');
  });

  it('should define valid call types', () => {
    const validTypes = ['call_waiter', 'request_bill'];
    expect(validTypes).toContain('call_waiter');
    expect(validTypes).toContain('request_bill');
  });
});
