/**
 * useOnlineStatus — Online/Offline Detection Hook
 *
 * Rastrea navigator.onLine + eventos window online/offline.
 *
 * Uso:
 *   const { isOnline, lastChangedAt } = useOnlineStatus();
 *   if (!isOnline) return <OfflineBanner since={lastChangedAt} />;
 *
 * También exporta helpers no-React para el SyncEngine:
 *   subscribeOnlineStatus(cb)  → escuchar cambios globalmente
 *
 * Artículo I: SSOT — Único módulo de detección de conectividad.
 */

import { useState, useEffect } from 'react';

// ============================================================
// Helpers (no-React, testables)
// ============================================================

/** Estado de conexión actual (SSOT) */
export function isBrowserOnline(): boolean {
  return typeof navigator !== 'undefined' ? navigator.onLine : true;
}

/** Alias descriptivo usado por engines */
export function getOnlineStatus(): boolean {
  return isBrowserOnline();
}

/** Cambios de conectividad (online/offline). Devuelve unsubscribe. */
export function subscribeOnlineStatus(
  onChange: (isOnline: boolean) => void,
): () => void {
  if (typeof window === 'undefined') {
    return () => {};
  }
  const handle = () => onChange(isBrowserOnline());
  window.addEventListener('online', handle);
  window.addEventListener('offline', handle);
  return () => {
    window.removeEventListener('online', handle);
    window.removeEventListener('offline', handle);
  };
}

// ============================================================
// Hook React
// ============================================================

export interface OnlineStatus {
  isOnline: boolean;
  /** Epoch ms del último cambio de conectividad (null si nunca cambió) */
  lastChangedAt: number | null;
}

export function useOnlineStatus(): OnlineStatus {
  const [isOnline, setIsOnline] = useState<boolean>(isBrowserOnline);
  const [lastChangedAt, setLastChangedAt] = useState<number | null>(null);

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      setLastChangedAt(Date.now());
    };
    const handleOffline = () => {
      setIsOnline(false);
      setLastChangedAt(Date.now());
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return { isOnline, lastChangedAt };
}

export default useOnlineStatus;
