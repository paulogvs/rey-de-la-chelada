/**
 * useClientOrder — pure logic tests (status labels, terminal detection,
 * persisted order round-trip). Hook behavior itself is covered by the
 * clientes flow (build + e2e); these pure helpers are unit-tested.
 */

import { describe, it, expect } from 'vitest';
import {
  statusLabel,
  isTerminalStatus,
  readPersistedOrder,
  ORDER_STORAGE_KEY,
} from '../../src/pwa/clientes/hooks/useClientOrder';

describe('statusLabel', () => {
  it('maps every order status to a friendly Spanish label', () => {
    expect(statusLabel('called')).toBe('El mesero se acerca…');
    expect(statusLabel('confirmed')).toBe('Pedido confirmado');
    expect(statusLabel('preparing')).toBe('En preparación');
    expect(statusLabel('ready')).toContain('listo');
    expect(statusLabel('served')).toContain('Disfruta');
    expect(statusLabel('paid')).toBe('Pago recibido');
    expect(statusLabel('cancelled')).toBe('Pedido cancelado');
  });

  it('falls back to a generic label for unknown statuses', () => {
    expect(statusLabel('weird')).toBe('Procesando pedido…');
  });
});

describe('isTerminalStatus', () => {
  it('treats paid and cancelled as terminal', () => {
    expect(isTerminalStatus('paid')).toBe(true);
    expect(isTerminalStatus('cancelled')).toBe(true);
  });

  it('treats all active statuses as non-terminal', () => {
    expect(isTerminalStatus('called')).toBe(false);
    expect(isTerminalStatus('confirmed')).toBe(false);
    expect(isTerminalStatus('preparing')).toBe(false);
    expect(isTerminalStatus('ready')).toBe(false);
    expect(isTerminalStatus('served')).toBe(false);
  });
});

describe('readPersistedOrder', () => {
  // Simple in-memory storage shim (node has no localStorage)
  function makeStorage() {
    const map = new Map<string, string>();
    return {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, v),
      removeItem: (k: string) => void map.delete(k),
      clear: () => map.clear(),
      key: () => null,
      length: 0,
    };
  }

  it('reads a valid persisted order from storage', () => {
    const storage = makeStorage();
    const order = { orderId: 'o1', status: 'preparing', tableNumber: 3, total: 45.5 };
    storage.setItem(ORDER_STORAGE_KEY, JSON.stringify(order));
    expect(readPersistedOrder(storage as unknown as Storage)).toEqual(order);
  });

  it('returns null when nothing is persisted or the payload is invalid', () => {
    const storage = makeStorage();
    expect(readPersistedOrder(storage as unknown as Storage)).toBeNull();

    storage.setItem(ORDER_STORAGE_KEY, JSON.stringify({ status: 'preparing' })); // no orderId
    expect(readPersistedOrder(storage as unknown as Storage)).toBeNull();

    storage.setItem(ORDER_STORAGE_KEY, '{not-json');
    expect(readPersistedOrder(storage as unknown as Storage)).toBeNull();
  });

  it('returns null when no storage is available', () => {
    expect(readPersistedOrder()).toBeNull();
  });
});
