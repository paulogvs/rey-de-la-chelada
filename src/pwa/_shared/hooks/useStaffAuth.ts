/**
 * useStaffAuth — Auth hook for staff PWAs (meseros, caja, admin)
 *
 * PIN login → JWT token persisted per-module (localStorage).
 * Token is loaded at mount; login()/logout() update state + storage.
 *
 * Zero hardcoded: storage keys use TOKEN_KEY_PREFIX from apiFetch.
 */

import { useState, useCallback, useEffect } from 'react';
import {
  loginWithPin,
  logout as apiLogout,
  getStoredToken,
  setStoredToken,
  clearStoredToken,
  type StaffUser,
} from '../api/apiFetch';

export interface StaffAuthState {
  /** Is a token loaded (persisted or just logged in)? */
  isAuthenticated: boolean;
  /** Current staff user (null before login) */
  user: StaffUser | null;
  /** Stored JWT token */
  token: string | null;
  /** True while restoring from localStorage */
  restoring: boolean;
  /** Login with PIN; returns error code on failure (INVALID_PIN...) */
  login: (pin: string) => Promise<{ ok: boolean; code: string | null }>;
  /** Clear token + state */
  logout: () => Promise<void>;
}

export function useStaffAuth(moduleId: string): StaffAuthState {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<StaffUser | null>(null);
  const [restoring, setRestoring] = useState(true);

  // Restore token on mount (persistent staff sessions)
  useEffect(() => {
    const stored = getStoredToken(moduleId);
    if (stored) {
      setToken(stored);
    }
    setRestoring(false);
  }, [moduleId]);

  const login = useCallback(
    async (pin: string): Promise<{ ok: boolean; code: string | null }> => {
      const result = await loginWithPin(pin);
      if (!result.ok || !result.token) {
        return { ok: false, code: result.code };
      }
      setStoredToken(moduleId, result.token);
      setToken(result.token);
      setUser(result.user);
      return { ok: true, code: null };
    },
    [moduleId]
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
  }, [moduleId, token]);

  return {
    isAuthenticated: token !== null,
    user,
    token,
    restoring,
    login,
    logout,
  };
}

export default useStaffAuth;
