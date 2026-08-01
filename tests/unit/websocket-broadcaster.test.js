/**
 * WebSocket Broadcaster Tests
 *
 * TDD: Tests for the KDS real-time broadcaster.
 * The broadcaster is the SSOT for sending events to connected clients
 * (cocina, bar, meseros).
 *
 * Eventos soportados:
 *  - new_order       → broadcast a cocina + bar
 *  - status_change   → broadcast a cocina + bar
 *  - item_ready      → broadcast a cocina + bar + meseros
 *  - order_complete  → broadcast a meseros
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock ws module shapes
function createMockClient(readyState = 1) {
  return {
    readyState,
    send: vi.fn(),
    on: vi.fn(),
  };
}

function createMockServer() {
  return {
    on: vi.fn(),
    clients: new Set(),
  };
}

describe('WebSocketBroadcaster', () => {
  let broadcaster;
  let mockServer;

  beforeEach(async () => {
    // Fresh import per test
    vi.resetModules();
    mockServer = createMockServer();
    const mod = await import('../../server/services/websocket-broadcaster.js');
    broadcaster = mod.default;
    broadcaster.attach(mockServer);
  });

  it('exports a broadcaster object with broadcast methods', () => {
    expect(broadcaster).toBeDefined();
    expect(typeof broadcaster.broadcast).toBe('function');
    expect(typeof broadcaster.broadcastToModule).toBe('function');
    expect(typeof broadcaster.broadcastToModules).toBe('function');
    expect(typeof broadcaster.broadcastKDS).toBe('function');
    expect(typeof broadcaster.broadcastMeseros).toBe('function');
    expect(typeof broadcaster.registerClient).toBe('function');
    expect(typeof broadcaster.unregisterClient).toBe('function');
  });

  it('registerClient tracks client + module + url', () => {
    const ws = createMockClient();
    broadcaster.registerClient(ws, '/cocina', 'cocina');
    expect(broadcaster.getClientCount('cocina')).toBe(1);
    expect(broadcaster.getClientCount()).toBe(1);
  });

  it('unregisterClient removes the client', () => {
    const ws = createMockClient();
    broadcaster.registerClient(ws, '/cocina', 'cocina');
    broadcaster.unregisterClient(ws);
    expect(broadcaster.getClientCount('cocina')).toBe(0);
  });

  it('broadcast sends to all connected clients with readyState OPEN', () => {
    const ws1 = createMockClient(1);
    const ws2 = createMockClient(1);
    const ws3 = createMockClient(0); // CLOSED — must be skipped
    broadcaster.registerClient(ws1, '/cocina', 'cocina');
    broadcaster.registerClient(ws2, '/bar', 'bar');
    broadcaster.registerClient(ws3, '/cocina', 'cocina');

    broadcaster.broadcast({ type: 'ping', timestamp: 'now' });

    expect(ws1.send).toHaveBeenCalledTimes(1);
    expect(ws2.send).toHaveBeenCalledTimes(1);
    expect(ws3.send).not.toHaveBeenCalled();
  });

  it('broadcast serializes payload to JSON', () => {
    const ws = createMockClient(1);
    broadcaster.registerClient(ws, '/cocina', 'cocina');
    const payload = { type: 'new_order', orderId: 'abc', table: 5 };
    broadcaster.broadcast(payload);
    expect(ws.send).toHaveBeenCalledWith(JSON.stringify(payload));
  });

  it('broadcastToModule targets only clients in that module', () => {
    const cocinaWs = createMockClient(1);
    const barWs = createMockClient(1);
    broadcaster.registerClient(cocinaWs, '/cocina', 'cocina');
    broadcaster.registerClient(barWs, '/bar', 'bar');

    broadcaster.broadcastToModule('cocina', { type: 'new_order' });

    expect(cocinaWs.send).toHaveBeenCalledTimes(1);
    expect(barWs.send).not.toHaveBeenCalled();
  });

  it('broadcastToModules targets multiple modules', () => {
    const cocinaWs = createMockClient(1);
    const barWs = createMockClient(1);
    const meserosWs = createMockClient(1);
    broadcaster.registerClient(cocinaWs, '/cocina', 'cocina');
    broadcaster.registerClient(barWs, '/bar', 'bar');
    broadcaster.registerClient(meserosWs, '/meseros', 'meseros');

    broadcaster.broadcastToModules(['cocina', 'bar'], { type: 'item_ready' });

    expect(cocinaWs.send).toHaveBeenCalledTimes(1);
    expect(barWs.send).toHaveBeenCalledTimes(1);
    expect(meserosWs.send).not.toHaveBeenCalled();
  });

  it('broadcastKDS is shorthand for cocina + bar', () => {
    const cocinaWs = createMockClient(1);
    const barWs = createMockClient(1);
    const meserosWs = createMockClient(1);
    broadcaster.registerClient(cocinaWs, '/cocina', 'cocina');
    broadcaster.registerClient(barWs, '/bar', 'bar');
    broadcaster.registerClient(meserosWs, '/meseros', 'meseros');

    broadcaster.broadcastKDS({ type: 'new_order', orderId: 'x' });

    expect(cocinaWs.send).toHaveBeenCalledTimes(1);
    expect(barWs.send).toHaveBeenCalledTimes(1);
    expect(meserosWs.send).not.toHaveBeenCalled();
  });

  it('broadcastMeseros sends only to meseros', () => {
    const cocinaWs = createMockClient(1);
    const meserosWs = createMockClient(1);
    broadcaster.registerClient(cocinaWs, '/cocina', 'cocina');
    broadcaster.registerClient(meserosWs, '/meseros', 'meseros');

    broadcaster.broadcastMeseros({ type: 'order_complete', orderId: 'x' });

    expect(meserosWs.send).toHaveBeenCalledTimes(1);
    expect(cocinaWs.send).not.toHaveBeenCalled();
  });

  it('handles send errors gracefully (does not throw)', () => {
    const ws = createMockClient(1);
    ws.send.mockImplementation(() => { throw new Error('Socket closed mid-send'); });
    broadcaster.registerClient(ws, '/cocina', 'cocina');
    expect(() => broadcaster.broadcast({ type: 'ping' })).not.toThrow();
  });

  it('getClientCount returns 0 when no clients', () => {
    expect(broadcaster.getClientCount()).toBe(0);
  });

  it('getClientCount can filter by module', () => {
    broadcaster.registerClient(createMockClient(1), '/cocina', 'cocina');
    broadcaster.registerClient(createMockClient(1), '/cocina', 'cocina');
    broadcaster.registerClient(createMockClient(1), '/bar', 'bar');
    expect(broadcaster.getClientCount('cocina')).toBe(2);
    expect(broadcaster.getClientCount('bar')).toBe(1);
  });

  it('treats unknown modules as "unknown" bucket', () => {
    const ws = createMockClient(1);
    broadcaster.registerClient(ws, '/other', 'unknown');
    expect(broadcaster.getClientCount('unknown')).toBe(1);
    broadcaster.broadcastToModule('unknown', { type: 'ping' });
    expect(ws.send).toHaveBeenCalledTimes(1);
  });

  it('unregister is safe for unknown clients', () => {
    const ws = createMockClient(1);
    expect(() => broadcaster.unregisterClient(ws)).not.toThrow();
  });
});

describe('KDSEventFactory', () => {
  it('builds new_order event with required fields', async () => {
    const { buildKDSEvent } = await import('../../server/services/websocket-broadcaster.js');
    const event = buildKDSEvent('new_order', { orderId: 'abc', tableNumber: 5 });
    expect(event.type).toBe('new_order');
    expect(event.orderId).toBe('abc');
    expect(event.tableNumber).toBe(5);
    expect(event.timestamp).toBeDefined();
  });

  it('builds status_change event with item snapshot', async () => {
    const { buildKDSEvent } = await import('../../server/services/websocket-broadcaster.js');
    const event = buildKDSEvent('status_change', {
      orderId: 'abc',
      tableNumber: 5,
      itemId: 'item-1',
      status: 'ready',
    });
    expect(event.type).toBe('status_change');
    expect(event.itemId).toBe('item-1');
    expect(event.status).toBe('ready');
  });

  it('builds order_complete event for meseros', async () => {
    const { buildKDSEvent } = await import('../../server/services/websocket-broadcaster.js');
    const event = buildKDSEvent('order_complete', {
      orderId: 'abc',
      tableNumber: 5,
    });
    expect(event.type).toBe('order_complete');
    expect(event.orderId).toBe('abc');
  });

  it('always includes a timestamp', async () => {
    const { buildKDSEvent } = await import('../../server/services/websocket-broadcaster.js');
    const before = Date.now();
    const event = buildKDSEvent('new_order', { orderId: 'abc' });
    const ts = new Date(event.timestamp).getTime();
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(Date.now() + 10);
  });
});
