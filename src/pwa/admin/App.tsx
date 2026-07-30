/**
 * PWA ADMIN — Administration Dashboard
 *
 * - Dashboard with sales charts
 * - Staff management (CRUD for users)
 * - Menu editor (CRUD for products)
 * - Table config
 * - Tax/tip settings
 */

import React, { useState, useEffect, useCallback } from 'react';
import { bootstrapPwa, setCurrentPwaModule } from '../_shared/bootstrap';
import { PwaLayout } from '../_shared/components/PwaLayout';
import { orderEngine, tableEngine, menuEngine } from '@/core/engine';
import { appConfig } from '@/core/config';
import { Card } from '@/ui/components/Card';
import { Button } from '@/ui/components/Button';
import { Badge } from '@/ui/components/Badge';
import { ForchiBadge } from '@/ui/components/ForchiBadge';
import type { MenuCategory, MenuItem, Table, StaffUser } from '@/core/types';
import './App.css';

type AdminView = 'dashboard' | 'staff' | 'menu' | 'tables' | 'settings';

export default function App() {
  setCurrentPwaModule('admin');
  bootstrapPwa('admin');

  const [view, setView] = useState<AdminView>('dashboard');
  const [summary, setSummary] = useState(orderEngine.getDailySummary());
  const [tables, setTables] = useState<Table[]>(tableEngine.getAllTables());

  // Stub staff data (in production: from engine/DB)
  const [staff] = useState<StaffUser[]>([
    { id: '1', username: 'admin', pin: '1234', role: 'admin', displayName: 'Admin', isActive: true, currentShift: null, lastLoginAt: null, createdAt: '2026-07-01' },
    { id: '2', username: 'mesero1', pin: '1111', role: 'mesero', displayName: 'Carlos', isActive: true, currentShift: 'afternoon', lastLoginAt: null, createdAt: '2026-07-01' },
    { id: '3', username: 'cocina1', pin: '2222', role: 'cocina', displayName: 'María', isActive: true, currentShift: 'afternoon', lastLoginAt: null, createdAt: '2026-07-01' },
  ]);

  useEffect(() => {
    const interval = setInterval(() => {
      setSummary(orderEngine.getDailySummary());
      setTables(tableEngine.getAllTables());
    }, 15000);
    return () => clearInterval(interval);
  }, []);

  const navItems: { id: AdminView; label: string; icon: string }[] = [
    { id: 'dashboard', label: 'Dashboard', icon: '📊' },
    { id: 'staff', label: 'Personal', icon: '👥' },
    { id: 'menu', label: 'Menú', icon: '🍽' },
    { id: 'tables', label: 'Mesas', icon: '🪑' },
    { id: 'settings', label: 'Config', icon: '⚙️' },
  ];

  return (
    <PwaLayout title="Admin">
      <div className="admin-app">
        {/* Sidebar */}
        <nav className="admin-sidebar">
          <div className="admin-sidebar__header">
            <h2>Admin</h2>
          </div>
          <div className="admin-sidebar__nav">
            {navItems.map(item => (
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
          <div className="admin-sidebar__version">
            v{appConfig.all.appVersion}
          </div>
        </nav>

        {/* Main content */}
        <main className="admin-main">
          {/* ---- DASHBOARD ---- */}
          {view === 'dashboard' && (
            <div className="admin-dashboard">
              <h1>Dashboard</h1>
              <div className="admin-dashboard__grid">
                <Card status="paid" className="admin-stat">
                  <div className="admin-stat__label">Ventas hoy</div>
                  <div className="admin-stat__value">Bs. {summary.totalSales.toFixed(2)}</div>
                </Card>
                <Card className="admin-stat">
                  <div className="admin-stat__label">Pedidos</div>
                  <div className="admin-stat__value">{summary.totalOrders}</div>
                </Card>
                <Card className="admin-stat">
                  <div className="admin-stat__label">Mesas ocupadas</div>
                  <div className="admin-stat__value">{tableEngine.getOccupiedTablesCount()}/{tables.length}</div>
                </Card>
                <Card className="admin-stat">
                  <div className="admin-stat__label">Ticket promedio</div>
                  <div className="admin-stat__value">Bs. {summary.averageTicket.toFixed(2)}</div>
                </Card>
              </div>

              <Card className="admin-section">
                <h3>Ventas por método</h3>
                <div className="admin-methods">
                  {Object.entries(summary.byMethod).map(([method, amount]) => (
                    <div key={method} className="admin-methods__item">
                      <span>{method}</span>
                      <span className="admin-methods__amount">Bs. {amount.toFixed(2)}</span>
                    </div>
                  ))}
                </div>
              </Card>

              <Card className="admin-section">
                <h3>Estado de mesas</h3>
                <div className="admin-table-status">
                  {tables.map(t => (
                    <span
                      key={t.id}
                      className="admin-table-status__dot"
                      style={{
                        backgroundColor:
                          t.status === 'free' ? 'var(--status-confirmed)' :
                          t.status === 'occupied' ? 'var(--status-pending)' :
                          t.status === 'payment' ? 'var(--status-cancelled)' :
                          'var(--status-preparing)',
                      }}
                      title={`Mesa ${t.number}: ${t.status}`}
                    />
                  ))}
                </div>
              </Card>
            </div>
          )}

          {/* ---- STAFF ---- */}
          {view === 'staff' && (
            <div className="admin-staff">
              <div className="admin-section-header">
                <h1>Personal</h1>
                <Button variant="primary" size="sm">+ Agregar</Button>
              </div>
              <Card className="admin-section">
                <div className="admin-staff__list">
                  {staff.map(user => (
                    <div key={user.id} className="admin-staff__item">
                      <div className="admin-staff__info">
                        <span className="admin-staff__name">{user.displayName}</span>
                        <span className="admin-staff__username">@{user.username}</span>
                        <Badge variant={user.role === 'admin' ? 'preparing' : user.role === 'mesero' ? 'info' : 'pending'}>
                          {user.role}
                        </Badge>
                        {user.currentShift && (
                          <Badge variant="info">{user.currentShift}</Badge>
                        )}
                      </div>
                      <div className="admin-staff__actions">
                        <Button variant="ghost" size="sm">Editar</Button>
                        <Button variant="ghost" size="sm">Eliminar</Button>
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            </div>
          )}

          {/* ---- MENU ---- */}
          {view === 'menu' && (
            <div className="admin-menu">
              <div className="admin-section-header">
                <h1>Menú</h1>
                <Button variant="primary" size="sm">+ Agregar</Button>
              </div>

              <Card className="admin-section">
                <h3>Categorías</h3>
                <div className="admin-menu__cats">
                  {menuEngine.getCategories().map(cat => (
                    <div key={cat.id} className="admin-menu__cat">
                      <span>{cat.emoji} {cat.name}</span>
                      <Badge variant={cat.isActive ? 'ready' : 'cancelled'}>
                        {cat.isActive ? 'Activo' : 'Inactivo'}
                      </Badge>
                    </div>
                  ))}
                </div>
              </Card>

              <Card className="admin-section">
                <h3>Productos ({menuEngine.getItems().length})</h3>
                <div className="admin-menu__items">
                  {menuEngine.getItems().map(item => (
                    <div key={item.id} className="admin-menu__item">
                      <div className="admin-menu__item-info">
                        <span className="admin-menu__item-name">{item.name}</span>
                        <span className="admin-menu__item-price">Bs. {item.price.toFixed(2)}</span>
                      </div>
                      <div className="admin-menu__item-badges">
                        <Badge variant={item.isAvailable ? 'ready' : 'cancelled'}>
                          {item.isAvailable ? 'Disponible' : 'Agotado'}
                        </Badge>
                        {item.tags.map(t => <Badge key={t} variant="info">{t}</Badge>)}
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            </div>
          )}

          {/* ---- TABLES ---- */}
          {view === 'tables' && (
            <div className="admin-tables">
              <div className="admin-section-header">
                <h1>Configuración de Mesas</h1>
              </div>

              <Card className="admin-section">
                <h3>Distribución</h3>
                <div className="admin-tables__config">
                  <div className="admin-tables__field">
                    <label>Total mesas</label>
                    <input
                      type="number"
                      className="admin-input"
                      value={tableEngine.getConfig().totalTables}
                      min={1}
                      onChange={e => tableEngine.updateConfig({ totalTables: parseInt(e.target.value) || 10 })}
                    />
                  </div>
                  <div className="admin-tables__field">
                    <label>Columnas en grid</label>
                    <input
                      type="number"
                      className="admin-input"
                      value={tableEngine.getConfig().gridColumns}
                      min={1}
                      max={10}
                      onChange={e => tableEngine.updateConfig({ gridColumns: parseInt(e.target.value) || 5 })}
                    />
                  </div>
                  <div className="admin-tables__field">
                    <label>Capacidad por defecto</label>
                    <input
                      type="number"
                      className="admin-input"
                      value={tableEngine.getConfig().defaultCapacity}
                      min={1}
                      onChange={e => tableEngine.updateConfig({ defaultCapacity: parseInt(e.target.value) || 4 })}
                    />
                  </div>
                  <Button variant="secondary" onClick={() => tableEngine.resetAll()}>
                    Reiniciar todas las mesas
                  </Button>
                </div>
              </Card>

              <Card className="admin-section">
                <h3>Estado actual</h3>
                <div className="admin-tables__list">
                  {tables.map(t => (
                    <div key={t.id} className="admin-tables__item">
                      <span className="admin-tables__number">Mesa {t.number}</span>
                      <Badge variant={
                        t.status === 'free' ? 'ready' :
                        t.status === 'occupied' ? 'pending' :
                        t.status === 'payment' ? 'cancelled' :
                        'preparing'
                      }>
                        {t.status}
                      </Badge>
                      <span className="admin-tables__capacity">{t.capacity} pers.</span>
                    </div>
                  ))}
                </div>
              </Card>
            </div>
          )}

          {/* ---- SETTINGS ---- */}
          {view === 'settings' && (
            <div className="admin-settings">
              <div className="admin-section-header">
                <h1>Configuración</h1>
              </div>

              <Card className="admin-section">
                <h3>Impuestos</h3>
                <div className="admin-settings__field">
                  <label>IVA (%)</label>
                  <input
                    type="number"
                    className="admin-input"
                    defaultValue={appConfig.all.taxes.iva.percentage}
                    step={0.01}
                  />
                </div>
                <div className="admin-settings__field">
                  <label>ICE — Tasa por litro alcohol puro (Bs.)</label>
                  <input
                    type="number"
                    className="admin-input"
                    defaultValue={appConfig.all.taxes.ice?.ratePerLiterOfPureAlcohol || 4.03}
                    step={0.01}
                  />
                </div>
                <div className="admin-settings__field">
                  <label>ICE — Ad valorem (%)</label>
                  <input
                    type="number"
                    className="admin-input"
                    defaultValue={(appConfig.all.taxes.ice?.adValoremRate || 0.01) * 100}
                    step={0.01}
                  />
                </div>
              </Card>

              <Card className="admin-section">
                <h3>Propinas</h3>
                <div className="admin-settings__field">
                  <label>Porcentajes predefinidos</label>
                  <input
                    type="text"
                    className="admin-input"
                    defaultValue={appConfig.all.tipping.presetPercentages.join(', ')}
                    placeholder="0, 5, 10, 15"
                  />
                </div>
              </Card>

              <Card className="admin-section">
                <h3>Facturación SFE</h3>
                <div className="admin-settings__field">
                  <label>NIT del restaurante</label>
                  <input
                    type="text"
                    className="admin-input"
                    defaultValue={appConfig.all.business.nit}
                  />
                </div>
                <div className="admin-settings__field">
                  <label>CUIS (SIN)</label>
                  <input type="text" className="admin-input" defaultValue={appConfig.all.invoicing.cuis} />
                </div>
                <div className="admin-settings__field">
                  <label>Límite para factura con NIT (Bs.)</label>
                  <input
                    type="number"
                    className="admin-input"
                    defaultValue={appConfig.all.invoicing.nitThreshold}
                  />
                </div>
              </Card>

              <Card className="admin-section">
                <h3>Horarios</h3>
                {Object.entries(appConfig.all.businessHours).map(([day, hours]) => (
                  <div key={day} className="admin-settings__field">
                    <label>{day.charAt(0).toUpperCase() + day.slice(1)}</label>
                    <div className="admin-settings__hours">
                      {hours ? (
                        <>
                          <input type="time" className="admin-input admin-input--sm" defaultValue={hours.open} />
                          <span>a</span>
                          <input type="time" className="admin-input admin-input--sm" defaultValue={hours.close} />
                        </>
                      ) : (
                        <span className="text-muted">Cerrado</span>
                      )}
                    </div>
                  </div>
                ))}
              </Card>
            </div>
          )}
        </main>

        <ForchiBadge />
      </div>
    </PwaLayout>
  );
}
