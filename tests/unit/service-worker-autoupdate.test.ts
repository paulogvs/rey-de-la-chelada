/**
 * Unit tests — serviceWorkerAutoUpdate (FIX "pantalla café")
 *
 * Verifica que el registro del SW:
 *  1. Registra con scope correcto /[module]/sw.js
 *  2. Si hay un SW waiting → postMessage SKIP_WAITING (activa el nuevo)
 *  3. Si el SW nuevo se instala → postMessage SKIP_WAITING al instalarse
 *  4. Al tomar control (controllerchange) → recarga UNA vez (no en loop)
 *  5. Si hay controller → llama update() para buscar versiones nuevas
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { registerServiceWorkerWithAutoUpdate } from '../../src/pwa/_shared/serviceWorkerAutoUpdate';

/** Crea un worker mock con estado configurable (state mutable para transiciones) */
function makeWorker(initialState = 'installed') {
  const listeners: Record<string, Array<() => void>> = {};
  const worker = {
    state: initialState,
    postMessage: vi.fn(),
    addEventListener: vi.fn((type: string, fn: () => void) => {
      (listeners[type] ||= []).push(fn);
    }),
    // helper para el test: transiciona de estado y dispara statechange
    _setState(state: string) {
      worker.state = state;
      (listeners.statechange || []).forEach(fn => fn());
    },
  };
  return worker;
}

/** Crea un registration mock */
function makeRegistration(overrides: Partial<ReturnType<typeof makeRegistration>> = {}) {
  const listeners: Record<string, Array<() => void>> = {};
  const registration = {
    waiting: null as ReturnType<typeof makeWorker> | null,
    installing: null as ReturnType<typeof makeWorker> | null,
    update: vi.fn().mockResolvedValue(undefined),
    addEventListener: vi.fn((type: string, fn: () => void) => {
      (listeners[type] ||= []).push(fn);
    }),
    _emit(type: string) {
      (listeners[type] || []).forEach(fn => fn());
    },
    ...overrides,
  };
  return registration;
}

/** Crea un navigator.serviceWorker mock */
function makeServiceWorker(overrides: Partial<ServiceWorkerNavigatorLike> = {}) {
  const ctrlListeners: Array<() => void> = [];
  const sw = {
    controller: null,
    register: vi.fn(),
    addEventListener: vi.fn((type: string, fn: () => void) => {
      if (type === 'controllerchange') ctrlListeners.push(fn);
    }),
    _emitControllerChange() {
      ctrlListeners.forEach(fn => fn());
    },
    ...overrides,
  };
  return sw as unknown as ReturnType<typeof makeServiceWorker>;
}

describe('registerServiceWorkerWithAutoUpdate', () => {
  let reloadSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    reloadSpy = vi.fn();
  });

  it('registra el SW con el scope correcto del módulo', async () => {
    const sw = makeServiceWorker();
    sw.register.mockResolvedValue(makeRegistration());
    await registerServiceWorkerWithAutoUpdate('clientes', sw as never, { location: { reload: reloadSpy } } as never);

    expect(sw.register).toHaveBeenCalledWith('/clientes/sw.js', { scope: '/clientes/' });
  });

  it('activa un SW waiting pendiente (build anterior) con SKIP_WAITING', async () => {
    const waitingWorker = makeWorker('installed');
    const registration = makeRegistration({ waiting: waitingWorker });
    const sw = makeServiceWorker();
    sw.register.mockResolvedValue(registration);

    await registerServiceWorkerWithAutoUpdate('clientes', sw as never, { location: { reload: reloadSpy } } as never);

    expect(waitingWorker.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' });
  });

  it('activa el SW nuevo con SKIP_WAITING cuando se instala (updatefound)', async () => {
    const newWorker = makeWorker('installing');
    const registration = makeRegistration({ installing: newWorker });
    const sw = makeServiceWorker();
    sw.controller = {}; // ya hay un SW controlando
    sw.register.mockResolvedValue(registration);

    await registerServiceWorkerWithAutoUpdate('clientes', sw as never, { location: { reload: reloadSpy } } as never);

    // updatefound → el listener de statechange se registra en el worker nuevo
    registration._emit('updatefound');
    // El worker se instala → statechange con state='installed'
    newWorker._setState('installed');

    expect(newWorker.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' });
  });

  it('recarga UNA vez cuando el SW nuevo toma control (controllerchange)', async () => {
    const sw = makeServiceWorker();
    sw.register.mockResolvedValue(makeRegistration());

    await registerServiceWorkerWithAutoUpdate('clientes', sw as never, { location: { reload: reloadSpy } } as never);

    sw._emitControllerChange();
    sw._emitControllerChange();
    sw._emitControllerChange();

    expect(reloadSpy).toHaveBeenCalledTimes(1);
  });

  it('busca actualizaciones si ya estamos controlados por un SW', async () => {
    const registration = makeRegistration();
    const sw = makeServiceWorker();
    sw.controller = { /* SW activo */ };
    sw.register.mockResolvedValue(registration);

    await registerServiceWorkerWithAutoUpdate('clientes', sw as never, { location: { reload: reloadSpy } } as never);

    expect(registration.update).toHaveBeenCalled();
  });

  it('NO busca actualizaciones si no hay controller (primera visita)', async () => {
    const registration = makeRegistration();
    const sw = makeServiceWorker();
    sw.controller = null;
    sw.register.mockResolvedValue(registration);

    await registerServiceWorkerWithAutoUpdate('clientes', sw as never, { location: { reload: reloadSpy } } as never);

    expect(registration.update).not.toHaveBeenCalled();
  });
});
