/**
 * Staff API Layer — apiFetch + auth (pure, injectable fetch)
 *
 * TDD: tests written before implementation. These functions are
 * framework-free so they run in node (vitest environment: node).
 */

import { describe, it, expect, vi } from 'vitest';
import {
  apiFetch,
  loginWithPin,
  logout,
  type ApiResult,
} from '../../src/pwa/_shared/api/apiFetch';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('apiFetch', () => {
  it('performs a GET with token in Authorization header', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ success: true, tables: [] }));
    const result = await apiFetch<{ tables: unknown[] }>('/api/tables', {
      token: 'tok-1',
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    expect(result.ok).toBe(true);
    expect(result.data).toEqual({ success: true, tables: [] });
    expect(fetchMock).toHaveBeenCalledWith('/api/tables', expect.objectContaining({
      method: 'GET',
      headers: expect.objectContaining({
        Authorization: 'Bearer tok-1',
        'Content-Type': 'application/json',
      }),
    }));
  });

  it('posts JSON body with proper headers', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ success: true }, 201));
    const body = { pin: '1111' };
    await apiFetch('/api/auth/login', { method: 'POST', body, fetchImpl: fetchMock as unknown as typeof fetch });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual(body);
  });

  it('returns ok=false with code for non-2xx responses', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ success: false, code: 'INVALID_PIN', error: 'PIN inválido' }, 401)
    );
    const result = await apiFetch('/api/auth/login', {
      method: 'POST',
      body: { pin: '9999' },
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('INVALID_PIN');
    expect(result.error).toBe('PIN inválido');
    expect(result.status).toBe(401);
  });

  it('returns network error result when fetch throws', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('network down'));
    const result = await apiFetch('/api/tables', { fetchImpl: fetchMock as unknown as typeof fetch });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('NETWORK_ERROR');
  });
});

describe('loginWithPin', () => {
  it('returns token + user on success', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      success: true,
      token: 'jwt-1',
      refreshToken: 'ref-1',
      user: { id: 'u1', role: 'mesero', displayName: 'Mesero' },
    }));
    const result = await loginWithPin('1111', fetchMock as unknown as typeof fetch);
    expect(result.ok).toBe(true);
    expect(result.token).toBe('jwt-1');
    expect(result.user).toMatchObject({ id: 'u1', role: 'mesero', displayName: 'Mesero' });
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/login', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ pin: '1111' }),
    }));
  });

  it('returns error result on invalid pin', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ success: false, code: 'INVALID_PIN', error: 'PIN inválido' }, 401)
    );
    const result = await loginWithPin('0000', fetchMock as unknown as typeof fetch);
    expect(result.ok).toBe(false);
    expect(result.code).toBe('INVALID_PIN');
    expect(result.token).toBeNull();
    expect(result.user).toBeNull();
  });
});

describe('logout', () => {
  it('calls the logout endpoint with token', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ success: true }));
    const result: ApiResult<null> = await logout('tok-1', fetchMock as unknown as typeof fetch);
    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/logout', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({ Authorization: 'Bearer tok-1' }),
    }));
  });
});
