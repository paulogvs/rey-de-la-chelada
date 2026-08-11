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
const broadcastToModuleMock = vi.fn();

vi.mock('../../server/services/websocket-broadcaster.js', () => ({
  broadcaster: {
    broadcastKDS: (...args) => broadcastKDSMock(...args),
    broadcastMeseros: (...args) => broadcastMeserosMock(...args),
    broadcastToModules: (...args) => broadcastToModulesMock(...args),
    broadcastToModule: (...args) => broadcastToModuleMock(...args),
  },
  buildKDSEvent: (type, fields) => ({ type, timestamp: '2026-08-01T00:00:00.000Z', ...fields }),
  KDSEventType: { NEW_ORDER: 'new_order', STATUS_CHANGE: 'status_change', ITEM_READY: 'item_ready', ORDER_COMPLETE: 'order_complete', MODULE_READY: 'module_ready' },
}));

describe('Order Broadcaster — broadcastOrderCreated', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('emits new_order event to KDS when an order is created/confirmed', async () => {
    const { broadcastOrderCreated } = await import('../../server/services/order-broadcaster.js');
    const order = {
      id: 'ord-1',
      table_number: 5,
      items: [{ id: 'i1', status: 'pending' }],
      status: 'confirmed',
    };
    broadcastOrderCreated(order);
    expect(broadcastKDSMock).toHaveBeenCalledTimes(1);
    const [event] = broadcastKDSMock.mock.calls[0];
    expect(event.type).toBe('new_order');
    expect(event.orderId).toBe('ord-1');
    expect(event.tableNumber).toBe(5);
    expect(event.status).toBe('confirmed');
  });

  it('emits the REAL order status (called for client-created public orders)', async () => {
    const { broadcastOrderCreated } = await import('../../server/services/order-broadcaster.js');
    const order = {
      id: 'ord-2',
      table_number: 6,
      items: [{ id: 'i1', status: 'pending' }],
      status: 'called',
    };
    broadcastOrderCreated(order);
    const [event] = broadcastKDSMock.mock.calls[0];
    expect(event.status).toBe('called');
  });

  it('does not notify meseros on creation', async () => {
    const { broadcastOrderCreated } = await import('../../server/services/order-broadcaster.js');
    broadcastOrderCreated({ id: 'ord-1', table_number: 1, items: [] });
    expect(broadcastMeserosMock).not.toHaveBeenCalled();
  });

  it('is a no-op when order is null/undefined', async () => {
    const { broadcastOrderCreated } = await import('../../server/services/order-broadcaster.js');
    expect(() => broadcastOrderCreated(null)).not.toThrow();
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

describe('Order Broadcaster — caja real-time (S2-D)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('broadcastOrderCreated emite status_change SOLO al módulo caja', async () => {
    const { broadcastOrderCreated } = await import('../../server/services/order-broadcaster.js');
    const order = { id: 'ord-c1', table_number: 5, items: [], status: 'confirmed' };
    broadcastOrderCreated(order);
    expect(broadcastToModuleMock).toHaveBeenCalledTimes(1);
    const [module, event] = broadcastToModuleMock.mock.calls[0];
    expect(module).toBe('caja');
    expect(event.type).toBe('status_change');
    expect(event.orderId).toBe('ord-c1');
    expect(event.status).toBe('confirmed');
  });

  it('broadcastOrderStatusChange emite status_change a caja con el status real', async () => {
    const { broadcastOrderStatusChange } = await import('../../server/services/order-broadcaster.js');
    const order = { id: 'ord-c2', table_number: 3, status: 'served', items: [] };
    broadcastOrderStatusChange(order, 'ready');
    expect(broadcastToModuleMock).toHaveBeenCalledTimes(1);
    const [module, event] = broadcastToModuleMock.mock.calls[0];
    expect(module).toBe('caja');
    expect(event.status).toBe('served');
  });

  it('broadcastOrderToCaja es no-op con order null', async () => {
    const { broadcastOrderToCaja } = await import('../../server/services/order-broadcaster.js');
    expect(() => broadcastOrderToCaja(null)).not.toThrow();
    expect(broadcastToModuleMock).not.toHaveBeenCalled();
  });

  it('broadcastOrderComplete emite order_complete a meseros con status ready', async () => {
    const { broadcastOrderComplete } = await import('../../server/services/order-broadcaster.js');
    const order = { id: 'ord-c3', table_number: 9, status: 'ready', items: [] };
    broadcastOrderComplete(order);
    expect(broadcastMeserosMock).toHaveBeenCalledTimes(1);
    const [event] = broadcastMeserosMock.mock.calls[0];
    expect(event.type).toBe('order_complete');
    expect(event.orderId).toBe('ord-c3');
    expect(event.tableNumber).toBe(9);
    expect(event.status).toBe('ready');
  });

  it('isOrderFullyReady se exporta y es correcto', async () => {
    const { isOrderFullyReady } = await import('../../server/services/order-broadcaster.js');
    expect(isOrderFullyReady({ items: [{ status: 'ready' }, { status: 'delivered' }] })).toBe(true);
    expect(isOrderFullyReady({ items: [{ status: 'ready' }, { status: 'pending' }] })).toBe(false);
    expect(isOrderFullyReady({ items: [] })).toBe(false);
  });
});

