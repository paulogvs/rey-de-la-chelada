/**
 * useReadyTables — "🍴 Listo para servir" tracker (meseros PWA, S2-A)
 *
 * Consumes WS events from the shared useKDSWebSocket and keeps a live
 * Set of table numbers whose order is fully ready to serve. The badge
 * disappears when:
 *   - the order goes paid/served/cancelled (status_change event)
 *   - the waiter opens the table (clearTable)
 *   - TTL expires (READY_TTL_MS = 10 min)
 *
 * The server is the SSOT: it emits `order_complete` to meseros only
 * when the last non-cancelled item becomes 'ready'. See
 * server/services/order-broadcaster.js + PATCH /api/orders/:id/items/:id/status.
 */

import { useState, useCallback, useMemo, useEffect } from 'react';
import { nextReadyTables, READY_TTL_MS } from './readyTables';

export interface UseReadyTablesResult {
  /** Table numbers with a pending "Listo" badge */
  readyTableNumbers: ReadonlySet<number>;
  /** Feed every WS event here (from useKDSWebSocket onEvent) */
  handleEvent: (event: { type: string; tableNumber?: number; status?: string }) => void;
  /** Remove the badge for a table (e.g. when the waiter opens it) */
  clearTable: (tableNumber: number) => void;
}

export function useReadyTables(): UseReadyTablesResult {
  const [readyMap, setReadyMap] = useState<ReadonlyMap<number, number>>(new Map());

  const handleEvent = useCallback((event: { type: string; tableNumber?: number; status?: string }) => {
    setReadyMap(prev => nextReadyTables(prev, event));
  }, []);

  const clearTable = useCallback((tableNumber: number) => {
    setReadyMap(prev => {
      if (!prev.has(tableNumber)) return prev;
      const next = new Map(prev);
      next.delete(tableNumber);
      return next;
    });
  }, []);

  // Prune expired entries every minute (TTL 10 min)
  useEffect(() => {
    const timer = setInterval(() => {
      setReadyMap(prev => nextReadyTables(prev, { type: 'prune' }, Date.now(), READY_TTL_MS));
    }, 60 * 1000);
    return () => clearInterval(timer);
  }, []);

  const readyTableNumbers = useMemo(() => new Set(readyMap.keys()), [readyMap]);

  return { readyTableNumbers, handleEvent, clearTable };
}

export default useReadyTables;
