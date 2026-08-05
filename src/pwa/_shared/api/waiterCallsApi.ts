/**
 * Staff API — waiter-calls module (pure, injectable fetch)
 *
 * Covers the mesero board (GET/PATCH/DELETE with auth) and the
 * client "call waiter / request bill" button (POST, no auth).
 */

import { apiFetch, type ApiResult } from './apiFetch';

export interface WaiterCall {
  id: string;
  tableId: string;
  tableNumber: number;
  sessionId: string;
  callType: 'call_waiter' | 'request_bill';
  status: 'pending' | 'accepted' | 'done' | 'cancelled';
  acceptedBy: string | null;
  acceptedAt: string | null;
  createdAt: string;
}

interface ServerCall {
  id: string;
  table_id: string;
  table_number: number;
  session_id: string;
  call_type: 'call_waiter' | 'request_bill';
  status: 'pending' | 'accepted' | 'done' | 'cancelled';
  accepted_by: string | null;
  accepted_at: string | null;
  created_at: string;
}

export interface WaiterCallsResult extends ApiResult<{ calls?: ServerCall[] }> {
  calls: WaiterCall[];
}

function normalizeCall(c: ServerCall): WaiterCall {
  return {
    id: c.id,
    tableId: c.table_id,
    tableNumber: c.table_number,
    sessionId: c.session_id,
    callType: c.call_type,
    status: c.status,
    acceptedBy: c.accepted_by,
    acceptedAt: c.accepted_at,
    createdAt: c.created_at,
  };
}

/** GET /api/waiter-calls — list calls (mesero board) */
export async function fetchWaiterCalls(
  token: string,
  fetchImpl: typeof fetch = fetch
): Promise<WaiterCallsResult> {
  const result = await apiFetch<{ success: boolean; calls?: ServerCall[] }>('/api/waiter-calls', {
    token,
    fetchImpl,
  });

  if (!result.ok || !result.data?.calls) {
    return { ...result, data: null, calls: [] } as WaiterCallsResult;
  }

  return { ...result, calls: result.data.calls.map(normalizeCall) };
}

/** PATCH /api/waiter-calls/:id/accept — accept a call */
export async function acceptCall(
  token: string,
  callId: string,
  fetchImpl: typeof fetch = fetch
): Promise<ApiResult<{ success: boolean; call?: ServerCall }>> {
  return apiFetch<{ success: boolean; call?: ServerCall }>(`/api/waiter-calls/${callId}/accept`, {
    method: 'PATCH',
    token,
    fetchImpl,
  });
}

/** PATCH /api/waiter-calls/:id/done — mark a call done */
export async function completeCall(
  token: string,
  callId: string,
  fetchImpl: typeof fetch = fetch
): Promise<ApiResult<{ success: boolean; call?: ServerCall }>> {
  return apiFetch<{ success: boolean; call?: ServerCall }>(`/api/waiter-calls/${callId}/done`, {
    method: 'PATCH',
    token,
    fetchImpl,
  });
}

/** DELETE /api/waiter-calls/:id — cancel a call (no auth needed) */
export async function cancelCall(
  callId: string,
  fetchImpl: typeof fetch = fetch
): Promise<ApiResult<{ success: boolean }>> {
  return apiFetch<{ success: boolean }>(`/api/waiter-calls/${callId}`, {
    method: 'DELETE',
    fetchImpl,
  });
}

export interface ClientCallPayload {
  /** Opcional — el cliente PWA solo conoce table_number; el servidor resuelve table_id */
  table_id?: string;
  table_number: number;
  session_id: string;
  call_type: 'call_waiter' | 'request_bill';
}

/** POST /api/waiter-calls — client requests waiter/bill (no auth) */
export async function createClientCall(
  payload: ClientCallPayload,
  fetchImpl: typeof fetch = fetch
): Promise<ApiResult<{ success: boolean; call?: ServerCall }>> {
  return apiFetch<{ success: boolean; call?: ServerCall }>('/api/waiter-calls', {
    method: 'POST',
    body: payload,
    fetchImpl,
  });
}

export default { fetchWaiterCalls, acceptCall, completeCall, cancelCall, createClientCall };