describe('Order Broadcaster — aviso parcial por módulo (bar/cocina separados)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('isModuleFullyReady: true cuando TODOS los items de ESE módulo están terminales', async () => {
    const { isModuleFullyReady } = await import('../../server/services/order-broadcaster.js');
    const order = {
      items: [
        { id: 'i1', status: 'ready', kds_module: 'bar' },
        { id: 'i2', status: 'delivered', kds_module: 'bar' },
        { id: 'i3', status: 'pending', kds_module: 'cocina' },
      ],
    };
    expect(isModuleFullyReady(order, 'bar')).toBe(true);
    expect(isModuleFullyReady(order, 'cocina')).toBe(false);
  });

  it('isModuleFullyReady: cancelled cuenta como terminal', async () => {
    const { isModuleFullyReady } = await import('../../server/services/order-broadcaster.js');
    const order = {
      items: [
        { id: 'i1', status: 'cancelled', kds_module: 'bar' },
        { id: 'i2', status: 'ready', kds_module: 'bar' },
      ],
    };
    expect(isModuleFullyReady(order, 'bar')).toBe(true);
  });

  it('isModuleFullyReady: módulo sin items NO está listo', async () => {
    const { isModuleFullyReady } = await import('../../server/services/order-broadcaster.js');
    expect(isModuleFullyReady({ items: [] }, 'bar')).toBe(false);
    expect(isModuleFullyReady({ items: [{ id: 'i1', status: 'ready', kds_module: 'cocina' }] }, 'bar')).toBe(false);
  });

  it('broadcastModuleReady emite module_ready a MESEROS con el módulo', async () => {
    const { broadcastModuleReady } = await import('../../server/services/order-broadcaster.js');
    const order = { id: 'ord-m1', table_number: 7, status: 'confirmed', items: [] };
    broadcastModuleReady(order, 'bar');
    expect(broadcastMeserosMock).toHaveBeenCalledTimes(1);
    const [event] = broadcastMeserosMock.mock.calls[0];
    expect(event.type).toBe('module_ready');
    expect(event.orderId).toBe('ord-m1');
    expect(event.tableNumber).toBe(7);
    expect(event.module).toBe('bar');
  });

  it('broadcastModuleReady es no-op con order null o módulo inválido', async () => {
    const { broadcastModuleReady } = await import('../../server/services/order-broadcaster.js');
    expect(() => broadcastModuleReady(null, 'bar')).not.toThrow();
    expect(() => broadcastModuleReady({ id: 'x', items: [] }, 'no-existe')).not.toThrow();
    expect(broadcastMeserosMock).not.toHaveBeenCalled();
  });
});
