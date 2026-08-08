/**
 * Staff API — shared fetch layer for staff PWAs (meseros, caja, admin).
 *
 * Pure, injectable fetch functions so they can be unit-tested in node.
 * Token is passed explicitly (never hardcoded, never global) — the
 * caller (useAuth / storage helper) is responsible for persistence.
 *
 * Convention: every function returns a normalized result object:
 *   { ok: boolean, status: number, code: string | null,
 *     error: string | null, data: T | null }
 */

export interface ApiResult<T> {
  ok: boolean;
  status: number;
  code: string | null;
  error: string | null;
  data: T | null;
}

export interface ApiOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  token?: string | null;
  body?: unknown;
  fetchImpl?: typeof fetch;
}

const JSON_HEADERS = { 'Content-Type': 'application/json', Accept: 'application/json' };

/**
 * Core fetch wrapper: adds auth header, parses JSON, normalizes errors.
 * Never throws — returns ApiResult with code on failure.
 */
export async function apiFetch<T>(
  path: string,
  { method = 'GET', token = null, body, fetchImpl = fetch }: ApiOptions = {}
): Promise<ApiResult<T>> {
  const headers: Record<string, string> = { ...JSON_HEADERS };
  if (token) headers.Authorization = `Bearer ${token}`;

  try {
    const res = await fetchImpl(path, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    let json: unknown = null;
    try {
      json = await res.json();
    } catch {
      // Non-JSON response — keep null and let the status decide
    }

    const payload = (json as Record<string, unknown>) || {};
    const success = payload.success === true;

    if (res.ok && success) {
      return {
        ok: true,
        status: res.status,
        code: null,
        error: null,
        data: (json as T) ?? null,
      };
    }

    return {
      ok: false,
      status: res.status,
      code: (payload.code as string) || 'REQUEST_FAILED',
      error: (payload.error as string) || `HTTP ${res.status}`,
      data: null,
    };
  } catch (err) {
    console.error('[apiFetch] Network error:', err instanceof Error ? err.message : err);
    return {
      ok: false,
      status: 0,
      code: 'NETWORK_ERROR',
      error: 'No se pudo conectar con el servidor',
      data: null,
    };
  }
}

export interface StaffUser {
  id: string;
  role: 'admin' | 'mesero' | 'kds' | 'caja';
  displayName: string;
}

export interface LoginResult {
  ok: boolean;
  code: string | null;
  token: string | null;
  user: StaffUser | null;
}

/**
 * Login with PIN (POST /api/auth/login).
 * Returns token + user on success; code on failure (INVALID_PIN, PIN_REQUIRED...).
 */
export async function loginWithPin(
  pin: string,
  fetchImpl: typeof fetch = fetch
): Promise<LoginResult> {
  const result = await apiFetch<{
    success: boolean;
    token?: string;
    user?: StaffUser;
    code?: string;
    error?: string;
  }>('/api/auth/login', {
    method: 'POST',
    body: { pin },
    fetchImpl,
  });

  if (!result.ok || !result.data) {
    return { ok: false, code: result.code, token: null, user: null };
  }

  return {
    ok: true,
    code: null,
    token: result.data.token ?? null,
    user: result.data.user ?? null,
  };
}

/**
 * Logout (POST /api/auth/logout). Best-effort — clears the server-side
 * session if any; the client must clear its stored token regardless.
 */
export async function logout(
  token: string,
  fetchImpl: typeof fetch = fetch
): Promise<ApiResult<null>> {
  return apiFetch<null>('/api/auth/logout', { method: 'POST', token, fetchImpl });
}

/**
 * Get current user (GET /api/auth/me).
 */
export async function fetchMe(
  token: string,
  fetchImpl: typeof fetch = fetch
): Promise<ApiResult<{ user: StaffUser }>> {
  return apiFetch<{ user: StaffUser }>('/api/auth/me', { token, fetchImpl });
}

// ============================================================
// Token storage — scoped per PWA module to avoid cross-app bleed
// ============================================================

const TOKEN_KEY_PREFIX = 'rdlc-token:';

export function getStoredToken(moduleId: string, storage: Storage | null = null): string | null {
  const s = storage ?? (typeof localStorage !== 'undefined' ? localStorage : null);
  if (!s) return null;
  return s.getItem(`${TOKEN_KEY_PREFIX}${moduleId}`);
}

export function setStoredToken(
  moduleId: string,
  token: string,
  storage: Storage | null = null
): void {
  const s = storage ?? (typeof localStorage !== 'undefined' ? localStorage : null);
  if (!s) return;
  s.setItem(`${TOKEN_KEY_PREFIX}${moduleId}`, token);
}

export function clearStoredToken(moduleId: string, storage: Storage | null = null): void {
  const s = storage ?? (typeof localStorage !== 'undefined' ? localStorage : null);
  if (!s) return;
  s.removeItem(`${TOKEN_KEY_PREFIX}${moduleId}`);
}

export { TOKEN_KEY_PREFIX };
