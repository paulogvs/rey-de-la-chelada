/**
 * Staff API — reports module (pure, injectable fetch)
 *
 * Covers: daily sales report (GET /api/reports/sales/daily).
 * Re-exports closing lifecycle from paymentsApi for the caja (cashier) PWA.
 */

import { apiFetch, type ApiResult } from './apiFetch';
import { fetchClosingCurrent, openClosing, closeClosing, type ServerClosing } from './paymentsApi';
import { computeTotals } from '@/core/config/iva';

export { fetchClosingCurrent, openClosing, closeClosing };
export type { ServerClosing };

export interface DailySales {
  date: string;
  totalOrders: number;
  completedOrders: number;
  cancelledOrders: number;
  grossRevenue: number;
  totalSales: number; // net_revenue (paid orders only)
  totalIva: number; // IVA included in totalSales (derived from ivaRate)
  baseRevenue: number; // totalSales - totalIva
  averageTicket: number;
  byMethod: Record<string, number>; // method -> total
  hourly: { hour: number; orders: number; revenue: number }[];
}

export interface DailySalesResult extends ApiResult<{ daily?: DailySales }> {
  daily: DailySales | null;
}

interface ServerDailyReport {
  success: boolean;
  date: string;
  summary?: {
    total_orders: number;
    completed_orders: number;
    cancelled_orders: number;
    gross_revenue: number;
    net_revenue: number;
  };
  by_payment_method?: { method: string; count: number; total: number }[];
  hourly?: { hour: number; orders: number; revenue: number }[];
}

/** GET /api/reports/sales/daily?date=YYYY-MM-DD — normalized daily report */
export async function fetchDailySales(
  token: string,
  date: string,
  _ivaRate = 0.13,
  fetchImpl: typeof fetch = fetch
): Promise<DailySalesResult> {
  const result = await apiFetch<ServerDailyReport>(
    `/api/reports/sales/daily?date=${encodeURIComponent(date)}`,
    { token, fetchImpl }
  );

  if (!result.ok || !result.data) {
    return { ...result, data: null, daily: null } as DailySalesResult;
  }

  const s = result.data.summary ?? ({} as NonNullable<ServerDailyReport['summary']>);
  const byMethod: Record<string, number> = {};
  for (const p of result.data.by_payment_method ?? []) {
    byMethod[p.method] = p.total;
  }

  // IVA is included in prices (per appConfig.taxes.iva.includedInPrices):
  // totalSales → base = totalSales / (1 + rate), iva = totalSales - base
  const totalSales = s.net_revenue ?? 0;
  const { subtotal: baseRevenue, iva: totalIva } = computeTotals(totalSales);

  const daily: DailySales = {
    date: result.data.date,
    totalOrders: s.total_orders ?? 0,
    completedOrders: s.completed_orders ?? 0,
    cancelledOrders: s.cancelled_orders ?? 0,
    grossRevenue: s.gross_revenue ?? 0,
    totalSales,
    totalIva,
    baseRevenue,
    averageTicket: (s.completed_orders ?? 0) > 0 ? totalSales / (s.completed_orders ?? 0) : 0,
    byMethod,
    hourly: result.data.hourly ?? [],
  };

  return { ...result, daily } as DailySalesResult;
}

export default { fetchDailySales, fetchClosingCurrent, openClosing, closeClosing };
