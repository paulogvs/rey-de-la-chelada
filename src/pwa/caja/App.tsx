/**
 * PWA CAJA — Cash Closing & Financial Dashboard (API-driven)
 *
 * Real API (SSOT = server), NOT in-memory engines:
 *   - Login: PIN → POST /api/auth/login → JWT (role 'caja' o 'admin';
 *     PIN 3333 = Cajero, PIN 0000 = Administrador)
 *   - Daily sales: GET /api/reports/sales/daily?date=YYYY-MM-DD
 *   - Closing: GET /api/payments/closing/current → POST open → PUT close
 *
 * Views: summary (metrics + by method), close (corte de caja), invoice (SFE-ready).
 */

import React, { useState, useCallback } from 'react';
import { bootstrapPwa } from '../_shared/bootstrap';
import { setCurrentPwaModule } from '../_shared/hooks/useCapability';
import { useStaffAuth } from '../_shared/hooks/useStaffAuth';
import { useKDSWebSocket } from '../_shared/hooks/useKDSWebSocket';
import { LoginScreen } from '../_shared/components/LoginScreen';
import { PwaLayout } from '../_shared/components/PwaLayout';
import { Badge } from '@/ui/components/Badge';
import { Loader } from '@/ui/components/Loader';
import { SegmentedControl, type SegmentedOption } from '@/ui/components/SegmentedControl';
import { ToastProvider, useToast } from '@/ui/components/Toast';
import { appConfig } from '@/core/config';
import { businessDayDateStr } from '../_shared/utils/localDate';
import { SummaryView } from './SummaryView';
import { ClosingView } from './ClosingView';
import { CollectView } from './CollectView';
import { OrderHistoryView } from '../_shared/components/OrderHistoryView';
import { ReportView } from '../_shared/components/ReportView';
import './App.css';

type ViewState = 'summary' | 'collect' | 'history' | 'close' | 'reports';

const VIEW_OPTIONS: SegmentedOption[] = [
  { value: 'summary', label: 'Resumen' },
  { value: 'collect', label: 'Cobrar' },
  { value: 'history', label: 'Pedidos' },
  { value: 'close', label: 'Cierre' },
  { value: 'reports', label: 'Reportes' },
];

function CajaApp() {
  const { addToast } = useToast();
  const { isAuthenticated, token, user, login, logout, restoring, sessionExpired } = useStaffAuth('caja', ['admin', 'caja']);

  const [view, setView] = useState<ViewState>('summary');
  const [refreshTick, setRefreshTick] = useState(0);

  // Opción B (2026-08-19): "hoy" = DÍA LABORAL 15:00→06:00 (el turno del
  // miércoles 15:00 termina jueves 06:00 = UN solo corte con closing_date
  // del miércoles). El header badge, SummaryView y ClosingView usan el
  // día laboral; los pedidos/meseros siguen con fecha calendario local.
  const today = businessDayDateStr();
  const ivaRate = appConfig.all.taxes.iva.percentage / 100;

  // Auth gate: el módulo Caja admite los roles 'caja' y 'admin'
  // (S1: el rol caja real entra con PIN 3333; admin conserva acceso).
  const restricted = isAuthenticated && user && user.role !== 'caja' && user.role !== 'admin';

  const handleLogout = useCallback(async () => {
    await logout();
    setView('summary');
  }, [logout]);

  const handleRefresh = useCallback(() => {
    setRefreshTick(t => t + 1);
  }, []);

  const handleClosingUpdated = useCallback(() => {
    handleRefresh();
    addToast({ type: 'success', message: 'Corte de caja actualizado', duration: 3000 });
  }, [handleRefresh, addToast]);

  // S2-D: real-time — la caja se suscribe al broadcaster KDS y refresca la
  // vista activa cuando cambia el estado de un pedido o se cobra una mesa.
  useKDSWebSocket({
    module: 'caja',
    enabled: !!token,
    onEvent: () => handleRefresh(),
  });

  const handlePaid = useCallback(
    (_orderId: string) => {
      handleRefresh();
      addToast({ type: 'success', message: 'Pedido cobrado', duration: 2000 });
    },
    [handleRefresh, addToast]
  );

  if (restoring) {
    return (
      <PwaLayout title="Caja">
        <div className="caja-app">
          <Loader block label="Cargando…" />
        </div>
      </PwaLayout>
    );
  }

  if (!isAuthenticated || !token) {
    return (
      <PwaLayout title="Caja">
        <LoginScreen
          title="Caja"
          busy={restoring}
          notice={sessionExpired ? 'Tu sesión expiró. Ingresa tu PIN de nuevo.' : null}
          onLogin={login}
        />
      </PwaLayout>
    );
  }

  if (restricted) {
    return (
      <PwaLayout title="Caja">
        <div className="caja-app">
          <div className="caja-restricted">
            <p>Acceso restringido — el módulo Caja requiere rol de cajero o administrador.</p>
            <button className="caja-header__nav-btn" onClick={handleLogout}>
              Volver al inicio de sesión
            </button>
          </div>
        </div>
      </PwaLayout>
    );
  }

  return (
    <PwaLayout title="Caja">
      <div className="caja-app">
        <header className="caja-header">
          <h1 className="caja-header__title">Caja</h1>
          <SegmentedControl
            className="caja-header__nav"
            options={VIEW_OPTIONS}
            value={view}
            onChange={v => setView(v as ViewState)}
          />
          <Badge variant="info" large className="caja-header__date">{today}</Badge>
          {user && (
            <button className="caja-header__logout" onClick={handleLogout} title="Cerrar sesión">
              {user.displayName} · Salir
            </button>
          )}
        </header>

        <main className="caja-main">
          {view === 'summary' && (
            <SummaryView token={token} today={today} ivaRate={ivaRate} refreshTick={refreshTick} />
          )}

          {view === 'collect' && (
            <CollectView token={token} refreshTick={refreshTick} onPaid={handlePaid} />
          )}

          {view === 'history' && <OrderHistoryView token={token} businessDay={today} refreshTick={refreshTick} />}

          {view === 'close' && (
            <ClosingView
              token={token}
              today={today}
              ivaRate={ivaRate}
              refreshTick={refreshTick}
              onClosingUpdated={handleClosingUpdated}
            />
          )}

          {view === 'reports' && <ReportView token={token} onToast={(type, message) => addToast({ type, message, duration: 3000 })} />}
        </main>
      </div>
    </PwaLayout>
  );
}

export default function App() {
  setCurrentPwaModule('caja');
  bootstrapPwa('caja');

  return (
    <ToastProvider>
      <CajaApp />
    </ToastProvider>
  );
}
