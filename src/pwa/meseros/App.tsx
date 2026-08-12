/**
 * PWA MESEROS — Waiter Management Interface (API-driven)
 *
 * Real API (SSOT = server), NOT in-memory engines:
 *   - Login: PIN → POST /api/auth/login → JWT (persisted per-module)
 *   - Tables: GET /api/tables (+ WS refresh + polling)
 *   - Orders: POST /api/orders (draft) → PATCH /:id/confirm
 *   - Payments: POST /api/payments (split) → table clears when paid
 *   - Waiter calls: GET/PATCH /api/waiter-calls (client requests)
 *
 * Flow:
 *   LoginScreen → TablesView → tap table → OrderPanel (create) →
 *   confirm → OrderDetail/PaymentPanel → pay → table free
 */

import React, { useState, useCallback } from 'react';
import { bootstrapPwa } from '../_shared/bootstrap';
import { setCurrentPwaModule } from '../_shared/hooks/useCapability';
import { useKDSWebSocket } from '../_shared/hooks/useKDSWebSocket';
import { useStaffAuth } from '../_shared/hooks/useStaffAuth';
import { useTables } from '../_shared/hooks/useTables';
import { useWaiterCalls } from '../_shared/hooks/useWaiterCalls';
import { LoginScreen } from '../_shared/components/LoginScreen';
import { PwaLayout } from '../_shared/components/PwaLayout';
import { ToastProvider, useToast } from '@/ui/components/Toast';
import { Loader } from '@/ui/components/Loader';
import { IconButton } from '@/ui/components/IconButton';
import type { Table } from '@/core/types';
import { TablesView } from './TablesView';
import { OrderPanel } from './OrderPanel';
import { PaymentPanel } from './PaymentPanel';
import { WaiterCallsBoard } from './WaiterCallsBoard';
import './App.css';

type ViewState = 'tables' | 'order-panel' | 'payment-panel' | 'waiter-calls';

