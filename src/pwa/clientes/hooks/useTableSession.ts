/**
 * PWA CLIENTES — Hook de sesión de mesa
 *
 * "El pedido activo es el permiso"
 *
 * - El QR escaneado nos da: ?mesa=N&sid=SESSION_ID
 * - Mientras la mesa tenga un pedido ACTIVO, funciones interactivas disponibles
 * - Sin pedido activo → solo lectura del menú
 * - El token expira en 3h (configurable) pero se renueva con pedido activo
 * - Persistencia en localStorage
 * - Call waiter con debounce anti-spam
 * - Retry logic para errores de conexión
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { orderEngine } from '@/core/engine';
import type { Order } from '@/core/types';
import { validateClientSession, getOrCreateSession } from './sessionApi';

const SESSION_STORAGE_KEY = 'rdlc-table-session';

export interface TableSession {
  tableNumber: number;
  sessionId: string;
  hasActiveOrder: boolean;
  activeOrder: Order | null;
  isReadOnly: boolean;
  canCallWaiter: boolean;
  canRequestBill: boolean;
  isValid: boolean;
  error?: string;
  /** Retry loading session */
  retry: () => void;
  /** Call waiter function */
  callWaiter: () => Promise<void>;
  /** Request bill function */
  requestBill: () => Promise<void>;
}

interface PersistedSession {
  tableNumber: number;
  sessionId: string;
  lastValidated: string;
}

/** Parsea la URL actual para extraer mesa y session ID */
function getSessionFromUrl(): { tableNumber: number | null; sessionId: string | null } {
  const params = new URLSearchParams(window.location.search);
  const mesa = params.get('mesa');
  const sid = params.get('sid');
  return {
    tableNumber: mesa ? parseInt(mesa, 10) : null,
    sessionId: sid || null,
  };
}

/** Persist session to localStorage */
function persistSession(tableNumber: number, sessionId: string): void {
  try {
    const data: PersistedSession = {
      tableNumber,
      sessionId,
      lastValidated: new Date().toISOString(),
    };
    localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(data));
  } catch {
    // localStorage not available
  }
}

/** Clear persisted session */
function clearPersistedSession(): void {
  try {
    localStorage.removeItem(SESSION_STORAGE_KEY);
  } catch {
    // ignore
  }
}

/** Get persisted session */
function getPersistedSession(): PersistedSession | null {
  try {
    const raw = localStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as PersistedSession;
  } catch {
    return null;
  }
}

