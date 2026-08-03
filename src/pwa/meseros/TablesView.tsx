/**
 * TablesView — API-driven table grid (meseros PWA)
 *
 * Reads tables from the server (via useTables), NOT from the
 * in-memory tableEngine. Reuses the TableGrid.css visual classes.
 */

import React from 'react';
import type { Table } from '@/core/types';
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
        </span>
      </div>

      {error && (
        <p className="table-grid__error">{error}</p>
      )}

      {/* Table Grid */}
      <div className="table-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))' }}>
        {tables.map(table => {
          const statusStyle = STATUS_VARS[table.status] || STATUS_VARS.free;
          return (
            <button
              key={table.id}
              className="table-card"
              onClick={() => onTableSelect(table)}
              style={{ borderColor: statusStyle.border }}
              aria-label={`Mesa ${table.number} — ${statusStyle.label}`}
            >
              <span className="table-card__number">{table.number}</span>
              <span className="table-card__status" style={{ color: statusStyle.border }}>
                {statusStyle.label}
              </span>
              <span className="table-card__capacity">{table.capacity} pers.</span>
            </button>
          );
        })}
      </div>

      <button className="table-grid__refresh" onClick={onRefresh}>
        ⟳ Refrescar
      </button>
    </div>
  );
}

export default TablesView;
