/**
 * safeId — UUID v4 compatible con contextos no-seguros (2026-08-28).
 *
 * `crypto.randomUUID()` existe SOLO en contextos seguros (https/localhost).
 * En una PWA por IP LAN/Tailscale (http://192.168.x.x) es `undefined` →
 * TypeError en el cobro. Este helper cae a getRandomValues.
 */

import { describe, it, expect } from 'vitest';
import { safeId } from '../../src/pwa/_shared/utils/safeId';

describe('safeId', () => {
  it('genera un UUID v4 con el formato esperado', () => {
    const id = safeId();
    // 8-4-4-4-12 hexadecimal
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    // versión 4 (el 13º hex char es '4') y variante (el 17º es 8/9/a/b)
    expect(id[14]).toBe('4');
    expect(['8', '9', 'a', 'b']).toContain(id[19]);
  });

  it('es único en invocaciones sucesivas', () => {
    const a = safeId();
    const b = safeId();
    expect(a).not.toBe(b);
  });

  it('funciona sin crypto.randomUUID (contexto no-seguro)', () => {
    // Simula un contexto inseguro donde randomUUID está ausente.
    const originalRandomUUID = globalThis.crypto?.randomUUID;
    try {
      Object.defineProperty(globalThis.crypto, 'randomUUID', { value: undefined, configurable: true });
      const id = safeId();
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    } finally {
      if (originalRandomUUID) {
        Object.defineProperty(globalThis.crypto, 'randomUUID', { value: originalRandomUUID, configurable: true });
      }
    }
  });
});