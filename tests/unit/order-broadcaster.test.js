/**
 * Order Broadcaster Tests
 *
 * TDD: Tests for the order-specific broadcast helpers.
 * Verifies that the right event type is emitted to the right
 * module group for each order lifecycle transition.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock the underlying broadcaster so we can capture calls
const broadcastKDSMock = vi.fn();
const broadcastMeserosMock = vi.fn();
const broadcastToModulesMock = vi.fn();

vi.mock('../../server/services/websocket-broadcaster.js', () => ({
  broadcaster: {
    broadcastKDS: (...args) => broadcastKDSMock(...args),
    broadcastMeseros: (...args) => broadcastMeserosMock(...args),
    broadcastToModules: (...args) => broadcastToModulesMock(...args),
  },
  buildKDSEvent: (type, fields) => ({ type, timestamp: '2026-08-01T00:00:00.000Z', ...fields }),
  KDSEventType: { NEW_ORDER: 'new_order', STATUS_CHANGE: 'status_change', ITEM_READY: 'item_ready', ORDER_COMPLETE: 'order_complete' },
}));

describe('Order Broadcaster — broadcastOrderConfirmed', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('emits new_order event to KDS when an order is confirmed', async () => {
    const { broadcastOrderConfirmed } = await import('../../server/services/order-broadcaster.js');
    const order = {
      id: 'ord-1',
      table_number: 5,
      items: [{ id: 'i1', status: 'pending' }],
      status: 'confirmed',
    };
    broadcastOrderConfirmed(order);
    expect(broadcastKDSMock).toHaveBeenCalledTimes(1);
    const [event] = broadcastKDSMock.mock.calls[0];
    expect(event.type).toBe('new_order');
    expect(event.orderId).toBe('ord-1');
    expect(event.tableNumber).toBe(5);
  });

  it('does not notify meseros on confirmation', async () => {
    const { broadcastOrderConfirmed } = await import('../../server/services/order-broadcaster.js');
    broadcastOrderConfirmed({ id: 'ord-1', table_number: 1, items: [] });
    expect(broadcastMeserosMock).not.toHaveBeenCalled();
  });

  it('is a no-op when order is null/undefined', async () => {
    const { broadcastOrderConfirmed } = await import('../../server/services/order-broadcaster.js');
    expect(() => broadcastOrderConfirmed(null)).not.toThrow();
    expect(broadcastKDSMock).not.toHaveBeenCalled();
  });
});

describe('Order Broadcaster — broadcastOrderStatusChange', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('emits status_change to KDS for any status transition', async () => {
    const { broadcastOrderStatusChange } = await import('../../server/services/order-broadcaster.js');
    const order = {
      id: 'ord-1',
      table_number: 5,
      status: 'preparing',
      items: [{ id: 'i1', status: 'preparing' }],
    };
    broadcastOrderStatusChange(order, 'confirmed');
    expect(broadcastKDSMock).toHaveBeenCalledTimes(1);
    const [event] = broadcastKDSMock.mock.calls[0];
    expect(event.type).toBe('status_change');
    expect(event.status).toBe('preparing');
    expect(event.previousStatus).toBe('confirmed');
  });

  it('emits order_complete to meseros when status → ready and all items ready', async () => {
    const { broadcastOrderStatusChange } = await import('../../server/services/order-broadcaster.js');
    const order = {
      id: 'ord-2',
      table_number: 7,
      status: 'ready',
      items: [
        { id: 'i1', status: 'ready' },
        { id: 'i2', status: 'ready' },
      ],
    };
    broadcastOrderStatusChange(order, 'preparing');
    expect(broadcastMeserosMock).toHaveBeenCalledTimes(1);
    const [event] = broadcastMeserosMock.mock.calls[0];
    expect(event.type).toBe('order_complete');
    expect(event.orderId).toBe('ord-2');
  });

  it('does NOT emit order_complete when only some items are ready', async () => {
    const { broadcastOrderStatusChange } = await import('../../server/services/order-broadcaster.js');
    const order = {
      id: 'ord-3',
      table_number: 8,
      status: 'ready',
      items: [
        { id: 'i1', status: 'ready' },
        { id: 'i2', status: 'preparing' },
      ],
    };
    broadcastOrderStatusChange(order, 'preparing');
    expect(broadcastMeserosMock).not.toHaveBeenCalled();
  });

  it('does NOT emit order_complete if status is not "ready" even when all items ready', async () => {
    const { broadcastOrderStatusChange } = await import('../../server/services/order-broadcaster.js');
    const order = {
      id: 'ord-4',
      table_number: 9,
      status: 'served',
      items: [
        { id: 'i1', status: 'ready' },
        { id: 'i2', status: 'ready' },
      ],
    };
    broadcastOrderStatusChange(order, 'ready');
    expect(broadcastMeserosMock).not.toHaveBeenCalled();
  });

  it('handles cancelled items as "complete" for the all-ready check', async () => {
    const { broadcastOrderStatusChange } = await import('../../server/services/order-broadcaster.js');
    const order = {
      id: 'ord-5',
      table_number: 10,
      status: 'ready',
      items: [
        { id: 'i1', status: 'ready' },
        { id: 'i2', status: 'cancelled' },
      ],
    };
    broadcastOrderStatusChange(order, 'preparing');
    expect(broadcastMeserosMock).toHaveBeenCalledTimes(1);
  });

  it('handles delivered items as "complete" for the all-ready check', async () => {
    const { broadcastOrderStatusChange } = await import('../../server/services/order-broadcaster.js');
    const order = {
      id: 'ord-6',
      table_number: 11,
      status: 'ready',
      items: [
        { id: 'i1', status: 'delivered' },
        { id: 'i2', status: 'ready' },
      ],
    };
    broadcastOrderStatusChange(order, 'preparing');
    expect(broadcastMeserosMock).toHaveBeenCalledTimes(1);
  });

  it('order with zero items does not trigger order_complete', async () => {
    const { broadcastOrderStatusChange } = await import('../../server/services/order-broadcaster.js');
    const order = { id: 'ord-7', table_number: 12, status: 'ready', items: [] };
    broadcastOrderStatusChange(order, 'preparing');
    expect(broadcastMeserosMock).not.toHaveBeenCalled();
  });

  it('is a no-op when order is null/undefined', async () => {
    const { broadcastOrderStatusChange } = await import('../../server/services/order-broadcaster.js');
    expect(() => broadcastOrderStatusChange(null, 'preparing')).not.toThrow();
    expect(broadcastKDSMock).not.toHaveBeenCalled();
  });
});
