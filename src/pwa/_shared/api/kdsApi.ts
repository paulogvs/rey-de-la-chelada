/**
 * KDS API — fetch inicial del KDS (cocina/bar) con token de staff.
 *
 * FASE 1: antes el KDS dependía 100% del WebSocket y al refrescar
 * quedaba vacío. Ahora cada pantalla KDS hace GET /api/orders/kds/:module
 * con su token (rol kds/admin) para poblar el engine al montar, y el
 * WebSocket mantiene el real-time.
 *
 * Pure + injectable fetch (unit-testable en node).
 */

import { apiFetch, type ApiResult } from './apiFetch';
import { normalizeServerItem } from '../hooks/useKDSWebSocket';
import type { Order } from '@/core/types';

export interface ServerKDSOrderRow {
  id: string;
  table_id: string;
  table_number: number;
  status: string;
  notes: string | null;
  created_at: string;
  waiter_id: string | null;
  waiter_name_resolved: string | null;
  items?: Array<Record<string, unknown>>;
}

export type KDSModule = 'cocina' | 'bar';

export interface KDSOrdersResult extends ApiResult<{ orders?: ServerKDSOrderRow[] }> {
  orders: Order[];
}

/** Normaliza una fila KDS del servidor a un Order del engine (camelCase). */
export function normalizeKDSOrder(row: ServerKDSOrderRow): Order | null {
  if (!row || typeof row.id !== 'string' || row.id === '') return null;

  const items = (row.items || [])
    .map(normalizeServerItem)
    .filter((i): i is NonNullable<typeof i> => i !== null);

  return {
    id: row.id,
    tableId: row.table_id || `table-${row.table_number ?? 0}`,
    tableNumber: row.table_number ?? 0,
    waiterId: row.waiter_id || '',
    waiterName: row.waiter_name_resolved || '',
    items,
    status: (row.status as Order['status']) || 'confirmed',
    subtotal: 0,
    ivaAmount: 0,
    discount: 0,
    discountReason: '',
    total: 0,
    paymentMethod: null,
    paymentReference: null,
    isPaid: false,
    paidAt: null,
    notes: row.notes || '',
    guestCount: 1,
    createdAt: row.created_at || new Date().toISOString(),
    updatedAt: row.created_at || new Date().toISOString(),
    syncedAt: null,
    localId: row.id,
  };
}

/**
 * GET /api/orders/kds/:module — snapshot inicial del KDS para el módulo.
 * Requiere token de rol 'kds' o 'admin'.
 */
export async function fetchKDSOrders(
  token: string,
  module: KDSModule,
  fetchImpl: typeof fetch = fetch
): Promise<KDSOrdersResult> {
  const result = await apiFetch<{ success: boolean; orders?: ServerKDSOrderRow[] }>(
    `/api/orders/kds/${module}`,
    { token, fetchImpl }
  );

  if (!result.ok || !result.data?.orders) {
    return { ...result, data: null, orders: [] } as KDSOrdersResult;
  }

  const orders = result.data.orders
    .map(normalizeKDSOrder)
    .filter((o): o is Order => o !== null);

  return { ...result, data: { orders: result.data.orders }, orders };
}

export default { fetchKDSOrders, normalizeKDSOrder };
