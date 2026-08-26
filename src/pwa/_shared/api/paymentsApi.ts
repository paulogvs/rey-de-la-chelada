/**
 * Staff API — payments module (pure, injectable fetch)
 *
 * Covers: processPayment (POST /api/payments), closing lifecycle
 * (GET current, POST open, PUT close).
 */

import { apiFetch, type ApiResult } from './apiFetch';
import type { PaymentAllocationInput } from '../utils/paymentAllocations';

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
  idempotency_key?: string;
}

export interface MixedPaymentPayload {
  order_id: string;
  idempotency_key: string;
  allocations: PaymentAllocationInput[];
}

export interface MixedPaymentResult extends ApiResult<{
  operation_id: string;
  order_total: number;
  paid_amount: number;
  remaining: number;
  is_fully_paid: boolean;
  by_method: { cash: number; qr: number };
  payments: ServerPayment[];
}> {
  operationId: string | null;
  payments: ServerPayment[];
  remaining: number;
  isFullyPaid: boolean;
  byMethod: { cash: number; qr: number };
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
  proof_photo?: string | null;
  payment_operation_id?: string | null;
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

/** POST /api/payments/mixed — one atomic cash + QR operation. Amounts are cents. */
export async function processMixedPayment(
  token: string,
  payload: MixedPaymentPayload,
  fetchImpl: typeof fetch = fetch
): Promise<MixedPaymentResult> {
  const result = await apiFetch<MixedPaymentResult['data']>('/api/payments/mixed', {
    method: 'POST', token, body: payload, fetchImpl,
  });
  if (!result.ok || !result.data) {
    return { ...result, data: null, operationId: null, payments: [], remaining: 0, isFullyPaid: false, byMethod: { cash: 0, qr: 0 } } as MixedPaymentResult;
  }
  return {
    ...result,
    operationId: result.data.operation_id,
    payments: result.data.payments ?? [],
    remaining: result.data.remaining,
    isFullyPaid: result.data.is_fully_paid,
    byMethod: result.data.by_method,
  };
}

export interface PaymentListFilters {
  orderId?: string;
  dateFrom?: string;
  dateTo?: string;
  method?: 'cash' | 'qr';
}

export interface PaymentListResult extends ApiResult<{ payments: ServerPayment[]; count: number }> {
  payments: ServerPayment[];
}

/** GET /api/payments — authenticated financial summary source. Amounts are cents. */
export async function fetchPayments(
  token: string,
  filters: PaymentListFilters = {},
  fetchImpl: typeof fetch = fetch
): Promise<PaymentListResult> {
  const query = new URLSearchParams();
  if (filters.orderId) query.set('order_id', filters.orderId);
  if (filters.dateFrom) query.set('date_from', filters.dateFrom);
  if (filters.dateTo) query.set('date_to', filters.dateTo);
  if (filters.method) query.set('method', filters.method);
  const suffix = query.toString() ? `?${query.toString()}` : '';
  const result = await apiFetch<{ success: boolean; payments?: ServerPayment[]; count?: number }>(`/api/payments${suffix}`, { token, fetchImpl });
  return { ...result, payments: result.data?.payments ?? [] } as PaymentListResult;
}

export interface PaymentProofMetadata {
  id: string;
  payment_id: string;
  storage_key: string;
  mime: string;
  size: number;
  hash: string;
  status: string;
  reviewer?: string | null;
  created_at: string;
  updated_at: string;
}

export async function fetchPaymentProof(
  token: string,
  paymentId: string,
  fetchImpl: typeof fetch = fetch
): Promise<ApiResult<{ success: boolean; proof: PaymentProofMetadata }>> {
  return apiFetch<{ success: boolean; proof: PaymentProofMetadata }>(`/api/payments/${paymentId}/proof`, { token, fetchImpl });
}

export interface FinancialSummary {
  date: string;
  total: number;
  cash: number;
  receivedTotal: number;
  changeTotal: number;
  payments: { method: string; count: number; total: number }[];
}

/** GET /api/payments/closing/current — authenticated server financial summary. */
export async function fetchFinancialSummary(
  token: string,
  fetchImpl: typeof fetch = fetch
): Promise<ApiResult<{ summary: FinancialSummary | null }>> {
  const result = await apiFetch<{
    success: boolean;
    today?: { date: string; total: number; cash?: number; received_total?: number; change_total?: number; payments?: { method: string; count: number; total: number }[] };
  }>('/api/payments/closing/current', { token, fetchImpl });
  const today = result.data?.today;
  return {
    ...result,
    data: result.ok && today ? {
      summary: {
        date: today.date,
        total: today.total,
        cash: today.cash ?? 0,
        receivedTotal: today.received_total ?? 0,
        changeTotal: today.change_total ?? 0,
        payments: today.payments ?? [],
      },
    } : { summary: null },
  } as ApiResult<{ summary: FinancialSummary | null }>;
}

/** POST /api/payments/:id/proof — sube el comprobante foto del pago QR (FASE 5).
 *  `image` es un data URL: "data:image/jpeg;base64,...." (se guarda en el server). */
export async function uploadPaymentProof(
  token: string,
  paymentId: string,
  image: string,
  fetchImpl: typeof fetch = fetch
): Promise<ApiResult<{ success: boolean; proof_photo?: string; message?: string }>> {
  return apiFetch<{ success: boolean; proof_photo?: string; message?: string }>(
    `/api/payments/${paymentId}/proof`,
    {
      method: 'POST',
      token,
      body: { image },
      fetchImpl,
    }
  );
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
  // v13 (2026-08-25): desglose completo del cierre
  opening_cash?: number;
  expenses_cash?: number;
  expenses_qr?: number;
  expected_qr?: number;
  total_general?: number;
  transactions?: number;
}

/** Desglose vivo del día laboral (v13) — devuelto por /closing/current */
export interface ClosingBreakdown {
  opening_cash: number;
  cash_today: number;
  qr_today: number;
  total_general: number;
  transactions: number;
  expenses_cash: number;
  expenses_qr: number;
  expected_cash: number;
  expected_qr: number;
}

export interface ClosingCurrentResult extends ApiResult<{
  closing?: ServerClosing | null;
  today?: { date: string; total: number; payments: unknown[] };
  breakdown?: ClosingBreakdown;
}> {
  closing: ServerClosing | null;
  today: { date: string; total: number; payments: unknown[] } | null;
  breakdown: ClosingBreakdown | null;
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
    breakdown?: ClosingBreakdown;
  }>('/api/payments/closing/current', { token, fetchImpl });

  if (!result.ok || !result.data) {
    return { ...result, data: null, closing: null, today: null, breakdown: null } as ClosingCurrentResult;
  }

  return {
    ...result,
    closing: result.data.closing ?? null,
    today: result.data.today ?? null,
    breakdown: result.data.breakdown ?? null,
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

/** PUT /api/payments/closing/close — close the open closing (v13: + gastos) */
export async function closeClosing(
  token: string,
  actualCash: number,
  opts: { isReconciled?: boolean; notes?: string; expensesCash?: number; expensesQr?: number } = {},
  fetchImpl: typeof fetch = fetch
): Promise<ApiResult<{ success: boolean; closing?: ServerClosing }>> {
  const { isReconciled = false, notes = '', expensesCash = 0, expensesQr = 0 } = opts;
  return apiFetch<{ success: boolean; closing?: ServerClosing }>('/api/payments/closing/close', {
    method: 'PUT',
    token,
    body: {
      actual_cash: actualCash,
      is_reconciled: isReconciled,
      notes,
      expenses_cash: expensesCash,
      expenses_qr: expensesQr,
    },
    fetchImpl,
  });
}

export default { processPayment, processMixedPayment, fetchPayments, fetchPaymentProof, fetchFinancialSummary, uploadPaymentProof, fetchClosingCurrent, openClosing, closeClosing };
