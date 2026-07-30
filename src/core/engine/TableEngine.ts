/**
 * TABLE ENGINE — SSOT for all table operations
 * 
 * Artículo I: SSOT — Every table state change passes through here
 * Artículo II: ZERO HARDCODED — No positions, no hardcoded layout
 * 
 * Tables are LOGICAL ENTITIES, not visual positions.
 * The layout can be reconfigured via TableConfig at any time.
 */

import type { Table, TableConfig, TableStatus, TableDisplay } from '../types';

// ============================================================
// DEFAULT CONFIG
// ============================================================

const DEFAULT_CONFIG: TableConfig = {
  totalTables: 10,
  numberingStyle: 'sequential',
  sections: ['interior'],
  defaultCapacity: 4,
  gridColumns: 5,
};

// ============================================================
// TABLE ENGINE
// ============================================================

class TableEngine {
  private tables: Map<string, Table> = new Map();
  private config: TableConfig;
  private listeners: Set<() => void> = new Set();

  constructor(config?: Partial<TableConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this._initializeTables();
  }

  /** Initialize tables from config */
  private _initializeTables(): void {
    for (let i = 1; i <= this.config.totalTables; i++) {
      const sectionIndex = Math.floor((i - 1) / Math.ceil(this.config.totalTables / this.config.sections.length));
      const table: Table = {
        id: `table-${i}`,
        number: i,
        capacity: this.config.defaultCapacity,
        status: 'free',
        currentOrderId: null,
        assignedWaiterId: null,
        section: this.config.sections[sectionIndex] || this.config.sections[0],
        position: i,
        notes: '',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      this.tables.set(table.id, table);
    }
  }

  /** Get current configuration */
  getConfig(): TableConfig {
    return { ...this.config };
  }

  /** Update configuration (reinitializes tables) */
  updateConfig(newConfig: Partial<TableConfig>): void {
    const oldTotal = this.config.totalTables;
    this.config = { ...this.config, ...newConfig };

    if (newConfig.totalTables && newConfig.totalTables !== oldTotal) {
      this._initializeTables();
    }

    this._notify();
  }

  /** Get all tables sorted by position */
  getAllTables(): Table[] {
    return Array.from(this.tables.values())
      .sort((a, b) => a.position - b.position);
  }

  /** Get tables by section */
  getTablesBySection(section: string): Table[] {
    return this.getAllTables().filter(t => t.section === section);
  }

  /** Get a single table by ID */
  getTable(tableId: string): Table | undefined {
    return this.tables.get(tableId);
  }

  /** Get a single table by number */
  getTableByNumber(number: number): Table | undefined {
    return Array.from(this.tables.values()).find(t => t.number === number);
  }

  /** Set table status */
  setTableStatus(tableId: string, status: TableStatus, userId?: string): boolean {
    const table = this.tables.get(tableId);
    if (!table) return false;

    table.status = status;
    table.updatedAt = new Date().toISOString();
    if (userId) table.assignedWaiterId = userId;

    this._notify();
    return true;
  }

  /** Assign a waiter to a table */
  assignWaiter(tableId: string, waiterId: string): boolean {
    const table = this.tables.get(tableId);
    if (!table) return false;

    table.assignedWaiterId = waiterId;
    table.updatedAt = new Date().toISOString();
    this._notify();
    return true;
  }

  /** Link an order to a table */
  assignOrder(tableId: string, orderId: string): boolean {
    const table = this.tables.get(tableId);
    if (!table) return false;

    table.currentOrderId = orderId;
    table.status = 'occupied';
    table.updatedAt = new Date().toISOString();
    this._notify();
    return true;
  }

  /** Clear order from table (after payment) */
  clearTable(tableId: string): boolean {
    const table = this.tables.get(tableId);
    if (!table) return false;

    table.currentOrderId = null;
    table.status = 'free';
    table.assignedWaiterId = null;
    table.updatedAt = new Date().toISOString();
    this._notify();
    return true;
  }

  /** Get tables for display (with computed display info) */
  getTableDisplays(): TableDisplay[] {
    return this.getAllTables().map(table => ({
      table,
      orderCount: table.currentOrderId ? 1 : 0,
      totalPending: 0,  // Calculated by OrderEngine
      timeSinceLastActivity: 0,  // Calculated
    }));
  }

  /** Free tables count */
  getFreeTablesCount(): number {
    return Array.from(this.tables.values()).filter(t => t.status === 'free').length;
  }

  /** Occupied tables count */
  getOccupiedTablesCount(): number {
    return Array.from(this.tables.values()).filter(t => 
      ['occupied', 'ordered', 'serving', 'payment'].includes(t.status)
    ).length;
  }

  /** Reorder table positions (admin: reconfigure layout without losing data) */
  reorderPositions(tableIds: string[]): boolean {
    if (tableIds.length !== this.tables.size) return false;

    tableIds.forEach((id, index) => {
      const table = this.tables.get(id);
      if (table) {
        table.position = index + 1;
        table.updatedAt = new Date().toISOString();
      }
    });

    this._notify();
    return true;
  }

  /** Subscribe to table changes */
  onChange(callback: () => void): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  /** Notify listeners */
  private _notify(): void {
    this.listeners.forEach(cb => cb());
  }

  /** Reset all tables (end of day) */
  resetAll(): void {
    this.tables.forEach((table) => {
      table.status = 'free';
      table.currentOrderId = null;
      table.assignedWaiterId = null;
      table.updatedAt = new Date().toISOString();
    });
    this._notify();
  }

  /** Export table state for sync */
  exportState(): Table[] {
    return this.getAllTables();
  }

  /** Import table state from sync */
  importState(tables: Table[]): void {
    tables.forEach(table => {
      this.tables.set(table.id, table);
    });
    this._notify();
  }
}

// Singleton
const tableEngine = new TableEngine();
export default tableEngine;
export { TableEngine };
