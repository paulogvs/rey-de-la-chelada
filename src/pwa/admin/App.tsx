/**
 * PWA ADMIN — Panel de Administración (API-driven)
 *
 * Paulo gestiona TODO sin tocar código:
 *   - Dashboard: stats en vivo (items, sin-precio, mesas, cortes de hoy)
 *   - Precios: editor inline por item + carga masiva por categoría
 *   - Modificadores: precios de tamaños (pizza) individuales o en masa
 *   - Personal: PIN por rol (admin/mesero/kds)
 *   - Mesas: listar, agregar, eliminar
 *   - Cortes de caja: historial de cierres
 *
 * Auth: PIN admin (0000 por defecto) → JWT. Sin 'caja' role en seed.
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
import { AppIcon, type AppIconName } from '@/ui/components/AppIcon/AppIcon';
import { DashboardView } from './views/DashboardView';
import { MenuPanel } from './views/MenuPanel';
import { StaffView } from './views/StaffView';
import { TablesView } from './views/TablesView';
import { ClosingsView } from './views/ClosingsView';
import { PaymentsView } from './views/PaymentsView';
import { StatsView } from './views/StatsView';
import { PromosView } from './views/PromosView';
import { OrderHistoryView } from '../_shared/components/OrderHistoryView';
import { ReportView } from '../_shared/components/ReportView';
import { SettingsView } from './views/SettingsView';
import { BusinessDayPicker } from '../_shared/components/BusinessDayPicker';
import { businessDayDateStr } from '../_shared/utils/localDate';
import './App.css';
import './views/views.css';

type AdminView =
  | 'dashboard'
  | 'menu'
  | 'staff'
  | 'tables'
  | 'closings'
  | 'reports'
  | 'payments'
  | 'orders'
  | 'stats'
  | 'promos'
  | 'settings';

const NAV_ITEMS: { id: AdminView; label: string; icon: AppIconName }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: 'dashboard' },
  { id: 'menu', label: 'Menú', icon: 'package' },
  { id: 'staff', label: 'Personal', icon: 'users' },
  { id: 'tables', label: 'Mesas', icon: 'armchair' },
  { id: 'closings', label: 'Cortes', icon: 'receipt' },
  { id: 'reports', label: 'Reportes', icon: 'chart' },
  { id: 'payments', label: 'Pagos', icon: 'cash' },
  { id: 'orders', label: 'Pedidos', icon: 'receipt' },
  { id: 'stats', label: 'Estadísticas', icon: 'chart' },
  { id: 'promos', label: 'Promos', icon: 'tag' },
  { id: 'settings', label: 'Configuración', icon: 'sliders' },
];

function AdminApp() {
  const { addToast } = useToast();
  const { isAuthenticated, token, user, login, logout, restoring, sessionExpired } = useStaffAuth('admin', ['admin']);
  const [view, setView] = useState<AdminView>('dashboard');
  // v14 (2026-08-29): día laboral seleccionado — permite ver días ANTERIORES
  // (pedidos, pagos, reportes históricos). Default: hoy.
  const [selectedDay, setSelectedDay] = useState<string>(() => businessDayDateStr());

  const restricted = isAuthenticated && user && user.role !== 'admin';

  const handleLogout = useCallback(async () => {
    await logout();
    setView('dashboard');
  }, [logout]);

  const handleToast = useCallback((type: 'success' | 'error' | 'warning', message: string) => {
    addToast({ type, message, duration: 3000 });
  }, [addToast]);

  if (restoring) {
    return (
      <PwaLayout title="Admin">
        <div className="admin-app"><Loader block label="Cargando…" /></div>
      </PwaLayout>
    );
  }

  if (!isAuthenticated || !token) {
    return (
      <PwaLayout title="Admin">
        <LoginScreen
          title="Panel Admin"
          busy={restoring}
          notice={sessionExpired ? 'Tu sesión expiró. Ingresa tu PIN de nuevo.' : null}
          onLogin={login}
        />
      </PwaLayout>
    );
  }

  if (restricted) {
    return (
      <PwaLayout title="Admin">
        <div className="admin-app">
          <div className="admin-restricted">
            <p>Acceso restringido — el módulo Admin requiere rol de administrador.</p>
            <button className="admin-input-btn" onClick={handleLogout}>Volver al inicio de sesión</button>
          </div>
        </div>
      </PwaLayout>
    );
  }

  return (
    <PwaLayout title="Admin">
      <div className="admin-app">
        {/* Sidebar */}
        <nav className="admin-sidebar">
          <div className="admin-sidebar__header">
            <h2><AppIcon name="crown" size="md" /> Admin</h2>
            <p className="admin-sidebar__subtitle">Rey de la Chelada</p>
          </div>
          <div className="admin-sidebar__nav">
            {NAV_ITEMS.map(item => (
              <button
                key={item.id}
                className={`admin-sidebar__btn ${view === item.id ? 'active' : ''}`}
                onClick={() => setView(item.id)}
              >
                <span className="admin-sidebar__icon"><AppIcon name={item.icon} size="md" /></span>
                <span className="admin-sidebar__label">{item.label}</span>
              </button>
            ))}
          </div>
          <div className="admin-sidebar__footer">
            {user && (
              <button className="admin-sidebar__logout" onClick={handleLogout} title="Cerrar sesión">
                {user.displayName} · Salir
              </button>
            )}
          </div>
        </nav>

        {/* Main content */}
        <main className="admin-main">
          <header className="admin-topbar">
            <h1>{NAV_ITEMS.find(i => i.id === view)?.label}</h1>
            <div className="admin-topbar__actions">
              {['orders', 'payments', 'reports', 'closings', 'dashboard'].includes(view) && (
                <BusinessDayPicker value={selectedDay} onChange={setSelectedDay} />
              )}
              <Badge variant="info">Admin</Badge>
              {user && (
                <button className="admin-topbar__logout" onClick={handleLogout} title="Cerrar sesión">
                  <AppIcon name="logout" size="sm" /> Salir
                </button>
              )}
            </div>
          </header>

          {view === 'dashboard' && <DashboardView token={token} onToast={handleToast} businessDay={selectedDay} />}
          {view === 'menu' && <MenuPanel token={token} onToast={handleToast} />}
          {view === 'staff' && <StaffView token={token} onToast={handleToast} />}
          {view === 'tables' && <TablesView token={token} onToast={handleToast} />}
          {view === 'closings' && <ClosingsView token={token} onToast={handleToast} />}
          {view === 'reports' && <ReportView token={token} onToast={handleToast} initialDate={selectedDay} />}
          {view === 'payments' && <PaymentsView token={token} onToast={handleToast} businessDay={selectedDay} />}
          {view === 'orders' && <OrderHistoryView token={token} businessDay={selectedDay} title="Historial de pedidos" />}
          {view === 'stats' && <StatsView token={token} onToast={handleToast} />}
          {view === 'promos' && <PromosView token={token} onToast={handleToast} />}
          {view === 'settings' && <SettingsView token={token} onToast={handleToast} />}
        </main>
      </div>
    </PwaLayout>
  );
}

export default function App() {
  setCurrentPwaModule('admin');
  bootstrapPwa('admin');

  return (
    <ToastProvider>
      <AdminApp />
    </ToastProvider>
  );
}
