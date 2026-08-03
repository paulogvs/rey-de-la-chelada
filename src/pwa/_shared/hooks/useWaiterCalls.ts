/**
 * useWaiterCalls — API-driven waiter calls hook (meseros board)
 *
 * Fetches GET /api/waiter-calls, polls every `pollMs`, and exposes
 * accept/complete/cancel actions that refresh the list.
 */

import { useState, useEffect, useCallback } from 'react';
import {
  fetchWaiterCalls,
  acceptCall,
  completeCall,
  cancelCall,
  type WaiterCall,
} from '../api/waiterCallsApi';

export interface UseWaiterCallsOptions {
  token: string | null;
  pollMs?: number;
  enabled?: boolean;
}

export interface UseWaiterCallsResult {
  calls: WaiterCall[];
  pendingCount: number;
  loading: boolean;
  error: string | null;
  refresh: () => void;
  accept: (callId: string) => Promise<{ ok: boolean; code: string | null }>;
  complete: (callId: string) => Promise<{ ok: boolean; code: string | null }>;
  cancel: (callId: string) => Promise<{ ok: boolean; code: string | null }>;
}

export function useWaiterCalls({
  token,
  pollMs = 10000,
  enabled = true,
}: UseWaiterCallsOptions): UseWaiterCallsResult {
  const [calls, setCalls] = useState<WaiterCall[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);

  const refresh = useCallback(() => setRefreshTick(t => t + 1), []);

  useEffect(() => {
    if (!enabled || !token) return;

    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const load = async () => {
      try {
        const result = await fetchWaiterCalls(token);
        if (disposed) return;
        if (result.ok) {
          setCalls(result.calls);
          setError(null);
        } else {
          setError(result.error);
        }
      } catch (err) {
        if (!disposed) {
          console.error('[useWaiterCalls] fetch error:', err);
          setError('Error al cargar llamadas');
        }
      } finally {
        if (!disposed) setLoading(false);
      }
    };

    load();

    if (pollMs > 0) {
      timer = setInterval(load, pollMs);
    }

    return () => {
      disposed = true;
      if (timer) clearInterval(timer);
    };
  }, [token, enabled, pollMs, refreshTick]);

  const accept = useCallback(
    async (callId: string) => {
      if (!token) return { ok: false, code: 'AUTH_REQUIRED' };
      const result = await acceptCall(token, callId);
      if (result.ok) refresh();
      return { ok: result.ok, code: result.code };
    },
    [token, refresh]
  );

  const complete = useCallback(
    async (callId: string) => {
      if (!token) return { ok: false, code: 'AUTH_REQUIRED' };
      const result = await completeCall(token, callId);
      if (result.ok) refresh();
      return { ok: result.ok, code: result.code };
    },
    [token, refresh]
  );

  const cancel = useCallback(
    async (callId: string) => {
      const result = await cancelCall(callId);
      if (result.ok) refresh();
      return { ok: result.ok, code: result.code };
    },
    [refresh]
  );

  const pendingCount = calls.filter(c => c.status === 'pending').length;

  return { calls, pendingCount, loading, error, refresh, accept, complete, cancel };
}

export default useWaiterCalls;
