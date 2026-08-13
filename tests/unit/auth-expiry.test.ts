/**
 * Unit tests — global 401 → auth:expired reaction (Capa 2).
 *
 * Verifica que:
 *   1. shouldDispatchAuthExpired solo es true para 401 con INVALID_TOKEN /
 *      AUTH_REQUIRED (NO para INVALID_PIN ni otros códigos/status).
 *   2. apiFetch despacha el evento 'auth:expired' en el window inyectado
 *      cuando la sesión está muerta, y NO lo hace en login/éxito.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  apiFetch,
  shouldDispatchAuthExpired,
  type AuthWindowLike,
} from '../../src/pwa/_shared/api/apiFetch';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function makeWindow() {
  return { dispatchEvent: vi.fn() } as AuthWindowLike;
}

describe('shouldDispatchAuthExpired', () => {
  it('true for 401 + INVALID_TOKEN', () => {
    expect(shouldDispatchAuthExpired(401, 'INVALID_TOKEN')).toBe(true);
  });

  it('true for 401 + AUTH_REQUIRED', () => {
    expect(shouldDispatchAuthExpired(401, 'AUTH_REQUIRED')).toBe(true);
  });

  it('false for 401 + INVALID_PIN (bad PIN at login)', () => {
    expect(shouldDispatchAuthExpired(401, 'INVALID_PIN')).toBe(false);
  });

  it('false for other codes even on 401', () => {
    expect(shouldDispatchAuthExpired(401, 'INVALID_TOKEN_FORMAT')).toBe(false);
    expect(shouldDispatchAuthExpired(401, 'REQUEST_FAILED')).toBe(false);
    expect(shouldDispatchAuthExpired(401, null)).toBe(false);
  });

  it('false for non-401 statuses', () => {
    expect(shouldDispatchAuthExpired(403, 'INVALID_TOKEN')).toBe(false);
    expect(shouldDispatchAuthExpired(500, 'INVALID_TOKEN')).toBe(false);
    expect(shouldDispatchAuthExpired(200, 'INVALID_TOKEN')).toBe(false);
  });
});

describe('apiFetch 401 dispatch', () => {
  it('dispatches auth:expired on a 401 INVALID_TOKEN response', async () => {
    const window = makeWindow();
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ success: false, code: 'INVALID_TOKEN', error: 'Token inválido' }, 401)
    );

    const result = await apiFetch('/api/tables', {
      fetchImpl: fetchMock as unknown as typeof fetch,
      windowImpl: window,
    });

    expect(result.ok).toBe(false);
    expect(result.code).toBe('INVALID_TOKEN');
    expect(window.dispatchEvent).toHaveBeenCalledTimes(1);
    expect(window.dispatchEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'auth:expired' })
    );
  });

  it('dispatches auth:expired on a 401 AUTH_REQUIRED response', async () => {
    const window = makeWindow();
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ success: false, code: 'AUTH_REQUIRED', error: 'Auth requerida' }, 401)
    );

    await apiFetch('/api/orders', {
      fetchImpl: fetchMock as unknown as typeof fetch,
      windowImpl: window,
    });

    expect(window.dispatchEvent).toHaveBeenCalledTimes(1);
  });

  it('does NOT dispatch on 401 INVALID_PIN (login flow)', async () => {
    const window = makeWindow();
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ success: false, code: 'INVALID_PIN', error: 'PIN inválido' }, 401)
    );

    await apiFetch('/api/auth/login', {
      method: 'POST',
      body: { pin: '9999' },
      fetchImpl: fetchMock as unknown as typeof fetch,
      windowImpl: window,
    });

    expect(window.dispatchEvent).not.toHaveBeenCalled();
  });

  it('does NOT dispatch on a successful response', async () => {
    const window = makeWindow();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ success: true, tables: [] }));

    await apiFetch('/api/tables', {
      fetchImpl: fetchMock as unknown as typeof fetch,
      windowImpl: window,
    });

    expect(window.dispatchEvent).not.toHaveBeenCalled();
  });

  it('does NOT dispatch on a non-401 error (e.g. 500)', async () => {
    const window = makeWindow();
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ success: false, code: 'SERVER_ERROR', error: 'boom' }, 500)
    );

    await apiFetch('/api/tables', {
      fetchImpl: fetchMock as unknown as typeof fetch,
      windowImpl: window,
    });

    expect(window.dispatchEvent).not.toHaveBeenCalled();
  });

  it('does NOT throw when no window is available (node/SSR)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ success: false, code: 'INVALID_TOKEN', error: 'x' }, 401)
    );

    // windowImpl null → nothing to dispatch to, must not throw
    const result = await apiFetch('/api/tables', {
      fetchImpl: fetchMock as unknown as typeof fetch,
      windowImpl: null,
    });

    expect(result.ok).toBe(false);
  });
});
