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
  /** Inject window for tests; defaults to the global window (if any). */
  windowImpl?: AuthWindowLike | null;
}

/** Minimal window surface needed to dispatch the global auth-expiry event. */
export interface AuthWindowLike {
  dispatchEvent: (event: Event) => boolean;
}

const JSON_HEADERS = { 'Content-Type': 'application/json', Accept: 'application/json' };

/** Session-invalid codes from the server (NOT invalid-pin from the login flow). */
const AUTH_EXPIRED_CODES: ReadonlySet<string> = new Set(['INVALID_TOKEN', 'AUTH_REQUIRED']);

/**
 * True if this response means "your session is dead" and the app should
 * force a global logout. Only 401s with a session-invalid code qualify —
 * INVALID_PIN (bad PIN at login) and other codes do NOT.
 */
export function shouldDispatchAuthExpired(status: number, code: string | null): boolean {
  return status === 401 && code !== null && AUTH_EXPIRED_CODES.has(code);
}

/**
 * Core fetch wrapper: adds auth header, parses JSON, normalizes errors.
 * Never throws — returns ApiResult with code on failure.
 */
export async function apiFetch<T>(
  path: string,
  { method = 'GET', token = null, body, fetchImpl = fetch, windowImpl }: ApiOptions = {}
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

    const code = (payload.code as string) || 'REQUEST_FAILED';

    // Global reaction to a dead session: any 401 with a session-invalid code
    // (INVALID_TOKEN / AUTH_REQUIRED) notifies useStaffAuth to force logout.
    // INVALID_PIN (bad PIN at login) is intentionally excluded.
    if (shouldDispatchAuthExpired(res.status, code)) {
      const w = windowImpl !== undefined ? windowImpl : (typeof window !== 'undefined' ? window : null);
      if (w) {
        w.dispatchEvent(new CustomEvent('auth:expired'));
      }
    }

    return {
      ok: false,
      status: res.status,
      code,
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
