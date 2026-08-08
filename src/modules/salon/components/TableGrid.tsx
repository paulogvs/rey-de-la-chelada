/**
 * TABLE GRID — Logical table control (NOT a visual map)
 *
 * Artículo I: SSOT — Reads from TableEngine only, never duplicating state
 * Artículo II: ZERO HARDCODED — All colors from CSS variables (--status-*, --surface, etc.)
 * Artículo IV: Simplicity — Simple grid, no drag-and-drop, no canvas
 *
 * Tables are controlled by number, not by position.
 * Layout can be reconfigured via admin panel (grid columns, sorting).
 * Status colors change automatically with theme.
 */

import React, { useEffect, useState, useCallback } from 'react';
import { tableEngine } from '../../../core/engine';
import type { Table, TableConfig } from '../../../core/types';

// ============================================================
// TABLE STATUS VISUAL CONFIG
// ============================================================

/** Status → CSS variable mapping (zero hardcoded colors) */
const STATUS_VARS: Record<string, { border: string; label: string }> = {
  free:     { border: 'var(--status-confirmed)',  label: 'Libre' },
  occupied: { border: 'var(--status-pending)',    label: 'Ocupada' },
  ordered:  { border: 'var(--status-preparing)',  label: 'Pedido' },
  serving:  { border: 'var(--status-preparing)',  label: 'Servida' },
  payment:  { border: 'var(--status-cancelled)',  label: 'Pagando' },
  closed:   { border: 'var(--status-delivered)',  label: 'Cerrada' },
};

// ============================================================
// TABLE CARD
// ============================================================

interface TableCardProps {
  table: Table;
  onSelect: (table: Table) => void;
}

function TableCard({ table, onSelect }: TableCardProps) {
  const statusStyle = STATUS_VARS[table.status] || STATUS_VARS.free;

  return (
    <button
      className="table-card"
      onClick={() => onSelect(table)}
      style={{
        borderColor: statusStyle.border,
      }}
      aria-label={`Mesa ${table.number} — ${statusStyle.label}`}
    >
      <span className="table-card__number">
        {table.number}
      </span>
      <span className="table-card__status" style={{ color: statusStyle.border }}>
        {statusStyle.label}
      </span>
      <span className="table-card__capacity">
        {table.capacity} pers.
      </span>
    </button>
  );
}

// ============================================================
// TABLE GRID
// ============================================================

export interface TableGridProps {
  onTableSelect?: (table: Table) => void;
  columns?: number;
  filterSection?: string;
  showConfig?: boolean;
}

export function TableGrid({
  onTableSelect,
  columns,
  filterSection,
  showConfig = false,
}: TableGridProps) {
  const [tables, setTables] = useState<Table[]>([]);
  const [config, setConfig] = useState<TableConfig>(tableEngine.getConfig());

  // Subscribe to engine changes
  useEffect(() => {
    function update() {
      setTables(
        filterSection
          ? tableEngine.getTablesBySection(filterSection)
          : tableEngine.getAllTables()
      );
      setConfig(tableEngine.getConfig());
    }

    update();
    return tableEngine.onChange(update);
  }, [filterSection]);

  const handleTableSelect = useCallback((table: Table) => {
    onTableSelect?.(table);
  }, [onTableSelect]);

  const gridCols = columns || config.gridColumns;

  return (
    <div className="table-grid-wrapper">
      {/* Grid Header */}
      <div className="table-grid__header">
        <h2>
          Salón {filterSection ? `— ${filterSection}` : ''}
        </h2>
        <div className="table-grid__legend">
          {Object.entries(STATUS_VARS).map(([status, v]) => (
            <span key={status} className="table-grid__legend-item">
              <span
                className="table-grid__legend-dot"
                style={{ background: v.border }}
              />
              {v.label}
            </span>
          ))}
        </div>
        <span className="table-grid__count">
          {tableEngine.getFreeTablesCount()} libres / {tableEngine.getOccupiedTablesCount()} ocupadas
        </span>
      </div>

      {/* Table Grid */}
      <div
        className="table-grid"
        style={{
          gridTemplateColumns: `repeat(${gridCols}, 1fr)`,
        }}
      >
        {tables.map((table) => (
          <TableCard
            key={table.id}
            table={table}
            onSelect={handleTableSelect}
          />
        ))}
      </div>

      {/* Admin Config Panel */}
      {showConfig && (
        <div className="table-grid__config">
          <h3>Configuración de Mesas</h3>
          <div className="table-grid__config-form">
            <label>
              Columnas:
              <input
                type="number"
                min={1}
                max={6}
                value={config.gridColumns}
                onChange={(e) => {
                  const val = parseInt(e.target.value, 10);
                  if (val > 0) tableEngine.updateConfig({ gridColumns: val });
                }}
              />
            </label>
            <label>
              Total mesas:
              <input
                type="number"
                min={1}
                max={50}
                value={config.totalTables}
                onChange={(e) => {
                  const val = parseInt(e.target.value, 10);
                  if (val > 0) tableEngine.updateConfig({ totalTables: val });
                }}
              />
            </label>
            <button
              className="touch-primary"
              onClick={() => tableEngine.resetAll()}
            >
              Reiniciar todas
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================
// TABLE LIST (Alternate view — for smaller screens)
// ============================================================

export interface TableListProps {
  onTableSelect?: (table: Table) => void;
  filterStatus?: string;
}

export function TableList({ onTableSelect, filterStatus }: TableListProps) {
  const [tables, setTables] = useState<Table[]>([]);

  useEffect(() => {
    function update() {
      let all = tableEngine.getAllTables();
      if (filterStatus) {
        all = all.filter(t => t.status === filterStatus);
      }
      setTables(all);
    }
    update();
    return tableEngine.onChange(update);
  }, [filterStatus]);

  return (
    <div className="table-list">
      {tables.map((table) => (
        <button
          key={table.id}
          className="table-list__item touch-target"
          onClick={() => onTableSelect?.(table)}
          style={{ borderLeftColor: STATUS_VARS[table.status]?.border || 'var(--border)' }}
        >
          <span className="table-list__number">Mesa {table.number}</span>
          <span className="table-list__status" style={{ color: STATUS_VARS[table.status]?.border }}>
            {STATUS_VARS[table.status]?.label || table.status}
          </span>
          {table.assignedWaiterId && (
            <span className="table-list__waiter">Mesero asignado</span>
          )}
        </button>
      ))}
    </div>
  );
}

export default TableGrid;
