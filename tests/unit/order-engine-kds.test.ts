/**
 * OrderEngine.applyKDSEvent Tests — incoming WebSocket events
 *
 * TDD: When the KDS WebSocket hook receives a server event (new_order,
 * status_change, item_ready, order_complete) it dispatches it into the
 * engine via applyKDSEvent. These tests pin the engine-side behavior.
 */

import { describe, it, expect } from 'vitest';
import { OrderEngine } from '../../src/core/engine/OrderEngine';
import type { KDSIncomingEvent } from '../../src/core/types';

function makeItem(id: string, opts: Partial<Record<string, unknown>> = {}) {
  return {
    id,
    menuItemId: `menu-${id}`,
    menuItemName: `Item ${id}`,
    quantity: 1,
    unitPrice: 20,
    modifiers: [],
    subtotal: 20,
    status: 'pending',
    preparationNotes: '',
    createdAt: '2026-08-01T10:00:00.000Z',
    ...opts,
  } as never;
}

function makeOrderEvent(overrides: Partial<KDSIncomingEvent> = {}): KDSIncomingEvent {
  return {
    type: 'new_order',
    orderId: 'order-1',
    tableNumber: 5,
    status: 'confirmed',
    timestamp: '2026-08-01T10:00:00.000Z',
    items: [makeItem('item-1')],
    ...overrides,
  } as KDSIncomingEvent;
}

describe('OrderEngine.applyKDSEvent', () => {
  it('imports a new_order with its items and fires a KDS event', () => {
    const engine = new OrderEngine();
    const kdsEvents: string[] = [];
    engine.onKDSEvent(e => kdsEvents.push(e.type));

    const applied = engine.applyKDSEvent(makeOrderEvent());
    expect(applied).toBe(true);

    const order = engine.getOrder('order-1');
    expect(order).toBeDefined();
    expect(order!.tableNumber).toBe(5);
    expect(order!.status).toBe('confirmed');
    expect(order!.items).toHaveLength(1);
    expect(kdsEvents).toContain('new_order');
  });

  it('replaces an existing order on new_order (server is source of truth)', () => {
    const engine = new OrderEngine();
    engine.applyKDSEvent(makeOrderEvent());

    const second = makeOrderEvent({
      items: [makeItem('item-1'), makeItem('item-2')],
    });
    engine.applyKDSEvent(second);

    const order = engine.getOrder('order-1');
    expect(order!.items).toHaveLength(2);
  });

  it('returns false for events without an orderId', () => {
    const engine = new OrderEngine();
    const bad = { type: 'status_change', tableNumber: 3 } as KDSIncomingEvent;
    expect(engine.applyKDSEvent(bad)).toBe(false);
  });

  it('returns false for unknown event types', () => {
    const engine = new OrderEngine();
    const bad = { type: 'ping', orderId: 'x' } as unknown as KDSIncomingEvent;
    expect(engine.applyKDSEvent(bad)).toBe(false);
  });

  it('applies status_change to the order status', () => {
    const engine = new OrderEngine();
    engine.applyKDSEvent(makeOrderEvent());

    const applied = engine.applyKDSEvent(makeOrderEvent({
      type: 'status_change',
      status: 'preparing',
      previousStatus: 'confirmed',
    }));

    expect(applied).toBe(true);
    expect(engine.getOrder('order-1')!.status).toBe('preparing');
  });

  it('applies item_ready to a single item', () => {
    const engine = new OrderEngine();
    engine.applyKDSEvent(makeOrderEvent());

    const applied = engine.applyKDSEvent(makeOrderEvent({
      type: 'item_ready',
      itemId: 'item-1',
      status: 'ready',
    }));

    expect(applied).toBe(true);
    const order = engine.getOrder('order-1')!;
    expect(order.items.find(i => i.id === 'item-1')!.status).toBe('ready');
  });

  it('applies order_complete by marking the order ready', () => {
    const engine = new OrderEngine();
    engine.applyKDSEvent(makeOrderEvent());

    const applied = engine.applyKDSEvent(makeOrderEvent({
      type: 'order_complete',
      status: 'ready',
    }));

    expect(applied).toBe(true);
    expect(engine.getOrder('order-1')!.status).toBe('ready');
  });

  it('is a no-op for order events about unknown orders (silently safe)', () => {
    const engine = new OrderEngine();
    const applied = engine.applyKDSEvent(makeOrderEvent({
      type: 'order_complete',
      orderId: 'ghost-order',
    }));
    expect(applied).toBe(false);
  });
});
