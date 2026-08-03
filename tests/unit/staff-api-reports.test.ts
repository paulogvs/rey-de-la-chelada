/**
 * Staff API — reports module (pure, injectable fetch)
 *
 * TDD: tests written before implementation.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  fetchDailySales,
  fetchClosingCurrent,
  openClosing,
  closeClosing,
  type DailySales,
} from '../../src/pwa/_shared/api/reportsApi';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('fetchDailySales', () => {
  it('normalizes server daily report to client shape', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      success: true,
      date: '2026-08-01',
      summary: {
        total_orders: 12,
        completed_orders: 10,
        cancelled_orders: 2,
        gross_revenue: 500,
        net_revenue: 450,
      },
      by_payment_method: [
        { method: 'cash', count: 8, total: 300 },
        { method: 'qr_yape', count: 4, total: 200 },
      ],
      hourly: [],
    }));

    const result = await fetchDailySales('tok-1', '2026-08-01', 0.13, fetchMock as unknown as typeof fetch);

    expect(result.ok).toBe(true);
    const d: DailySales = result.daily!;
    expect(d.date).toBe('2026-08-01');
    expect(d.totalOrders).toBe(12);
    expect(d.completedOrders).toBe(10);
    expect(d.totalSales).toBe(450); // net_revenue (paid only)
    expect(d.grossRevenue).toBe(500);
    expect(d.byMethod).toEqual({ cash: 300, qr_yape: 200 });
    expect(d.averageTicket).toBeCloseTo(45, 5); // 450 / 10
    // IVA included in prices: iva = total - total/(1+rate)
    expect(d.totalIva).toBeCloseTo(51.77, 2); // 450 - 450/1.13
    expect(d.baseRevenue).toBeCloseTo(398.23, 2); // 450/1.13
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/reports/sales/daily?date=2026-08-01'),
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer tok-1' }) })
    );
  });
});

describe('fetchClosingCurrent', () => {
  it('returns open closing + today summary', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      success: true,
      closing: { id: 'c1', opened_at: '2026-08-01T08:00:00.000Z', closed_at: null },
      today: { date: '2026-08-01', total: 500, payments: [{ method: 'cash', count: 8, total: 300 }] },
    }));
    const result = await fetchClosingCurrent('tok-1', fetchMock as unknown as typeof fetch);
    expect(result.ok).toBe(true);
    expect(result.closing?.id).toBe('c1');
    expect(result.today?.total).toBe(500);
  });
});

describe('openClosing / closeClosing', () => {
  it('POSTs open closing', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ success: true, closing: { id: 'c2' } }, 201));
    const result = await openClosing('tok-1', 0, fetchMock as unknown as typeof fetch);
    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith('/api/payments/closing', expect.objectContaining({ method: 'POST' }));
  });

  it('PUTs close closing with actual cash', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      success: true,
      closing: { id: 'c1', actual: 520, difference: 20 },
    }));
    const result = await closeClosing('tok-1', 520, false, '', fetchMock as unknown as typeof fetch);
    expect(result.ok).toBe(true);
    expect(result.data?.closing?.difference).toBe(20);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ actual_cash: 520, is_reconciled: false, notes: '' });
  });
});