function MeserosApp() {
  const { addToast } = useToast();
  const { isAuthenticated, token, user, login, logout, restoring } = useStaffAuth('meseros', ['admin', 'mesero']);

  const [view, setView] = useState<ViewState>('tables');
  const [selectedTable, setSelectedTable] = useState<Table | null>(null);
  const [activeOrderId, setActiveOrderId] = useState<string | null>(null);

  // Tables — real API with WS refresh + polling
  const tables = useTables({ token, pollMs: 15000 });

  // Waiter calls — real API board (F1: 30s en vez de 10s — el board no es
  // crítico en tiempo real y reduce ~40% del polling de meseros)
  const waiterCalls = useWaiterCalls({ token, pollMs: 30000 });

  // FASE 4.5: las alertas de salón (🍳/🍺 verde/amarillo + 💰 Por cobrar)
  // se DERIVAN de tables[].activeOrder (SSOT server) — el polling de mesas
  // (15s) + los eventos WS la mantienen al día. Sin TTL: la alerta vive
  // mientras el pedido tenga trabajo de ese módulo.

  // Real-time: KDS marks an order complete → notify waiter + refresh tables
  useKDSWebSocket({
    module: 'meseros',
    enabled: !!token,
    onEvent: event => {
      // P0-FIX (2026-08-11 flujo mixto): aviso PARCIAL por módulo — barra
      // lista y cocina lista son avisos SEPARADOS al mesero. El circuito se
      // cierra (order_complete) solo cuando TODOS los módulos terminaron.
      if (event.type === 'module_ready') {
        const label = event.module === 'bar' ? '🍺 Barra lista' : '🍳 Cocina lista';
        addToast({
          type: 'success',
          message: `Mesa ${event.tableNumber ?? ''} — ${label} — listo para recoger`,
          duration: 4000,
        });
      }
      if (event.type === 'order_complete') {
        addToast({
          type: 'success',
          message: `Mesa ${event.tableNumber ?? ''} — Pedido listo 🍽️`,
          duration: 4000,
        });
      }
      // Any order event → refresh table statuses (actualiza las alertas)
      tables.wsEvent(event);
    },
  });

  const handleTableSelect = useCallback((table: Table) => {
    setSelectedTable(table);
    setView('order-panel');
    // Refrescar para que el detalle vea el pedido activo actualizado
    tables.refresh();
  }, [tables]);

  const handleBackToTables = useCallback(() => {
    setSelectedTable(null);
    setActiveOrderId(null);
    setView('tables');
    tables.refresh();
  }, [tables]);

  // FASE 4A: la orden se crea CONFIRMADA en 1 llamada (el server la
  // envía al KDS al instante). Tras crear → volver al SALÓN (no al cobro):
  // el mesero cobra cuando el cliente pide la cuenta (botón 💰 en la mesa).
  const handleOrderPlaced = useCallback(
    (orderId: string) => {
      setActiveOrderId(orderId);
      addToast({
        type: 'success',
        message: `Pedido enviado a cocina — Mesa ${selectedTable?.number}`,
        duration: 3000,
      });
      handleBackToTables();
    },
    [selectedTable, addToast, handleBackToTables]
  );

  // FASE 4C: el mesero cobra desde la mesa (solo cuando served — el
  // OrderPanel lo habilita). Ir al PaymentPanel con el pedido activo.
  const handleRequestPayment = useCallback((orderId: string) => {
    setActiveOrderId(orderId);
    setView('payment-panel');
  }, []);

  const handlePaymentComplete = useCallback(() => {
    addToast({
      type: 'success',
      message: `Pago registrado — Mesa ${selectedTable?.number}`,
      duration: 3000,
    });
    handleBackToTables();
  }, [selectedTable, addToast, handleBackToTables]);

  const handleOrderCancelled = useCallback(() => {
    addToast({ type: 'warning', message: 'Pedido cancelado', duration: 3000 });
    handleBackToTables();
  }, [addToast, handleBackToTables]);

  const handleLogout = useCallback(async () => {
    await logout();
    setView('tables');
    setSelectedTable(null);
    setActiveOrderId(null);
  }, [logout]);

  // ── Auth gate ─────────────────────────────────────────────
  if (restoring) {
    return (
      <PwaLayout title="Meseros">
        <div className="meseros-app">
          <Loader block label="Cargando…" />
        </div>
      </PwaLayout>
    );
  }

  if (!isAuthenticated || !token) {
    return (
      <PwaLayout title="Meseros">
        <LoginScreen title="Meseros" busy={restoring} onLogin={login} />
      </PwaLayout>
    );
  }

  return (
    <PwaLayout title="Meseros">
      <div className="meseros-app">
        {/* Navigation Bar */}
        <header className="meseros-header">
          <div className="meseros-header__left">
            {view !== 'tables' && (
              <IconButton
                label="Volver a mesas"
                variant="ghost"
                className="meseros-header__back"
                onClick={handleBackToTables}
              >
                ←
              </IconButton>
            )}
            <h1 className="meseros-header__title">
              {view === 'tables' && 'Mesas'}
              {view === 'order-panel' && `Mesa ${selectedTable?.number}`}
              {view === 'payment-panel' && `Mesa ${selectedTable?.number} — Pago`}
              {view === 'waiter-calls' && 'Llamadas de clientes'}
            </h1>
          </div>
          <div className="meseros-header__right">
            {view === 'tables' && (
              <IconButton
                label="Llamadas de clientes"
                variant="ghost"
                className="meseros-header__calls"
                onClick={() => setView('waiter-calls')}
              >
                🔔
                {waiterCalls.pendingCount > 0 && (
                  <span className="meseros-header__calls-badge">{waiterCalls.pendingCount}</span>
                )}
              </IconButton>
            )}
            {user && (
              <button className="meseros-header__logout" onClick={handleLogout} title="Cerrar sesión">
                {user.displayName} · Salir
              </button>
            )}
          </div>
        </header>

        {/* Main Content */}
        <main className="meseros-main">
          {view === 'tables' && (
            <TablesView
              // tablesApi.Table es un subconjunto estructural de core Table (sin
              // createdAt/updatedAt, que el server no expone en GET /api/tables).
              // FASE 4.5: activeOrder llega en cada mesa → alertas por módulo.
              tables={tables.tables as Table[]}
              loading={tables.loading}
              error={tables.error}
              onTableSelect={handleTableSelect}
              onRefresh={tables.refresh}
            />
          )}

          {view === 'order-panel' && selectedTable && token && (
            <OrderPanel
              table={selectedTable}
              token={token}
              onOrderPlaced={handleOrderPlaced}
              onCancel={handleOrderCancelled}
              onBack={handleBackToTables}
              onRequestPayment={handleRequestPayment}
            />
          )}

          {view === 'payment-panel' && selectedTable && activeOrderId && token && (
            <PaymentPanel
              orderId={activeOrderId}
              table={selectedTable}
              token={token}
              onPaymentComplete={handlePaymentComplete}
              onBack={() => setView('order-panel')}
            />
          )}

          {view === 'waiter-calls' && (
            <WaiterCallsBoard
              calls={waiterCalls.calls}
              loading={waiterCalls.loading}
              error={waiterCalls.error}
              onAccept={waiterCalls.accept}
              onComplete={waiterCalls.complete}
              onCancel={waiterCalls.cancel}
              onRefresh={waiterCalls.refresh}
            />
          )}
        </main>
      </div>
    </PwaLayout>
  );
}

export default function App() {
  setCurrentPwaModule('meseros');
  bootstrapPwa('meseros');

  return (
    <ToastProvider>
      <MeserosApp />
    </ToastProvider>
  );
}
