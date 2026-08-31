/**
 * Order Broadcaster — Debounce de broadcastMenuChanged (v15 FASE 3 2026-08-31)
 *
 * Si el dueño activa/desactiva varios toggles de promos/extras rápido, cada
 * mutador llama broadcastMenuChanged() → los PWAs refetchean N veces.
 * El debounce acumula cambios y emite UN solo evento tras ~1000ms de
 * inactividad (el timer se reinicia en cada llamada).
 *
 * Contrato:
 *   - broadcastMenuChanged() NO emite síncrono (acumula)
 *   - tras 1000ms sin llamadas → emite UNA vez con el payload menu_changed
 *   - flushMenuChanged() emite de inmediato si hay un cambio pendiente (tests)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const broadcastToModulesMock = vi.fn();

vi.mock('../../server/services/websocket-broadcaster.js', () => ({
  broadcaster: {
    broadcastToModules: (...args) => broadcastToModulesMock(...args),
  },
  buildKDSEvent: (type, fields) => ({ type, timestamp: '2026-08-01T00:00:00.000Z', ...fields }),
  KDSEventType: { MENU_CHANGED: 'menu_changed' },
}));

describe('Order Broadcaster — broadcastMenuChanged (debounce)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('NO emite inmediatamente: acumula llamadas consecutivas', async () => {
    const { broadcastMenuChanged } = await import('../../server/services/order-broadcaster.js');
    broadcastMenuChanged();
    broadcastMenuChanged();
    broadcastMenuChanged();
    expect(broadcastToModulesMock).not.toHaveBeenCalled();
  });

  it('emite UNA sola vez tras 1000ms de inactividad (timer reinicia en cada llamada)', async () => {
    const { broadcastMenuChanged } = await import('../../server/services/order-broadcaster.js');
    broadcastMenuChanged();
    vi.advanceTimersByTime(900);
    broadcastMenuChanged(); // reinicia el timer
    vi.advanceTimersByTime(999);
    expect(broadcastToModulesMock).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(broadcastToModulesMock).toHaveBeenCalledTimes(1);
    const [modules, event] = broadcastToModulesMock.mock.calls[0];
    expect(modules).toEqual(['meseros', 'cocina', 'bar', 'caja']);
    expect(event.type).toBe('menu_changed');
    expect(event.timestamp).toBeTruthy();
  });

  it('flushMenuChanged() emite de inmediato si hay un cambio pendiente', async () => {
    const { broadcastMenuChanged, flushMenuChanged } = await import('../../server/services/order-broadcaster.js');
    broadcastMenuChanged();
    flushMenuChanged();
    expect(broadcastToModulesMock).toHaveBeenCalledTimes(1);
    const [modules, event] = broadcastToModulesMock.mock.calls[0];
    expect(modules).toEqual(['meseros', 'cocina', 'bar', 'caja']);
    expect(event.type).toBe('menu_changed');
  });

  it('flushMenuChanged() sin cambios pendientes es no-op', async () => {
    const { flushMenuChanged } = await import('../../server/services/order-broadcaster.js');
    flushMenuChanged();
    expect(broadcastToModulesMock).not.toHaveBeenCalled();
  });

  it('tras emitir, una nueva llamada vuelve a acumular (no emite doble)', async () => {
    const { broadcastMenuChanged } = await import('../../server/services/order-broadcaster.js');
    broadcastMenuChanged();
    vi.advanceTimersByTime(1000);
    expect(broadcastToModulesMock).toHaveBeenCalledTimes(1);
    broadcastMenuChanged();
    vi.advanceTimersByTime(500);
    expect(broadcastToModulesMock).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(500);
    expect(broadcastToModulesMock).toHaveBeenCalledTimes(2);
  });
});