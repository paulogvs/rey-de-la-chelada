/**
 * PWA CAJA — Cash Closing & Financial Dashboard (API-driven)
 *
 * Real API (SSOT = server), NOT in-memory engines:
 *   - Login: PIN → POST /api/auth/login → JWT (role 'admin' required;
 *     no 'caja' role exists in the staff seed — use admin PIN 0000)
 *   - Daily sales: GET /api/reports/sales/daily?date=YYYY-MM-DD
 *   - Closing: GET /api/payments/closing/current → POST open → PUT close
 *
 * Views: summary (metrics + by method), close (corte de caja), invoice (SFE-ready).
 */

import React, { useState, useCallback } from 'react';
import { bootstrapPwa } from '../_shared/bootstrap';
import { setCurrentPwaModule } from '../_shared/hooks/useCapability';
import { useStaffAuth } from '../_shared/hooks/useStaffAuth';
import { LoginScreen } from '../_shared/components/LoginScreen';
import { PwaLayout } from '../_shared/components/PwaLayout';
import { Badge } from '@/ui/components/Badge';
import { Loader } from '@/ui/components/Loader';
import { ToastProvider, useToast } from '@/ui/components/Toast';
import { appConfig } from '@/core/config';
import { SummaryView } from './SummaryView';
import { ClosingView } from './ClosingView';
import { InvoiceView } from './InvoiceView';
import './App.css';

type ViewState = 'summary' | 'close' | 'invoice';

function CajaApp() {
  const { addToast } = useToast();
  const { isAuthenticated, token, user, login, logout, restoring } = useStaffAuth('caja');

  const [view, setView] = useState<ViewState>('summary');
  const [refreshTick, setRefreshTick] = useState(0);

  const today = new Date().toISOString().split('T')[0];
  const ivaRate = appConfig.all.taxes.iva.percentage / 100;

  // Auth gate: caja endpoints require role 'admin' (no 'caja' role in seed)
  const restricted = isAuthenticated && user && user.role !== 'admin';

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
        <LoginScreen title="Caja" busy={restoring} onLogin={login} />
      </PwaLayout>
    );
  }

  if (restricted) {
    return (
      <PwaLayout title="Caja">
        <div className="caja-app">
          <div className="caja-restricted">
            <p>Acceso restringido — el módulo Caja requiere rol de administrador.</p>
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
          <div className="caja-header__nav">
            {(['summary', 'close', 'invoice'] as ViewState[]).map(v => (
              <button
                key={v}
                className={`caja-header__nav-btn ${view === v ? 'active' : ''}`}
                onClick={() => setView(v)}
              >
                {v === 'summary' && 'Resumen'}
                {v === 'close' && 'Cierre'}
                {v === 'invoice' && 'Facturación'}
              </button>
            ))}
          </div>
          <Badge variant="info" large>{today}</Badge>
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

          {view === 'close' && (
            <ClosingView
              token={token}
              today={today}
              ivaRate={ivaRate}
              refreshTick={refreshTick}
              onClosingUpdated={handleClosingUpdated}
            />
          )}

          {view === 'invoice' && <InvoiceView />}
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
