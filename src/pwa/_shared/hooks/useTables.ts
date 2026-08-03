/**
 * useTables — API-driven tables hook (meseros/caja/admin)
 *
 * Fetches tables from GET /api/tables, auto-refreshes:
 *   - every `pollMs` (default 15s)
 *   - when `refreshTick` changes (caller can bump it after actions)
 *   - on WS events (new_order / status_change / order_complete)
 *
 * Replaces the in-memory tableEngine for staff PWAs (SSOT = server).
 */

import { useState, useEffect, useCallback } from 'react';
import { fetchTables, type Table } from '../api/tablesApi';
import type { KDSIncomingEvent } from '@/core/types';

export interface UseTablesOptions {
  token: string | null;
  pollMs?: number;
  enabled?: boolean;
  /** Called after each successful refresh (e.g. to bump local order state) */
  onRefresh?: (tables: Table[]) => void;
}

export interface UseTablesResult {
  tables: Table[];
  loading: boolean;
  error: string | null;
  /** Bump to force an immediate refresh */
  refresh: () => void;
  /** Bump after mutations (order created/paid) to trigger refresh */
  refreshTick: number;
  /** Feed WS events here to trigger a refresh */
  wsEvent: (event: KDSIncomingEvent) => void;
}

export function useTables({
  token,
  pollMs = 15000,
  enabled = true,
  onRefresh,
}: UseTablesOptions): UseTablesResult {
  const [tables, setTables] = useState<Table[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);
  const [wsTick, setWsTick] = useState(0);

  const refresh = useCallback(() => setRefreshTick(t => t + 1), []);

  // Fetch on mount / token / refreshTick / wsTick
  useEffect(() => {
    if (!enabled || !token) return;

    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const load = async () => {
      try {
        const result = await fetchTables(token);
        if (disposed) return;
        if (result.ok) {
          setTables(result.tables);
          setError(null);
          onRefresh?.(result.tables);
        } else {
          setError(result.error);
        }
      } catch (err) {
        if (!disposed) {
          console.error('[useTables] fetch error:', err);
          setError('Error al cargar mesas');
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
  }, [token, enabled, pollMs, refreshTick, wsTick, onRefresh]);

  // WS-driven refresh: KDS events affect table status (ordered/serving/paid)
  const applyWsEvent = useCallback((event: KDSIncomingEvent) => {
    if (!event || !event.type) return;
    // Any order event can change table status → trigger a fetch
    setWsTick(t => t + 1);
  }, []);

  return { tables, loading, error, refresh, refreshTick, wsEvent: applyWsEvent };
}

export default useTables;
