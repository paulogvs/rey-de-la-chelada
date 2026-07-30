/**
 * PWA CLIENTES — Hook de sesión de mesa
 *
 * "El pedido activo es el permiso"
 *
 * - El QR escaneado nos da: ?mesa=N&sid=SESSION_ID
 * - Mientras la mesa tenga un pedido ACTIVO, funciones interactivas disponibles
 * - Sin pedido activo → solo lectura del menú
 * - El token expira en 3h (configurable) pero se renueva con pedido activo
 */

import { useState, useEffect, useCallback } from 'react';
import { securityEngine } from '@/core/config';
import { orderEngine } from '@/core/engine';
import type { Order } from '@/core/types';

export interface TableSession {
  tableNumber: number;
  sessionId: string;
  hasActiveOrder: boolean;
  activeOrder: Order | null;
  isReadOnly: boolean;   // true = solo menú, sin funciones interactivas
  canCallWaiter: boolean;
  canRequestBill: boolean;
  isValid: boolean;
  error?: string;
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
  });

  // Efecto: suscribirse a cambios de pedidos
  useEffect(() => {
    const { tableNumber, sessionId } = getSessionFromUrl();
    if (!tableNumber || !sessionId) {
      setSession(prev => ({ ...prev, isValid: false, error: 'QR inválido. Escanea el código de la mesa.' }));
      return;
    }

    function evaluateSession() {
      // Buscar pedido activo en esta mesa
      const tableOrders = orderEngine.getTableOrders(`table-${tableNumber}`);
      const activeOrder = tableOrders.find(o =>
        ['draft', 'confirmed', 'preparing', 'ready', 'served'].includes(o.status)
      ) || null;

      const hasActiveOrder = activeOrder !== null;

      // Validar sesión
      const validation = securityEngine.validateSession(sessionId, tableNumber, hasActiveOrder);

      setSession({
        tableNumber,
        sessionId,
        hasActiveOrder,
        activeOrder,
        isReadOnly: !hasActiveOrder || validation.reason === 'readonly',
        canCallWaiter: hasActiveOrder && validation.valid,
        canRequestBill: hasActiveOrder && validation.valid,
        isValid: validation.valid,
        error: validation.valid ? undefined : validation.reason,
      });
    }

    // Evaluación inicial
    evaluateSession();

    // Suscribirse a cambios en órdenes
    const unsubscribe = orderEngine.onChange(evaluateSession);

    // Re-evaluar cada 30 segundos (renovación de token)
    const interval = setInterval(evaluateSession, 30000);

    return () => {
      unsubscribe();
      clearInterval(interval);
    };
  }, []);

  /** Llamar al mesero */
  const callWaiter = useCallback(async () => {
    if (!session.canCallWaiter) return;

    // Disparar notificación vía WebSocket al mesero asignado
    console.log(`[Clientes] Mesa ${session.tableNumber} llama al mesero`);

    // Aquí se integrará con WebSocket
    // ws.send({ type: 'call_waiter', table: session.tableNumber, orderId: session.activeOrder?.id });

    alert('✅ Mesero notificado. Espera un momento por favor.');
  }, [session]);

  /** Pedir la cuenta */
  const requestBill = useCallback(async () => {
    if (!session.canRequestBill) return;

    console.log(`[Clientes] Mesa ${session.tableNumber} solicita la cuenta`);

    // Aquí se integrará con WebSocket
    // ws.send({ type: 'request_bill', table: session.tableNumber, orderId: session.activeOrder?.id });

    alert('✅ Cuenta solicitada. Tu mesero vendrá en breve.');
  }, [session]);

  return session;
}
