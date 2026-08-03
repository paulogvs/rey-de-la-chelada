/**
 * Staff API — token storage helpers (pure, injectable storage)
 *
 * TDD: tests written before implementation.
 */

import { describe, it, expect } from 'vitest';
import {
  getStoredToken,
  setStoredToken,
  clearStoredToken,
  TOKEN_KEY_PREFIX,
} from '../../src/pwa/_shared/api/apiFetch';

function createMemoryStorage(): Storage {
  const store = new Map<string, string>();
  return {
    get length() { return store.size; },
    clear: () => store.clear(),
    getItem: (key: string) => store.get(key) ?? null,
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    removeItem: (key: string) => { store.delete(key); },
    setItem: (key: string, value: string) => { store.set(key, value); },
  };
}

describe('token storage (scoped per PWA module)', () => {
  it('stores and retrieves a token under the module-scoped key', () => {
    const storage = createMemoryStorage();
    setStoredToken('meseros', 'tok-abc', storage);
    expect(storage.getItem(`${TOKEN_KEY_PREFIX}meseros`)).toBe('tok-abc');
    expect(getStoredToken('meseros', storage)).toBe('tok-abc');
  });

  it('does not bleed between modules', () => {
    const storage = createMemoryStorage();
    setStoredToken('meseros', 'tok-m', storage);
    setStoredToken('caja', 'tok-c', storage);
    expect(getStoredToken('meseros', storage)).toBe('tok-m');
    expect(getStoredToken('caja', storage)).toBe('tok-c');
  });

  it('clears a token', () => {
    const storage = createMemoryStorage();
    setStoredToken('meseros', 'tok-abc', storage);
    clearStoredToken('meseros', storage);
    expect(getStoredToken('meseros', storage)).toBeNull();
  });

  it('returns null when no storage is available', () => {
    expect(getStoredToken('meseros', null as unknown as Storage)).toBeNull();
    // Safe no-op
    expect(() => setStoredToken('meseros', 'x', null as unknown as Storage)).not.toThrow();
  });

  it('reads from global localStorage when storage is not passed', () => {
    const store = new Map<string, string>();
    Object.defineProperty(globalThis, 'localStorage', {
      value: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => { store.set(k, v); },
        removeItem: (k: string) => { store.delete(k); },
      },
      configurable: true,
    });
    try {
      setStoredToken('admin', 'tok-admin');
      expect(getStoredToken('admin')).toBe('tok-admin');
      clearStoredToken('admin');
      expect(getStoredToken('admin')).toBeNull();
    } finally {
      Object.defineProperty(globalThis, 'localStorage', { value: undefined, configurable: true });
    }
  });
});
