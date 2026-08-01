/**
 * useKDSWebSocket Tests — pure helpers (parse + backoff + url + item mapping)
 *
 * TDD: These helpers are the parsing layer of the KDS WebSocket hook.
 * They are framework-free so they can run in node (vitest environment: node).
 */

import { describe, it, expect } from 'vitest';
import {
  parseKDSMessage,
  getBackoffDelay,
  buildWsUrl,
  normalizeServerItem,
} from '../../src/pwa/_shared/hooks/useKDSWebSocket';

describe('parseKDSMessage', () => {
  it('parses a valid new_order message with normalized items', () => {
    const raw = JSON.stringify({
      type: 'new_order',
      orderId: 'order-1',
      tableNumber: 5,
      status: 'confirmed',
      timestamp: '2026-08-01T10:00:00.000Z',
      items: [
        {
          id: 'item-1',
          menu_item_id: 'MENU-1',
          item_name: 'Cheve-Chango',
          quantity: 2,
          unit_price: 25,
          item_status: 'pending',
          item_notes: 'sin hielo',
          modifiers_json: JSON.stringify([{ groupName: 'Tamaño', optionName: 'Mediana', priceAdjustment: 0 }]),
          created_at: '2026-08-01T10:00:00.000Z',
          kds_module: 'bar',
        },
      ],
    });

    const msg = parseKDSMessage(raw);
    expect(msg).not.toBeNull();
    expect(msg!.type).toBe('new_order');
    expect(msg!.orderId).toBe('order-1');
    expect(msg!.tableNumber).toBe(5);
    expect(msg!.items).toHaveLength(1);
    expect(msg!.items![0]).toMatchObject({
      id: 'item-1',
      menuItemId: 'MENU-1',
      menuItemName: 'Cheve-Chango',
      quantity: 2,
      unitPrice: 25,
      status: 'pending',
      preparationNotes: 'sin hielo',
      kds_module: 'bar',
    });
    expect(msg!.items![0].modifiers).toEqual([
      { groupName: 'Tamaño', optionName: 'Mediana', priceAdjustment: 0 },
    ]);
  });

  it('returns null for malformed JSON', () => {
    expect(parseKDSMessage('{not json')).toBeNull();
    expect(parseKDSMessage('')).toBeNull();
  });

  it('returns null for non-object payloads', () => {
    expect(parseKDSMessage('"hello"')).toBeNull();
    expect(parseKDSMessage('42')).toBeNull();
  });

  it('returns null for unknown event types', () => {
    const raw = JSON.stringify({ type: 'ping', timestamp: 'now' });
    expect(parseKDSMessage(raw)).toBeNull();
  });

  it('returns null when orderId is missing for order events', () => {
    const raw = JSON.stringify({ type: 'new_order', tableNumber: 5 });
    expect(parseKDSMessage(raw)).toBeNull();
  });

  it('parses order_complete without items', () => {
    const raw = JSON.stringify({
      type: 'order_complete',
      orderId: 'order-9',
      tableNumber: 3,
      status: 'ready',
      timestamp: '2026-08-01T10:00:00.000Z',
    });
    const msg = parseKDSMessage(raw);
    expect(msg).not.toBeNull();
    expect(msg!.type).toBe('order_complete');
    expect(msg!.items).toBeUndefined();
  });

  it('drops malformed items but keeps the event', () => {
    const raw = JSON.stringify({
      type: 'new_order',
      orderId: 'order-1',
      tableNumber: 2,
      items: [{ bad: 'item', no_id: true }],
    });
    const msg = parseKDSMessage(raw);
    expect(msg).not.toBeNull();
    expect(msg!.items).toEqual([]);
  });
});

describe('getBackoffDelay', () => {
  it('starts at initial delay', () => {
    expect(getBackoffDelay(0)).toBe(1000);
    expect(getBackoffDelay(0, 500, 30000)).toBe(500);
  });

  it('doubles each attempt', () => {
    expect(getBackoffDelay(1)).toBe(2000);
    expect(getBackoffDelay(2)).toBe(4000);
    expect(getBackoffDelay(3)).toBe(8000);
  });

  it('caps at max delay', () => {
    expect(getBackoffDelay(10)).toBe(30000);
    expect(getBackoffDelay(10, 1000, 5000)).toBe(5000);
  });

  it('never returns zero for attempt 0 with default params', () => {
    expect(getBackoffDelay(0)).toBeGreaterThan(0);
  });
});

describe('buildWsUrl', () => {
  it('builds a ws:// url for http hosts', () => {
    expect(buildWsUrl('cocina', 'http://localhost:3001')).toBe('ws://localhost:3001/cocina');
  });

  it('builds a wss:// url for https hosts', () => {
    expect(buildWsUrl('cocina', 'https://kds.example.com')).toBe('wss://kds.example.com/cocina');
  });

  it('handles trailing slashes in the base url', () => {
    expect(buildWsUrl('bar', 'http://localhost:3001/')).toBe('ws://localhost:3001/bar');
  });

  it('falls back to window.location when no base is provided', () => {
    const original = globalThis.window;
    Object.defineProperty(globalThis, 'window', {
      value: { location: { protocol: 'http:', host: 'kds.local:3001' } },
      configurable: true,
    });
    try {
      expect(buildWsUrl('meseros')).toBe('ws://kds.local:3001/meseros');
    } finally {
      Object.defineProperty(globalThis, 'window', { value: original, configurable: true });
    }
  });
});

describe('normalizeServerItem', () => {
  it('maps DB snake_case shape to client camelCase shape', () => {
    const raw = {
      id: 'i1',
      menu_item_id: 'MENU-2',
      item_name: 'César Tradicional',
      quantity: 1,
      unit_price: 45,
      item_status: 'pending',
      modifiers_json: '[]',
      created_at: '2026-08-01T09:00:00.000Z',
      kds_module: 'cocina',
    };
    const item = normalizeServerItem(raw);
    expect(item).toMatchObject({
      id: 'i1',
      menuItemId: 'MENU-2',
      menuItemName: 'César Tradicional',
      quantity: 1,
      unitPrice: 45,
      status: 'pending',
      kds_module: 'cocina',
    });
    expect(item!.subtotal).toBe(45);
  });

  it('returns null for entries without an id', () => {
    expect(normalizeServerItem({ item_name: 'x' })).toBeNull();
  });

  it('computes subtotal including modifier adjustments', () => {
    const raw = {
      id: 'i2',
      menu_item_id: 'MENU-3',
      item_name: 'La Rey',
      quantity: 2,
      unit_price: 40,
      item_status: 'pending',
      modifiers_json: JSON.stringify([
        { groupName: 'Tamaño', optionName: 'Familiar', priceAdjustment: 20 },
      ]),
    };
    const item = normalizeServerItem(raw);
    expect(item!.subtotal).toBe(120); // (40 + 20) * 2
  });
});
