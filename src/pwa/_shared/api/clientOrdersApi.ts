/**
 * Public Client Orders API — used by the clientes PWA (no JWT).
 *
 * "El pedido activo es el permiso": table_number + session_id are the
 * permission. These functions are public and injectable so they can be
 * unit-tested in node.
 *
 * Convention mirrors apiFetch: normalized result objects.
 */

import type { ApiResult } from './apiFetch';
import { apiFetch } from './apiFetch';

export interface ClientOrderItemInput {
  menu_item_id: string;
  quantity: number;
  /** Selected modifier options: [{ option_id }] (pizza sizes, extras…) */
  modifiers?: Array<{ option_id: string }>;
  notes?: string;
}

export interface CreateClientOrderInput {
  table_number: number;
  session_id: string;
  items: ClientOrderItemInput[];
  guest_count?: number;
  notes?: string;
}

export interface ClientOrderCreated {
  success: boolean;
  orderId: string;
  status: string;
  total: number;
}

export interface ClientOrderStatus {
  success: boolean;
  status: string;
  tableNumber: number;
  total: number;
  items: Array<{ name: string; quantity: number; subtotal: number }>;
  updatedAt: string | null;
}

/**
 * Create a public order from the digital menu (POST /api/client-orders).
 * The order is created in 'called' status + a call_waiter is queued.
 */
export async function createClientOrder(
  input: CreateClientOrderInput,
  fetchImpl: typeof fetch = fetch
): Promise<ApiResult<ClientOrderCreated>> {
  return apiFetch<ClientOrderCreated>('/api/client-orders', {
    method: 'POST',
    body: input,
    fetchImpl,
  });
}

/**
 * Track a public order (GET /api/client-orders/:id).
 * The orderId is the "secret" — no auth required.
 */
export async function getClientOrderStatus(
  orderId: string,
  fetchImpl: typeof fetch = fetch
): Promise<ApiResult<ClientOrderStatus>> {
  const result = await apiFetch<{ success: boolean; order?: ClientOrderStatus }>(
    `/api/client-orders/${encodeURIComponent(orderId)}`,
    { fetchImpl }
  );
  // The route wraps the status under { success, order: {...} } — unwrap it.
  if (!result.ok || !result.data) {
    return { ok: result.ok, status: result.status, code: result.code, error: result.error, data: null };
  }
  return { ok: true, status: result.status, code: null, error: null, data: result.data.order ?? null };
}
