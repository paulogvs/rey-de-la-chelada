/**
 * Staff API — tables module (pure, injectable fetch)
 *
 * Maps server snake_case rows to client Table type (camelCase).
 * Uses PUT /api/tables/:id for status updates (server contract).
 */

import { apiFetch, type ApiResult } from './apiFetch';

/** Server table row (snake_case) */
export interface ServerTable {
  id: string;
  number: number;
  capacity: number;
  status: string;
  current_order_id: string | null;
  assigned_waiter_id: string | null;
  section: string;
  position: number;
  notes?: string;
}

export interface Table {
  id: string;
  number: number;
  capacity: number;
  status: string;
  currentOrderId: string | null;
  assignedWaiterId: string | null;
  section: string;
  position: number;
  notes: string;
}

export interface TablesResult extends ApiResult<{ tables: ServerTable[] }> {
  tables: Table[];
}

function normalizeTable(t: ServerTable): Table {
  return {
    id: t.id,
    number: t.number,
    capacity: t.capacity,
    status: t.status,
    currentOrderId: t.current_order_id,
    assignedWaiterId: t.assigned_waiter_id,
    section: t.section,
    position: t.position,
    notes: t.notes ?? '',
  };
}

/** GET /api/tables — list tables (normalized) */
export async function fetchTables(
  token: string,
  fetchImpl: typeof fetch = fetch
): Promise<TablesResult> {
  const result = await apiFetch<{ success: boolean; tables?: ServerTable[] }>('/api/tables', {
    token,
    fetchImpl,
  });

  if (!result.ok || !result.data?.tables) {
    return { ...result, tables: [] };
  }

  return { ...result, tables: result.data.tables.map(normalizeTable) };
}

export interface TableResult extends ApiResult<{ table: Table }> {
  table: Table | null;
}

/** GET /api/tables/:id — single table */
export async function fetchTableById(
  token: string,
  tableId: string,
  fetchImpl: typeof fetch = fetch
): Promise<TableResult> {
  const result = await apiFetch<{ success: boolean; table?: ServerTable }>(`/api/tables/${tableId}`, {
    token,
    fetchImpl,
  });

  if (!result.ok || !result.data?.table) {
    return { ...result, data: null, table: null } as TableResult;
  }

  const table = normalizeTable(result.data.table);
  return { ...result, data: { table }, table };
}

/** PUT /api/tables/:id — update status/section/waiter */
export async function updateTableStatus(
  token: string,
  tableId: string,
  status: string,
  fetchImpl: typeof fetch = fetch
): Promise<TableResult> {
  const result = await apiFetch<{ success: boolean; table?: ServerTable }>(`/api/tables/${tableId}`, {
    method: 'PUT',
    token,
    body: { status },
    fetchImpl,
  });

  if (!result.ok || !result.data?.table) {
    return { ...result, data: null, table: null } as TableResult;
  }

  const table = normalizeTable(result.data.table);
  return { ...result, data: { table }, table };
}

/** POST /api/tables — create a table (admin) */
export async function createTable(
  token: string,
  payload: { number: number; capacity: number; section?: string },
  fetchImpl: typeof fetch = fetch
): Promise<TableResult> {
  const result = await apiFetch<{ success: boolean; table?: ServerTable }>('/api/tables', {
    method: 'POST',
    token,
    body: payload,
    fetchImpl,
  });

  if (!result.ok || !result.data?.table) {
    return { ...result, data: null, table: null } as TableResult;
  }

  const table = normalizeTable(result.data.table);
  return { ...result, data: { table }, table };
}

/** DELETE /api/tables/:id — remove a table (admin, no active orders) */
export async function deleteTable(
  token: string,
  tableId: string,
  fetchImpl: typeof fetch = fetch
): Promise<ApiResult<{ message?: string }>> {
  return apiFetch<{ success: boolean; message?: string }>(`/api/tables/${tableId}`, {
    method: 'DELETE',
    token,
    fetchImpl,
  });
}

export default { fetchTables, fetchTableById, updateTableStatus, createTable, deleteTable };
