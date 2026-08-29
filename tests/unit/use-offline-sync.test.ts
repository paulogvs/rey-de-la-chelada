/**
 * useOfflineSync — lógica pura de decisión offline (v14 2026-08-28).
 *
 * `shouldQueueOffline(isOnline, hasQueue)` decide si una acción se encola
 * (sin conexión) o va directo al server (online). Testeable sin React.
 */

import { describe, it, expect } from 'vitest';
import { shouldQueueOffline } from '../../src/pwa/_shared/hooks/useOfflineSync';

describe('shouldQueueOffline — decisión de encolado (sin romper el flujo online)', () => {
  it('offline + hay cola → encola (true)', () => {
    expect(shouldQueueOffline(false, true)).toBe(true);
  });

  it('online + hay cola → NO encola (false) — el flujo online sigue directo', () => {
    expect(shouldQueueOffline(true, true)).toBe(false);
  });

  it('offline pero SIN cola disponible → NO encola (fallback: el POST directo, que fallará con aviso)', () => {
    expect(shouldQueueOffline(false, false)).toBe(false);
  });

  it('online sin cola → no encola (false)', () => {
    expect(shouldQueueOffline(true, false)).toBe(false);
  });
});