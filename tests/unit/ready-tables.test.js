/**
 * Ready Tables — pure helpers for the meseros "🍴 Listo" badge (S2-A)
 *
 * The meseros PWA must show a persistent indicator of which tables have
 * an order fully ready to serve. The server is the SSOT of refresh:
 * it emits `order_complete` (to meseros) when the last non-cancelled
 * item of an order becomes 'ready'. This module maps those events into
 * a Map<tableNumber → timestamp> that TablesView renders as a badge.
 */

import { describe, it, expect } from 'vitest';
import { nextReadyTables } from '../../src/pwa/meseros/readyTables';

const T0 = 1_752_000_000_000; // fixed "now" for deterministic tests

describe('nextReadyTables — badge "Listo para servir"', () => {
  it('agrega la mesa cuando llega order_complete con tableNumber', () => {
    const prev = new Map();
    const next = nextReadyTables(prev, { type: 'order_complete', tableNumber: 7 }, T0);
    expect(next.get(7)).toBe(T0);
  });

  it('no muta el mapa anterior (pure function)', () => {
    const prev = new Map([[7, T0]]);
    const next = nextReadyTables(prev, { type: 'status_change', tableNumber: 7, status: 'paid' }, T0);
    expect(prev.has(7)).toBe(true);
    expect(next.has(7)).toBe(false);
    expect(next).not.toBe(prev);
  });

  it('conserva mesas existentes al agregar una nueva', () => {
    const prev = new Map([[3, T0]]);
    const next = nextReadyTables(prev, { type: 'order_complete', tableNumber: 5 }, T0);
    expect(next.has(3)).toBe(true);
    expect(next.has(5)).toBe(true);
  });

  it('status_change a paid quita la mesa de la lista', () => {
    const prev = new Map([[4, T0]]);
    const next = nextReadyTables(prev, { type: 'status_change', tableNumber: 4, status: 'paid' }, T0);
    expect(next.has(4)).toBe(false);
  });

  it('status_change a served quita la mesa de la lista', () => {
    const prev = new Map([[4, T0]]);
    const next = nextReadyTables(prev, { type: 'status_change', tableNumber: 4, status: 'served' }, T0);
    expect(next.has(4)).toBe(false);
  });

  it('status_change a cancelled quita la mesa de la lista', () => {
    const prev = new Map([[4, T0]]);
    const next = nextReadyTables(prev, { type: 'status_change', tableNumber: 4, status: 'cancelled' }, T0);
    expect(next.has(4)).toBe(false);
  });

  it('status_change a otro estado NO quita el badge', () => {
    const prev = new Map([[4, T0]]);
    const next = nextReadyTables(prev, { type: 'status_change', tableNumber: 4, status: 'preparing' }, T0);
    expect(next.has(4)).toBe(true);
  });

  it('expira la entrada tras el TTL (10 min por defecto)', () => {
    const prev = new Map([[6, T0]]);
    const ttl = 10 * 60 * 1000;
    const next = nextReadyTables(prev, { type: 'status_change', tableNumber: 2, status: 'preparing' }, T0 + ttl + 1);
    expect(next.has(6)).toBe(false);
  });

  it('conserva la entrada dentro del TTL', () => {
    const prev = new Map([[6, T0]]);
    const ttl = 10 * 60 * 1000;
    const next = nextReadyTables(prev, { type: 'status_change', tableNumber: 2, status: 'preparing' }, T0 + ttl - 1);
    expect(next.has(6)).toBe(true);
  });

  it('ignora eventos sin tableNumber', () => {
    const prev = new Map([[2, T0]]);
    const next = nextReadyTables(prev, { type: 'order_complete' }, T0);
    expect(next.size).toBe(1);
    expect(next.has(2)).toBe(true);
  });
});
