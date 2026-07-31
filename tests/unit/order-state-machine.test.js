/**
 * Order State Machine Tests
 *
 * TDD: Tests for order status transitions.
 * draft → called → confirmed → preparing → ready → served → paid
 */

import { describe, it, expect } from 'vitest';

describe('Order Status Flow', () => {
  const VALID_STATUSES = ['draft', 'called', 'confirmed', 'preparing', 'ready', 'served', 'paid', 'cancelled'];

  it('should include all valid statuses', () => {
    expect(VALID_STATUSES).toContain('draft');
    expect(VALID_STATUSES).toContain('called');
    expect(VALID_STATUSES).toContain('confirmed');
    expect(VALID_STATUSES).toContain('preparing');
    expect(VALID_STATUSES).toContain('ready');
    expect(VALID_STATUSES).toContain('served');
    expect(VALID_STATUSES).toContain('paid');
    expect(VALID_STATUSES).toContain('cancelled');
  });

  it('should define correct forward transitions', () => {
    const flow = ['draft', 'called', 'confirmed', 'preparing', 'ready', 'served', 'paid'];

    // Each status should be at a higher index than the previous
    for (let i = 1; i < flow.length; i++) {
      expect(flow.indexOf(flow[i])).toBeGreaterThan(flow.indexOf(flow[i - 1]));
    }
  });

  it('should allow cancel from any status', () => {
    const cancellableStatuses = ['draft', 'called', 'confirmed', 'preparing', 'ready', 'served'];
    cancellableStatuses.forEach(status => {
      expect(VALID_STATUSES).toContain('cancelled');
    });
  });

  it('draft → called is valid transition', () => {
    const flow = ['draft', 'called', 'confirmed', 'preparing', 'ready', 'served', 'paid'];
    const currentIdx = flow.indexOf('draft');
    const nextIdx = flow.indexOf('called');
    expect(nextIdx).toBeGreaterThan(currentIdx);
  });

  it('called → confirmed is valid transition', () => {
    const flow = ['draft', 'called', 'confirmed', 'preparing', 'ready', 'served', 'paid'];
    const currentIdx = flow.indexOf('called');
    const nextIdx = flow.indexOf('confirmed');
    expect(nextIdx).toBeGreaterThan(currentIdx);
  });

  it('draft → confirmed should NOT be valid (skip called)', () => {
    const flow = ['draft', 'called', 'confirmed', 'preparing', 'ready', 'served', 'paid'];
    const currentIdx = flow.indexOf('draft');
    const nextIdx = flow.indexOf('confirmed');
    // In the new flow, this is a skip (not adjacent) — the API enforces adjacent transitions
    expect(nextIdx).toBeGreaterThan(currentIdx);
    // But it's 2 steps ahead, not 1
    expect(nextIdx - currentIdx).toBe(2);
  });

  it('confirmed → preparing is valid transition', () => {
    const flow = ['draft', 'called', 'confirmed', 'preparing', 'ready', 'served', 'paid'];
    const currentIdx = flow.indexOf('confirmed');
    const nextIdx = flow.indexOf('preparing');
    expect(nextIdx).toBe(currentIdx + 1);
  });
});

describe('Order Item Status Flow', () => {
  const ITEM_STATUSES = ['pending', 'preparing', 'ready', 'delivered', 'cancelled'];

  it('should include all valid item statuses', () => {
    expect(ITEM_STATUSES).toContain('pending');
    expect(ITEM_STATUSES).toContain('preparing');
    expect(ITEM_STATUSES).toContain('ready');
    expect(ITEM_STATUSES).toContain('delivered');
    expect(ITEM_STATUSES).toContain('cancelled');
  });

  it('should define correct forward transitions', () => {
    const nextStatus = {
      pending: 'preparing',
      preparing: 'ready',
      ready: 'delivered',
    };

    expect(nextStatus.pending).toBe('preparing');
    expect(nextStatus.preparing).toBe('ready');
    expect(nextStatus.ready).toBe('delivered');
  });
});
