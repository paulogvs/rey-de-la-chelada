/**
 * useOnlineStatus Tests — online/offline detection helpers
 *
 * Se testean los helpers puros (getOnlineStatus / subscribeOnlineStatus)
 * con un mock de `window` como EventTarget.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  getOnlineStatus,
  subscribeOnlineStatus,
  isBrowserOnline,
} from '../../src/pwa/_shared/hooks/useOnlineStatus';

/** EventTarget mínimo para simular window */
class FakeWindow {
  listeners: Record<string, Array<(e: unknown) => void>> = {};
  onLineValue = true;

  addEventListener(type: string, cb: (e: unknown) => void) {
    (this.listeners[type] ||= []).push(cb);
  }
  removeEventListener(type: string, cb: (e: unknown) => void) {
    this.listeners[type] = (this.listeners[type] || []).filter(l => l !== cb);
  }
  dispatch(type: string, e: unknown) {
    for (const cb of this.listeners[type] || []) cb(e);
  }
}

describe('useOnlineStatus helpers', () => {
  let fakeWindow: FakeWindow;
  const originalWindow = globalThis.window;

  beforeEach(() => {
    fakeWindow = new FakeWindow();
    Object.defineProperty(globalThis, 'window', { value: fakeWindow, configurable: true });
    Object.defineProperty(globalThis, 'navigator', {
      value: { onLine: true },
      configurable: true,
    });
  });

  afterEach(() => {
    Object.defineProperty(globalThis, 'window', { value: originalWindow, configurable: true });
    vi.restoreAllMocks();
  });

  it('should return true when navigator.onLine is true', () => {
    expect(isBrowserOnline()).toBe(true);
    expect(getOnlineStatus()).toBe(true);
  });

  it('should return false when navigator.onLine is false', () => {
    Object.defineProperty(globalThis, 'navigator', {
      value: { onLine: false },
      configurable: true,
    });
    expect(getOnlineStatus()).toBe(false);
  });

  it('should notify subscribers on offline and online events', () => {
    const cb = vi.fn();
    const unsubscribe = subscribeOnlineStatus(cb);

    // Los navegadores actualizan navigator.onLine ANTES de emitir el evento
    Object.defineProperty(globalThis, 'navigator', {
      value: { onLine: false },
      configurable: true,
    });
    fakeWindow.dispatch('offline', {});
    expect(cb).toHaveBeenLastCalledWith(false);

    Object.defineProperty(globalThis, 'navigator', {
      value: { onLine: true },
      configurable: true,
    });
    fakeWindow.dispatch('online', {});
    expect(cb).toHaveBeenLastCalledWith(true);

    unsubscribe();
    fakeWindow.dispatch('offline', {});
    expect(cb).toHaveBeenCalledTimes(2); // no new call after unsubscribe
  });

  it('should be a no-op when window is not available', () => {
    Object.defineProperty(globalThis, 'window', { value: undefined, configurable: true });
    const cb = vi.fn();
    const unsubscribe = subscribeOnlineStatus(cb);
    expect(unsubscribe).toBeInstanceOf(Function);
    expect(cb).not.toHaveBeenCalled();
  });
});
