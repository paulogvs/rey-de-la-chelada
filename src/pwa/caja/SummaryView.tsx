/**
 * Caja — SummaryView (API-driven daily report)
 *
 * Fetches GET /api/reports/sales/daily and renders:
 *   - Metric cards: ventas del día, ticket promedio, IVA, pedidos
 *   - Sales by payment method (bar chart, token-driven)
 */

import React, { useState, useEffect, useCallback } from 'react';
import { fetchDailySales, type DailySales } from '../_shared/api/reportsApi';
import { Card, CardSkeleton } from '@/ui/components/Card';
import { Button } from '@/ui/components/Button';
import { StatCard } from '@/ui/components/StatCard';
import { useToast } from '@/ui/components/Toast';
import { AppIcon } from '@/ui/components/AppIcon/AppIcon';
import { buildDailySalesCsv, downloadCsv, dailyCsvFilename } from '../_shared/utils/csvExport';
import { METHOD_LABELS, methodIcon } from '../_shared/utils/paymentMethods';
import { formatMoney } from '../_shared/utils/format';

interface SummaryViewProps {
  token: string;
  today: string;
  ivaRate: number;
  refreshTick: number;
}

export function SummaryView({ token, today, ivaRate, refreshTick }: SummaryViewProps) {
  const { addToast } = useToast();
  const [summary, setSummary] = useState<DailySales | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const result = await fetchDailySales(token, today, ivaRate);
    if (!result.ok || !result.daily) {
      setError(result.error || 'No se pudo cargar el reporte diario');
      setLoading(false);
      return;
    }
    setSummary(result.daily);
    setError(null);
    setLoading(false);
  }, [token, today, ivaRate]);

  useEffect(() => {
    load();
    const interval = setInterval(load, 30000);
    return () => clearInterval(interval);
  }, [load, refreshTick]);

  // Client-side CSV export (no dependencies) — BOM for Excel
  const handleExportCsv = useCallback(() => {
    if (!summary) return;
    setExporting(true);
    try {
      const csv = buildDailySalesCsv(summary, ivaRate);
      downloadCsv(dailyCsvFilename(summary.date), csv);
      addToast({ type: 'success', message: 'Reporte CSV exportado', duration: 3000 });
    } catch (err) {
      console.error('[SummaryView] CSV export error:', err);
      addToast({ type: 'error', message: 'Error al exportar CSV', duration: 4000 });
    } finally {
      setExporting(false);
    }
  }, [summary, ivaRate, addToast]);

  if (loading && !summary) {
    return (
      <div className="caja-summary">
        <div className="caja-summary__grid">
          {[1, 2, 3, 4].map(i => <CardSkeleton key={i} />)}
        </div>
      </div>
    );
  }

  if (error || !summary) {
    return (
      <div className="caja-summary">
        <Card className="caja-empty">
          <p>{error || 'No hay datos de ventas para hoy'}</p>
        </Card>
      </div>
    );
  }

  const { byMethod, totalSales } = summary;
  const methodEntries = Object.entries(byMethod);

  return (
    <div className="caja-summary">
      <div className="caja-summary__toolbar">
        <Button variant="secondary" size="sm" onClick={handleExportCsv} loading={exporting} disabled={!summary}>
          <AppIcon name="download" size="sm" /> Exportar CSV
        </Button>
      </div>
      <div className="caja-summary__grid">
        <StatCard
          label="Ventas del día"
          value={<span className="caja-stat caja-stat--gross">{formatMoney(totalSales)}</span>}
          delta={`${summary.totalOrders} pedidos · ${summary.completedOrders} pagados`}
          icon={<AppIcon name="wallet" size="lg" />}
        />

        <StatCard
          label="Ticket promedio"
          value={<span className="caja-stat">{formatMoney(summary.averageTicket)}</span>}
          delta={`Venta bruta: ${formatMoney(summary.grossRevenue)}`}
        />

        <StatCard
          label={`IVA ${Math.round(ivaRate * 100)}%`}
          value={<span className="caja-stat caja-stat--iva">{formatMoney(summary.totalIva)}</span>}
          delta={`Base imponible: ${formatMoney(summary.baseRevenue)}`}
        />

        <StatCard
          label="Pedidos"
          value={<span className="caja-stat caja-stat--orders">{summary.totalOrders}</span>}
          delta={`${summary.cancelledOrders} cancelados`}
          icon={<AppIcon name="receipt" size="lg" />}
        />
      </div>

      <Card className="caja-methods">
        <h3>Ventas por método de pago</h3>
        {methodEntries.length === 0 ? (
          <p className="caja-methods__empty">Sin pagos registrados hoy</p>
        ) : (
          <div className="caja-methods__list">
            {methodEntries.map(([method, amount]) => (
              <div key={method} className="caja-methods__item">
                <span className="caja-methods__label">
                  <AppIcon name={methodIcon(method)} size="sm" />{' '}
                  {method === 'cash' ? 'Efectivo (físico — cajón)' : method === 'qr' ? 'QR (digital — depositado)' : (METHOD_LABELS[method] || method)}
                </span>
                <div className="caja-methods__bar">
                  <div
                    className="caja-methods__bar-fill"
                    style={{
                      width: `${totalSales > 0 ? (amount / totalSales) * 100 : 0}%`,
                    }}
                  />
                </div>
                <span className="caja-methods__amount">
                  {formatMoney(amount)}
                </span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

export default SummaryView;
