/**
 * Staff API — payments module (pure, injectable fetch)
 *
 * Covers: processPayment (POST /api/payments), closing lifecycle
 * (GET current, POST open, PUT close).
 */

import { apiFetch, type ApiResult } from './apiFetch';

export interface PaymentPayload {
  order_id: string;
  amount: number;
  method: 'cash' | 'qr';
  iva_amount?: number;
  reference?: string;
  notes?: string;
  status?: string;
  /** F3-2: efectivo al centavo — lo que el cliente ENTREGA (el server calcula el vuelto) */
  received?: number;
}

export interface ServerPayment {
  id: string;
  order_id: string;
  method: string;
  amount: number;
  iva_amount: number;
  received: number;
  change: number;
  reference: string;
  status: string;
  processed_by: string;
  processed_at: string;
  notes: string;
}

export interface PaymentResult extends ApiResult<{ payment?: ServerPayment }> {
  payment: ServerPayment | null;
  fullyPaid: boolean;
  remaining: number;
}

/** POST /api/payments — register a payment (split or full) */
export async function processPayment(
  token: string,
  payload: PaymentPayload,
  fetchImpl: typeof fetch = fetch
): Promise<PaymentResult> {
  const result = await apiFetch<{
    success: boolean;
    payment?: ServerPayment;
    fully_paid?: boolean;
    remaining?: number;
  }>('/api/payments', {
    method: 'POST',
    token,
    body: payload,
    fetchImpl,
  });

  if (!result.ok || !result.data?.payment) {
    return {
      ...result,
      data: null,
      payment: null,
      fullyPaid: false,
      remaining: 0,
    } as PaymentResult;
  }

  return {
    ...result,
    payment: result.data.payment,
    fullyPaid: result.data.fully_paid === true,
    remaining: result.data.remaining ?? 0,
  };
}

// ============================================================
// Closing (Corte de Caja)
// ============================================================

export interface ServerClosing {
  id: string;
  closing_date?: string;
  opened_at: string;
  closed_at: string | null;
  opened_by?: string;
  closed_by?: string;
  expected_cash?: number;
  actual_cash?: number;
  cash_difference?: number;
  expected?: number;
  actual?: number;
  difference?: number;
  is_reconciled?: number;
  notes?: string;
}

export interface ClosingCurrentResult extends ApiResult<{
  closing?: ServerClosing | null;
  today?: { date: string; total: number; payments: unknown[] };
}> {
  closing: ServerClosing | null;
  today: { date: string; total: number; payments: unknown[] } | null;
}

/** GET /api/payments/closing/current — current open closing + today summary */
export async function fetchClosingCurrent(
  token: string,
  fetchImpl: typeof fetch = fetch
): Promise<ClosingCurrentResult> {
  const result = await apiFetch<{
    success: boolean;
    closing?: ServerClosing | null;
    today?: { date: string; total: number; payments: unknown[] };
  }>('/api/payments/closing/current', { token, fetchImpl });

  if (!result.ok || !result.data) {
    return { ...result, data: null, closing: null, today: null } as ClosingCurrentResult;
  }

  return {
    ...result,
    closing: result.data.closing ?? null,
    today: result.data.today ?? null,
  };
}

/** POST /api/payments/closing — open a cash closing */
export async function openClosing(
  token: string,
  openingBalance = 0,
  fetchImpl: typeof fetch = fetch
): Promise<ApiResult<{ success: boolean; closing?: ServerClosing }>> {
  return apiFetch<{ success: boolean; closing?: ServerClosing }>('/api/payments/closing', {
    method: 'POST',
    token,
    body: { opening_balance: openingBalance },
    fetchImpl,
  });
}

/** PUT /api/payments/closing/close — close the open closing */
export async function closeClosing(
  token: string,
  actualCash: number,
  isReconciled = false,
  notes = '',
  fetchImpl: typeof fetch = fetch
): Promise<ApiResult<{ success: boolean; closing?: ServerClosing }>> {
  return apiFetch<{ success: boolean; closing?: ServerClosing }>('/api/payments/closing/close', {
    method: 'PUT',
    token,
    body: { actual_cash: actualCash, is_reconciled: isReconciled, notes },
    fetchImpl,
  });
}

export default { processPayment, fetchClosingCurrent, openClosing, closeClosing };
