/**
 * Staff API — payments module (pure, injectable fetch)
 *
 * TDD: tests written before implementation.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  processPayment,
  fetchClosingCurrent,
  openClosing,
  closeClosing,
  processMixedPayment,
  fetchPayments,
  fetchPaymentProof,
  fetchFinancialSummary,
  uploadPaymentProof,
  fetchProofImageBlob,
  loadProofImage,
  type PaymentPayload,
  type PaymentResult,
} from '../../src/pwa/_shared/api/paymentsApi';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('processPayment', () => {
  it('POSTs payment and returns payment + fully_paid flag', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      success: true,
      payment: { id: 'p1', order_id: 'o1', method: 'cash', amount: 45.2 },
      fully_paid: true,
      remaining: 0,
    }, 201));
    const payload: PaymentPayload = { order_id: 'o1', amount: 45.2, method: 'cash' };

    const result = await processPayment('tok-1', payload, fetchMock as unknown as typeof fetch);

    expect(result.ok).toBe(true);
    expect(result.payment).toMatchObject({ id: 'p1', amount: 45.2 });
    expect(result.fullyPaid).toBe(true);
    expect(result.remaining).toBe(0);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual(payload);
  });

  it('returns conflict error when amount exceeds remaining', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ success: false, error: 'El monto excede el saldo', code: 'PAYMENT_CONFLICT' }, 409)
    );
    const result: PaymentResult = await processPayment('tok-1', { order_id: 'o1', amount: 999, method: 'cash' }, fetchMock as unknown as typeof fetch);
    expect(result.ok).toBe(false);
    expect(result.code).toBe('PAYMENT_CONFLICT');
    expect(result.payment).toBeNull();
  });
});

describe('financial mixed payment API', () => {
  it('POSTs mixed allocations in cents and normalizes the server result', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      success: true,
      operation_id: 'op-1',
      payments: [{ id: 'p-cash', method: 'cash', amount: 4000 }],
      by_method: { cash: 4000, qr: 6000 },
      remaining: 0,
      is_fully_paid: true,
    }, 201));
    const result = await processMixedPayment('tok-1', {
      order_id: 'o1',
      idempotency_key: 'op-client-1',
      allocations: [
        { method: 'cash', amount: 4000, received: 5000 },
        { method: 'qr', amount: 6000, reference: 'bank-1' },
      ],
    }, fetchMock as unknown as typeof fetch);

    expect(result.ok).toBe(true);
    expect(result.isFullyPaid).toBe(true);
    expect(result.byMethod).toEqual({ cash: 4000, qr: 6000 });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/payments/mixed');
    expect(JSON.parse(init.body as string)).toEqual(expect.objectContaining({
      order_id: 'o1', idempotency_key: 'op-client-1',
    }));
  });

  it('lists payments and fetches proof metadata through authenticated clients', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ success: true, payments: [{ id: 'p1', amount: 100 }] }))
      .mockResolvedValueOnce(jsonResponse({ success: true, proof: { payment_id: 'p1', status: 'pending' } }));
    const payments = await fetchPayments('tok-1', { orderId: 'o1' }, fetchMock as unknown as typeof fetch);
    const proof = await fetchPaymentProof('tok-1', 'p1', fetchMock as unknown as typeof fetch);
    expect(payments.data?.payments).toHaveLength(1);
    expect(proof.data?.proof.status).toBe('pending');
    expect((fetchMock.mock.calls[0] as [string])[0]).toContain('order_id=o1');
  });

  it('normalizes server financial summary and keeps proof upload independently observable', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ success: true, today: {
        date: '2026-08-21', total: 10000, cash: 4000, received_total: 5000, change_total: 1000,
        payments: [{ method: 'cash', count: 1, total: 4000 }, { method: 'qr', count: 1, total: 6000 }],
      } }))
      .mockResolvedValueOnce(jsonResponse({ success: false, error: 'proof unavailable', code: 'PROOF_UPLOAD_ERROR' }, 500));
    const summary = await fetchFinancialSummary('tok-1', fetchMock as unknown as typeof fetch);
    const proofUpload = await uploadPaymentProof('tok-1', 'p-qr', 'data:image/jpeg;base64,abc', fetchMock as unknown as typeof fetch);
    expect(summary.data?.summary).toMatchObject({ total: 10000, cash: 4000, changeTotal: 1000 });
    expect(proofUpload.ok).toBe(false);
    expect(proofUpload.code).toBe('PROOF_UPLOAD_ERROR');
  });
});

describe('fetchClosingCurrent', () => {
  it('returns current closing + today summary', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      success: true,
      closing: { id: 'c1', opened_at: '2026-08-01T08:00:00.000Z', closed_at: null },
      today: { date: '2026-08-01', total: 500, payments: [{ method: 'cash', total: 500 }] },
    }));
    const result = await fetchClosingCurrent('tok-1', fetchMock as unknown as typeof fetch);
    expect(result.ok).toBe(true);
    expect(result.closing?.id).toBe('c1');
    expect(result.today?.total).toBe(500);
  });
});

describe('proof image loading — vista previa del comprobante (Caja/Admin, 2026-08-27)', () => {
  it('fetchProofImageBlob: GET content con Bearer auth y devuelve el Blob', async () => {
    const blob = new Blob(['fake-image-bytes'], { type: 'image/png' });
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(blob, { status: 200, headers: { 'Content-Type': 'image/png' } })
    );
    const result = await fetchProofImageBlob('tok-1', 'pay-1', fetchMock as unknown as typeof fetch);
    expect(result.size).toBe(blob.size);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/payments/pay-1/proof/content');
    expect(init.headers).toMatchObject({ Authorization: 'Bearer tok-1' });
  });

  it('loadProofImage: envuelve el blob en una URL (createObjectURL) y NO toca el server auth', async () => {
    const blob = new Blob(['x'], { type: 'image/png' });
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(blob, { status: 200, headers: { 'Content-Type': 'image/png' } })
    );
    const url = await loadProofImage(
      'tok-1', 'pay-1',
      fetchMock as unknown as typeof fetch,
      (b) => 'blob:preview-' + b.size
    );
    expect(url).toBe('blob:preview-1');
  });

  it('loadProofImage: lanza si el comprobante no está disponible (HTTP no-ok)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: false }), { status: 404, headers: { 'Content-Type': 'application/json' } })
    );
    await expect(
      loadProofImage('tok-1', 'pay-nope', fetchMock as unknown as typeof fetch, (b) => 'blob:x')
    ).rejects.toThrow();
  });
});

describe('openClosing / closeClosing', () => {
  it('opens a closing with opening balance', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      success: true,
      closing: { id: 'c2', opened_by: 'u1' },
    }, 201));
    const result = await openClosing('tok-1', 100, fetchMock as unknown as typeof fetch);
    expect(result.ok).toBe(true);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ opening_balance: 100 });
  });

  it('closes a closing with reconciliation', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      success: true,
      closing: { id: 'c1', closed_at: '2026-08-01T22:00:00.000Z', actual: 520, difference: 20 },
    }));
    const result = await closeClosing('tok-1', 520, { isReconciled: false }, fetchMock as unknown as typeof fetch);
    expect(result.ok).toBe(true);
    expect(result.data?.closing?.actual).toBe(520);
    expect(result.data?.closing?.difference).toBe(20);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ actual_cash: 520, is_reconciled: false, notes: '', expenses_cash: 0, expenses_qr: 0 });
  });

  it('closes with notes + reconciled flag', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ success: true, closing: { id: 'c1' } }));
    const result = await closeClosing('tok-1', 510, { isReconciled: true, notes: 'Faltante en caja' }, fetchMock as unknown as typeof fetch);
    expect(result.ok).toBe(true);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({
      actual_cash: 510,
      is_reconciled: true,
      notes: 'Faltante en caja',
      expenses_cash: 0,
      expenses_qr: 0,
    });
  });
});
