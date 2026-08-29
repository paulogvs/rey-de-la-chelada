/**
 * useOfflineSync — Cablea el SyncEngine a la UI de meseros (v14 2026-08-28).
 *
 * Antes el SyncEngine existía pero NADIE lo instanciaba → no había offline
 * real. Este hook lo instancia y expone a la UI:
 *   - isOnline      → estado de conexión (subscribeOnlineStatus)
 *   - pendingCount  → nº de pedidos/pagos encolados (pendientes de envío)
 *   - enqueueOrder  → encola un pedido offline (create_order) cuando NO hay red
 *   - syncNow       → fuerza pull + flush (al reconectar)
 *
 * El flujo ONLINE es idéntico (los POST van directo a /api/orders). El offline
 * es ADITIVO: solo cuando `!isOnline` se encola. Al volver la red, el hook
 * hace flush y la cola se vacía.
 *
 * Reintento automático: SyncEngine.scheduleRetry con backoff exponencial.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { SyncEngine } from '@/core/engine/SyncEngine';
import { isBrowserOnline, subscribeOnlineStatus } from '@/pwa/_shared/hooks/useOnlineStatus';

/**
 * Decisión pura: ¿esta acción debe ENCOLARSE (offline) o ir directo (online)?
 * Testeable sin React/IndexedDB.
 * @returns true → encolar en la cola offline.
 */
export function shouldQueueOffline(isOnline: boolean, hasQueue: boolean): boolean {
  // Si NO hay conexión Y existe un mecanismo de cola → encolar.
  return isOnline === false && hasQueue;
}

interface UseOfflineSyncOptions {
  token: string | null;
  moduleId: string;
  enabled?: boolean;
}

export function useOfflineSync({ token: _token, moduleId, enabled = true }: UseOfflineSyncOptions) {
  const engineRef = useRef<SyncEngine | null>(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [syncing, setSyncing] = useState(false);

  // Instanciar el SyncEngine una sola vez (tokenProvider lee el JWT de storage)
  useEffect(() => {
    if (!enabled) return;
    if (!engineRef.current) {
      const engine = new SyncEngine({
        moduleId,
        // tokenProvider por defecto lee `rdlc-token:{moduleId}` de localStorage
      });
      engineRef.current = engine;
    }
    const engine = engineRef.current;

    // Refrescar el count al iniciar
    void engine.getPendingCount().then(setPendingCount).catch(() => {});

    // Escuchar eventos de la cola para mantener el badge al día
    const unsubscribe = engine.subscribe(event => {
      if (event.type === 'enqueued' || event.type === 'cleared') {
        void engine.getPendingCount().then(setPendingCount).catch(() => {});
      }
      if (event.type === 'queue-flushed') {
        void engine.getPendingCount().then(setPendingCount).catch(() => {});
      }
      if (event.type === 'pulled') {
        // desconexión curada → refrescar data (los pedidos de otras mesas)
      }
    });

    return () => {
      unsubscribe();
      // No detenemos el engine aquí (persistir entre montajes) — el
      // stop() se llama explícitamente en logout si es necesario.
    };
  }, [enabled, moduleId]);

  // Al cambiar la conexión (online) → flush automático
  useEffect(() => {
    if (!enabled) return;
    const unsub = subscribeOnlineStatus(isOnline => {
      if (isOnline && engineRef.current) {
        setSyncing(true);
        void engineRef.current.syncNow().finally(() => setSyncing(false));
      }
    });
    return unsub;
  }, [enabled]);

  const isOnline = (typeof navigator !== 'undefined' ? isBrowserOnline() : true);

  /** Encola un pedido offline (create_order). Devuelve el item encolado o null. */
  const enqueueOrder = useCallback(async (payload: Record<string, unknown>) => {
    if (!engineRef.current) return null;
    return engineRef.current.enqueue('create_order', payload);
  }, []);

  /** Fuerza pull + flush (reconectar manualmente). */
  const syncNow = useCallback(async () => {
    if (!engineRef.current) return;
    setSyncing(true);
    try {
      await engineRef.current.syncNow();
    } finally {
      setSyncing(false);
    }
  }, []);

  /** Vacía la cola (útil para logout). */
  const clearQueue = useCallback(async () => {
    if (!engineRef.current) return;
    await engineRef.current.clearQueue();
    setPendingCount(0);
  }, []);

  return { isOnline, pendingCount, syncing, enqueueOrder, syncNow, clearQueue };
}

export default useOfflineSync;