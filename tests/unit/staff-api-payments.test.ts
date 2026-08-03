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
    const result = await closeClosing('tok-1', 520, false, '', fetchMock as unknown as typeof fetch);
    expect(result.ok).toBe(true);
    expect(result.data?.closing?.actual).toBe(520);
    expect(result.data?.closing?.difference).toBe(20);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ actual_cash: 520, is_reconciled: false, notes: '' });
  });

  it('closes with notes + reconciled flag', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ success: true, closing: { id: 'c1' } }));
    const result = await closeClosing('tok-1', 510, true, 'Faltante en caja', fetchMock as unknown as typeof fetch);
    expect(result.ok).toBe(true);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({
      actual_cash: 510,
      is_reconciled: true,
      notes: 'Faltante en caja',
    });
  });
});