export function useTableSession(): TableSession {
  const [session, setSession] = useState<TableSession>({
    tableNumber: 0,
    sessionId: '',
    hasActiveOrder: false,
    activeOrder: null,
    isReadOnly: true,
    canCallWaiter: false,
    canRequestBill: false,
    isValid: false,
    error: undefined,
    retry: () => {},
    callWaiter: async () => {},
    requestBill: async () => {},
  });

  const callWaiterDebounceRef = useRef<number>(0);
  const retryCountRef = useRef(0);
  const MAX_RETRIES = 3;

  // Evaluate session state
  const evaluateSession = useCallback(async () => {
    const { tableNumber, sessionId } = getSessionFromUrl();

    // QR ESTÁTICO (Opción A): la URL trae SOLO `?mesa=N`, sin sid.
    // Se crea/obtiene la sesión LAZY en el servidor y se persiste en
    // localStorage para próximas validaciones. Casos legacy (con sid)
    // siguen funcionando sin cambios.
    let resolvedSessionId = sessionId;
    let fromLazy = false;

    if (tableNumber && !resolvedSessionId) {
      const lazy = await getOrCreateSession(tableNumber);
      if (lazy.success && lazy.sessionId) {
        resolvedSessionId = lazy.sessionId;
        fromLazy = true;
      }
    }

    if (!tableNumber || !resolvedSessionId) {
      // Try persisted session
      const persisted = getPersistedSession();
      if (persisted) {
        setSession(prev => ({
          ...prev,
          tableNumber: persisted.tableNumber,
          sessionId: persisted.sessionId,
          isValid: false,
          error: 'Sesión expirada. Escanea de nuevo el QR de la mesa.',
        }));
        return;
      }
      setSession(prev => ({
        ...prev,
        isValid: false,
        error: 'QR no válido o expirado. Pide el código QR de tu mesa al mesero.',
      }));
      return;
    }

    // Persist for future visits (creada lazy o ya existente)
    persistSession(tableNumber, resolvedSessionId);

    try {
      // Validar sesión contra el SERVIDOR (fix: antes era local y fallaba)
      const validation = await validateClientSession(resolvedSessionId, tableNumber);

      // Buscar pedido activo en esta mesa (motor local para UI)
      const tableOrders = orderEngine.getTableOrders(`table-${tableNumber}`);
      const activeOrder = tableOrders.find(o =>
        ['draft', 'confirmed', 'preparing', 'ready', 'served'].includes(o.status)
      ) || null;

      const hasActiveOrder = activeOrder !== null || !!validation.hasActiveOrder;
      const freshSessionId = validation.sessionId || resolvedSessionId;

      setSession({
        tableNumber,
        sessionId: freshSessionId,
        hasActiveOrder,
        activeOrder,
        isReadOnly: !hasActiveOrder || validation.reason === 'readonly',
        canCallWaiter: hasActiveOrder && validation.valid,
        canRequestBill: hasActiveOrder && validation.valid,
        isValid: validation.valid,
        error: validation.valid ? undefined : validation.reason,
        retry: evaluateSession,
        callWaiter: async () => { /* debounced below */ },
        requestBill: async () => { /* debounced below */ },
      });

      // Si el servidor renovó el sid (sesión expirada + pedido activo) o se
      // creó lazy, persistirlo
      if (freshSessionId !== sessionId || fromLazy) {
        persistSession(tableNumber, freshSessionId);
      }

      // Reset retry count on success
      retryCountRef.current = 0;
    } catch (err) {
      console.error('[useTableSession] Error evaluating session:', err);

      // Retry logic
      if (retryCountRef.current < MAX_RETRIES) {
        retryCountRef.current++;
        setTimeout(() => void evaluateSession(), 1000 * Math.pow(2, retryCountRef.current));
      }

      setSession(prev => ({
        ...prev,
        tableNumber,
        sessionId: resolvedSessionId,
        isValid: false,
        error: 'Error al validar la sesión. Reintentando...',
        retry: evaluateSession,
        callWaiter: async () => {},
        requestBill: async () => {},
      }));
    }
  }, []);

  // Initialize
  useEffect(() => {
    evaluateSession();

    // Suscribirse a cambios en órdenes
    const unsubscribe = orderEngine.onChange(evaluateSession);

    // Re-evaluar cada 30 segundos (renovación de token)
    const interval = setInterval(evaluateSession, 30000);

    return () => {
      unsubscribe();
      clearInterval(interval);
    };
  }, [evaluateSession]);

  // Call waiter con debounce (prevent spam)
  const callWaiter = useCallback(async (): Promise<void> => {
    const now = Date.now();
    if (now - callWaiterDebounceRef.current < 10000) {
      throw new Error('Ya notificaste al mesero. Espera unos segundos.');
    }
    callWaiterDebounceRef.current = now;

    return new Promise((resolve, reject) => {
      try {
        console.log(`[Clientes] Mesa ${session.tableNumber} llama al mesero`);
        // Aquí se integrará con WebSocket
        // ws.send({ type: 'call_waiter', table: session.tableNumber, orderId: session.activeOrder?.id });
        
        // Simulate async network call
        setTimeout(() => {
          resolve();
        }, 500);
      } catch (err) {
        reject(err);
      }
    });
  }, [session.tableNumber, session.activeOrder?.id]);

  // Request bill
  const requestBill = useCallback(async (): Promise<void> => {
    return new Promise((resolve, reject) => {
      try {
        console.log(`[Clientes] Mesa ${session.tableNumber} solicita la cuenta`);
        // Aquí se integrará con WebSocket
        // ws.send({ type: 'request_bill', table: session.tableNumber, orderId: session.activeOrder?.id });
        
        setTimeout(() => {
          resolve();
        }, 500);
      } catch (err) {
        reject(err);
      }
    });
  }, [session.tableNumber, session.activeOrder?.id]);

  return {
    ...session,
    callWaiter,
    requestBill,
  };
}
