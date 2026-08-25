/**
 * useClientOrder — hook for the full public order lifecycle in the clientes PWA.
 *
 * "El pedido activo es el permiso":
 *   idle      → customer browsing (can create a draft order)
 *   sending   → draft is being POSTed
 *   tracking  → order created; poll GET /api/client-orders/:id
 *   paid      → order paid; show thanks screen
 *
 * Persists orderId in localStorage so a refresh keeps tracking the same
 * order ("el pedido activo" survives page reloads).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  createClientOrder,
  getClientOrderStatus,
} from '../../_shared/api/clientOrdersApi';
import type { CreateClientOrderInput } from '../../_shared/api/clientOrdersApi';

export type ClientOrderPhase = 'idle' | 'sending' | 'tracking' | 'paid';

export const ORDER_STORAGE_KEY = 'rdlc-active-order';

export interface TrackedOrder {
  orderId: string;
  status: string;
  tableNumber: number;
  total: number;
}

// F1: 10s en vez de 5s — el tracking solo actualiza una línea de estado;
  // reduce a la mitad el polling de clientes (2-3 req/min → 1 req/min/www)
const POLL_INTERVAL_MS = 10000;
const POLL_MAX_RETRIES = 3;

/** Map raw order status → friendly UI phase label (Spanish). */
export function statusLabel(status: string): string {
  const map: Record<string, string> = {
    called: 'El mesero se acerca…',
    confirmed: 'Pedido confirmado',
    preparing: 'En preparación',
    ready: '¡Tu pedido está listo!',
    served: '¡Disfruta tu pedido!',
    paid: 'Pago recibido',
    cancelled: 'Pedido cancelado',
  };
  return map[status] ?? 'Procesando pedido…';
}

export function isTerminalStatus(status: string): boolean {
  return status === 'paid' || status === 'cancelled';
}

/** Read persisted active order (if any). Storage injectable for tests. */
export function readPersistedOrder(storage: Storage | null = null): TrackedOrder | null {
  try {
    const s = storage ?? (typeof localStorage !== 'undefined' ? localStorage : null);
    if (!s) return null;
    const raw = s.getItem(ORDER_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as TrackedOrder;
    if (!parsed.orderId) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function useClientOrder() {
  const [phase, setPhase] = useState<ClientOrderPhase>(() =>
    readPersistedOrder() ? 'tracking' : 'idle'
  );
  const [order, setOrder] = useState<TrackedOrder | null>(() => readPersistedOrder());
  const [error, setError] = useState<string | null>(null);
  const [polling, setPolling] = useState(false);
  const pollRef = useRef<number | null>(null);
  const retriesRef = useRef(0);
  // Stable mirror of `order` so the poll interval always sees the latest
  // orderId without re-creating the interval callback.
  const orderRef = useRef<TrackedOrder | null>(readPersistedOrder());

  // Keep orderRef in sync whenever `order` changes.
  useEffect(() => {
    orderRef.current = order;
  }, [order]);

  // Persist whenever the active order changes.
  useEffect(() => {
    try {
      if (order) localStorage.setItem(ORDER_STORAGE_KEY, JSON.stringify(order));
      else localStorage.removeItem(ORDER_STORAGE_KEY);
    } catch {
      // storage unavailable — tracking still works in-memory
    }
  }, [order]);

  // Poll loop while tracking.
  const stopPolling = useCallback(() => {
    if (pollRef.current !== null) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
    setPolling(false);
  }, []);

  const pollOnce = useCallback(async () => {
    if (!orderRef.current) return;
    const result = await getClientOrderStatus(orderRef.current.orderId);
    if (!result.ok || !result.data) {
      retriesRef.current += 1;
      if (retriesRef.current >= POLL_MAX_RETRIES) {
        stopPolling();
        setError('No se pudo actualizar el pedido. Reintenta más tarde.');
      }
      return;
    }
    retriesRef.current = 0;
    const status = result.data.status;
    const total = result.data.total;
    // Updater puro (fix react-doctor no-impure-state-updater): NO se toca
    // orderRef aquí. orderRef se sincroniza automáticamente vía el effect
    // que observa `order` (más arriba), manteniéndolo estable sin side
    // effects dentro del updater (evita doble-ejecución en StrictMode).
    setOrder(prev => (prev ? { ...prev, status, total } : prev));
    if (isTerminalStatus(status)) {
      stopPolling();
      if (status === 'paid') setPhase('paid');
    }
  }, [stopPolling]);

  useEffect(() => {
    if (phase !== 'tracking') return;
    // Immediate poll + interval
    pollOnce();
    pollRef.current = window.setInterval(pollOnce, POLL_INTERVAL_MS);
    setPolling(true);
    return () => {
      if (pollRef.current !== null) window.clearInterval(pollRef.current);
    };
  }, [phase, pollOnce]);

  /** Create the public order from a draft. */
  const submitOrder = useCallback(
    async (input: CreateClientOrderInput): Promise<{ ok: boolean; error?: string }> => {
      setError(null);
      setPhase('sending');
      const result = await createClientOrder(input);
      if (!result.ok || !result.data) {
        setPhase('idle');
        setError(result.error ?? 'No se pudo enviar el pedido');
        return { ok: false, error: result.error ?? 'No se pudo enviar el pedido' };
      }
      setOrder({
        orderId: result.data.orderId,
        status: result.data.status,
        tableNumber: input.table_number,
        total: result.data.total,
      });
      setPhase('tracking');
      return { ok: true };
    },
    []
  );

  /** Reset everything (after paid / cancelled / manual reset). */
  const resetOrder = useCallback(() => {
    stopPolling();
    setOrder(null);
    setError(null);
    setPhase('idle');
  }, [stopPolling]);

  // Stop polling on unmount.
  useEffect(() => stopPolling, [stopPolling]);

  return {
    phase,
    order,
    error,
    polling,
    submitOrder,
    resetOrder,
  };
}
