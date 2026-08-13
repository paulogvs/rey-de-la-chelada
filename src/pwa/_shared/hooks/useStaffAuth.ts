/**
 * useStaffAuth — Auth hook for staff PWAs (meseros, caja, admin, cocina, bar)
 *
 * PIN login → JWT token persisted per-module (localStorage).
 * Token is loaded at mount; login()/logout() update state + storage.
 *
 * FIX (2026-08-13): dead-token loop.
 *   1. On mount the restored token is VALIDATED (exp). If expired/malformed
 *      it is dropped and the user lands on login (sessionExpired notice).
 *   2. A global 'auth:expired' event (dispatched by apiFetch on any 401 with
 *      INVALID_TOKEN/AUTH_REQUIRED) clears the session → automatic logout.
 *   3. sessionExpired flag lets the LoginScreen show a gentle notice instead
 *      of a blank screen.
 *
 * Zero hardcoded: storage keys use TOKEN_KEY_PREFIX from apiFetch.
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import {
  loginWithPin,
  logout as apiLogout,
  getStoredToken,
  setStoredToken,
  clearStoredToken,
  type StaffUser,
} from '../api/apiFetch';
import { isTokenExpired, tokenToStaffUser } from '../utils/jwtToken';

export interface StaffAuthState {
  /** Is a token loaded (persisted or just logged in)? */
  isAuthenticated: boolean;
  /** Current staff user (null before login) */
  user: StaffUser | null;
  /** Stored JWT token */
  token: string | null;
  /** True while restoring from localStorage */
  restoring: boolean;
  /** True when the session was dropped due to expiry (NOT a manual logout). */
  sessionExpired: boolean;
  /** Login with PIN; returns error code on failure (INVALID_PIN...) */
  login: (pin: string) => Promise<{ ok: boolean; code: string | null }>;
  /** Clear token + state */
  logout: () => Promise<void>;
}

export function useStaffAuth(moduleId: string, allowedRoles?: string[]): StaffAuthState {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<StaffUser | null>(null);
  const [restoring, setRestoring] = useState(true);
  const [sessionExpired, setSessionExpired] = useState(false);

  // Latest token without re-subscribing the 401 listener on every change.
  const tokenRef = useRef<string | null>(null);
  useEffect(() => {
    tokenRef.current = token;
  }, [token]);

  // Restore token on mount (persistent staff sessions) — VALIDATE it so a
  // dead token never restores isAuthenticated=true (the 401-loop root cause).
  useEffect(() => {
    const stored = getStoredToken(moduleId);
    if (stored) {
      if (isTokenExpired(stored)) {
        // Dead token → drop it and land on login with a gentle notice.
        clearStoredToken(moduleId);
        setSessionExpired(true);
      } else {
        setToken(stored);
        // Also restore the user so the header shows the name after reload.
        const restoredUser = tokenToStaffUser(stored);
        if (restoredUser) setUser(restoredUser);
      }
    }
    setRestoring(false);
  }, [moduleId]);

  // Global reaction to a dead session: apiFetch dispatches 'auth:expired' on
  // any 401 with INVALID_TOKEN/AUTH_REQUIRED. Clear the token so the app
  // falls back to login. Guarded by tokenRef to avoid loops/redundant clears.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onExpired = () => {
      if (tokenRef.current === null) return;
      clearStoredToken(moduleId);
      setToken(null);
      setUser(null);
      setSessionExpired(true);
    };
    window.addEventListener('auth:expired', onExpired);
    return () => window.removeEventListener('auth:expired', onExpired);
  }, [moduleId]);

  const login = useCallback(
    async (pin: string): Promise<{ ok: boolean; code: string | null }> => {
      const result = await loginWithPin(pin);
      if (!result.ok || !result.token) {
        return { ok: false, code: result.code };
      }
      // FASE 4.5: reject login if role not allowed for this PWA
      if (allowedRoles && result.user && !allowedRoles.includes(result.user.role)) {
        return { ok: false, code: 'FORBIDDEN_ROLE' };
      }
      setStoredToken(moduleId, result.token);
      setToken(result.token);
      setUser(result.user);
      setSessionExpired(false);
      return { ok: true, code: null };
    },
    [moduleId, allowedRoles]
  );

  const logout = useCallback(async () => {
    if (token) {
      try {
        await apiLogout(token);
      } catch {
        // Best-effort — clear locally regardless
      }
    }
    clearStoredToken(moduleId);
    setToken(null);
    setUser(null);
    setSessionExpired(false); // manual logout is not an expiry
  }, [moduleId, token]);

  return {
    isAuthenticated: token !== null,
    user,
    token,
    restoring,
    sessionExpired,
    login,
    logout,
  };
}

export default useStaffAuth;
