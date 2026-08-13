/**
 * TablesView — API-driven table grid (meseros PWA)
 *
 * FASE 4.5: alertas de salón PERMANENTES por módulo, derivadas del pedido
 * activo de cada mesa (SSOT server → GET /api/tables → table.activeOrder):
 *   - 🍳 / 🍺 VERDE  = ese módulo tiene items LISTOS para entregar
 *   - 🍳 / 🍺 AMARILLO = ese módulo está EN PROCESO (cocina/bar trabajando)
 *   - 💰 "Por cobrar" = TODO entregado (served)
 *
 * La alerta vive mientras el pedido tenga trabajo de ese módulo (sin TTL):
 * desaparece al entregar o al pagar. El polling (15s) + WS la mantienen al día.
 */

import React from 'react';
import type { Table } from '@/core/types';
import { AppIcon, type AppIconName } from '@/ui/components/AppIcon/AppIcon';
import { tableAlertState } from './tableAlerts';
import '@/modules/salon/components/TableGrid.css';

/** Status → CSS variable mapping (zero hardcoded colors) */
const STATUS_VARS: Record<string, { border: string; label: string }> = {
  free:     { border: 'var(--status-confirmed)',  label: 'Libre' },
  occupied: { border: 'var(--status-pending)',    label: 'Ocupada' },
  ordered:  { border: 'var(--status-preparing)',  label: 'Pedido' },
  serving:  { border: 'var(--status-preparing)',  label: 'Servida' },
  payment:  { border: 'var(--status-cancelled)',  label: 'Pagando' },
  closed:   { border: 'var(--status-delivered)',  label: 'Cerrada' },
};

const MODULE_ICON: Record<string, AppIconName> = { bar: 'beer', cocina: 'flame' };

interface TablesViewProps {
  tables: Table[];
  loading: boolean;
  error: string | null;
  onTableSelect: (table: Table) => void;
  onRefresh: () => void;
}

export function TablesView({ tables, loading, error, onTableSelect, onRefresh }: TablesViewProps) {
  const freeCount = tables.filter(t => t.status === 'free').length;
  const occupiedCount = tables.length - freeCount;
  const chargeCount = tables.filter(t => t.activeOrder?.status === 'served').length;
  const deliverableCount = tables.filter(t =>
    t.activeOrder && ['bar', 'cocina'].some(m => t.activeOrder!.modules[m as 'bar' | 'cocina'] === 'ready')
  ).length;

  return (
    <div className="table-grid-wrapper">
      {/* Grid Header */}
      <div className="table-grid__header">
        <h2>Salón</h2>
        <div className="table-grid__legend">
          {Object.entries(STATUS_VARS).map(([status, v]) => (
            <span key={status} className="table-grid__legend-item">
              <span className="table-grid__legend-dot" style={{ background: v.border }} />
              {v.label}
            </span>
          ))}
        </div>
        <span className="table-grid__count">
          {loading ? 'Cargando…' : `${freeCount} libres / ${occupiedCount} ocupadas`}
          {deliverableCount > 0 && <span className="table-grid__ready-count"> · {deliverableCount} para entregar</span>}
          {chargeCount > 0 && <span className="table-grid__charge-count"> · {chargeCount} por cobrar</span>}
        </span>
      </div>

      {error && (
        <p className="table-grid__error">{error}</p>
      )}

      {/* Table Grid */}
      <div className="table-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(112px, 1fr))' }}>
        {tables.map(table => {
          const statusStyle = STATUS_VARS[table.status] || STATUS_VARS.free;
          const { served, modules } = tableAlertState(table.activeOrder);
          const hasModuleAlerts = modules.length > 0;
          return (
            <button
              key={table.id}
              className={`table-card${served ? ' table-card--charge' : ''}${hasModuleAlerts ? ' table-card--alert' : ''}`}
              onClick={() => onTableSelect(table)}
              style={{ borderColor: statusStyle.border }}
              aria-label={`Mesa ${table.number} — ${statusStyle.label}${served ? ' — todo entregado, por cobrar' : ''}`}
            >
              <span className="table-card__number">{table.number}</span>
              <span className="table-card__status" style={{ color: statusStyle.border }}>
                {statusStyle.label}
              </span>
              <span className="table-card__capacity">{table.capacity} pers.</span>

              {/* FASE 4.5: alertas por módulo (verde = listo, amarillo = en proceso) */}
              {!served && hasModuleAlerts && (
                <span className="table-card__modules">
                  {modules.map(({ module, state }) => (
                    <span
                      key={module}
                      className={`table-card__module table-card__module--${state}`}
                      title={state === 'ready' ? `${module === 'bar' ? 'Barra' : 'Cocina'} lista — entregar` : `${module === 'bar' ? 'Barra' : 'Cocina'} en proceso`}
                    >
                      <AppIcon name={MODULE_ICON[module]} size="sm" />
                    </span>
                  ))}
                </span>
              )}

              {/* FASE 4.5: todo entregado → por cobrar */}
              {served && (
                <span className="table-card__charge-badge"><AppIcon name="wallet" size="sm" /> Por cobrar</span>
              )}
            </button>
          );
        })}
      </div>

      <button className="table-grid__refresh" onClick={onRefresh}>
        <AppIcon name="refresh" size="sm" /> Refrescar
      </button>
    </div>
  );
}

export default TablesView;
