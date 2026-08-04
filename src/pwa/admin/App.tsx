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
import { ToastProvider, useToast } from '@/ui/components/Toast';
import { DashboardView } from './views/DashboardView';
import { PriceEditorView } from './views/PriceEditorView';
import { BulkPricesView } from './views/BulkPricesView';
import { ModifierOptionsView } from './views/ModifierOptionsView';
import { StaffView } from './views/StaffView';
import { TablesView } from './views/TablesView';
import { ClosingsView } from './views/ClosingsView';
import './App.css';
import './views/views.css';

type AdminView =
  | 'dashboard'
  | 'prices'
  | 'bulk'
  | 'modifiers'
  | 'staff'
  | 'tables'
  | 'closings';

const NAV_ITEMS: { id: AdminView; label: string; icon: string }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: '📊' },
  { id: 'prices', label: 'Precios', icon: '💲' },
  { id: 'bulk', label: 'Carga Masiva', icon: '📦' },
  { id: 'modifiers', label: 'Tamaños', icon: '🍕' },
  { id: 'staff', label: 'Personal', icon: '👥' },
  { id: 'tables', label: 'Mesas', icon: '🪑' },
  { id: 'closings', label: 'Cortes', icon: '🧾' },
];

function AdminApp() {
  const { addToast } = useToast();
  const { isAuthenticated, token, user, login, logout, restoring } = useStaffAuth('admin');
  const [view, setView] = useState<AdminView>('dashboard');

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
        <div className="admin-app"><p className="admin-loading">Cargando…</p></div>
      </PwaLayout>
    );
  }

  if (!isAuthenticated || !token) {
    return (
      <PwaLayout title="Admin">
        <LoginScreen title="Panel Admin" busy={restoring} onLogin={login} />
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
            <h2>⚙️ Admin</h2>
          </div>
          <div className="admin-sidebar__nav">
            {NAV_ITEMS.map(item => (
              <button
                key={item.id}
                className={`admin-sidebar__btn ${view === item.id ? 'active' : ''}`}
                onClick={() => setView(item.id)}
              >
                <span className="admin-sidebar__icon">{item.icon}</span>
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
            <Badge variant="info">Admin</Badge>
          </header>

          {view === 'dashboard' && <DashboardView token={token} onToast={handleToast} />}
          {view === 'prices' && <PriceEditorView token={token} onToast={handleToast} />}
          {view === 'bulk' && <BulkPricesView token={token} onToast={handleToast} />}
          {view === 'modifiers' && <ModifierOptionsView token={token} onToast={handleToast} />}
          {view === 'staff' && <StaffView token={token} onToast={handleToast} />}
          {view === 'tables' && <TablesView token={token} onToast={handleToast} />}
          {view === 'closings' && <ClosingsView token={token} onToast={handleToast} />}
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
