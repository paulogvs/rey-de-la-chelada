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

interface SummaryViewProps {
  token: string;
  today: string;
  ivaRate: number;
  refreshTick: number;
}

const METHOD_LABELS: Record<string, string> = {
  cash: 'Efectivo',
  qr_yape: 'Yape',
  qr_simple: 'QR Simple',
  card: 'Tarjeta',
  transfer: 'Transferencia',
};

const METHOD_ICONS: Record<string, string> = {
  cash: '💵',
  qr_yape: '📱',
  qr_simple: '📱',
  card: '💳',
  transfer: '🏦',
};

export function SummaryView({ token, today, ivaRate, refreshTick }: SummaryViewProps) {
  const [summary, setSummary] = useState<DailySales | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
      <div className="caja-summary__grid">
        <Card status="paid" className="caja-metric">
          <div className="caja-metric__label">Ventas del día</div>
          <div className="caja-metric__value caja-metric__value--gross">
            Bs. {totalSales.toFixed(2)}
          </div>
          <div className="caja-metric__detail">
            <span>{summary.totalOrders} pedidos</span>
            <span>{summary.completedOrders} pagados</span>
          </div>
        </Card>

        <Card className="caja-metric">
          <div className="caja-metric__label">Ticket promedio</div>
          <div className="caja-metric__value">
            Bs. {summary.averageTicket.toFixed(2)}
          </div>
          <div className="caja-metric__detail">
            <span>Venta bruta: Bs. {summary.grossRevenue.toFixed(2)}</span>
          </div>
        </Card>

        <Card className="caja-metric">
          <div className="caja-metric__label">IVA {Math.round(ivaRate * 100)}%</div>
          <div className="caja-metric__value caja-metric__value--iva">
            Bs. {summary.totalIva.toFixed(2)}
          </div>
          <div className="caja-metric__detail">
            <span>Base imponible: Bs. {summary.baseRevenue.toFixed(2)}</span>
          </div>
        </Card>

        <Card className="caja-metric">
          <div className="caja-metric__label">Pedidos</div>
          <div className="caja-metric__value caja-metric__value--orders">
            {summary.totalOrders}
          </div>
          <div className="caja-metric__detail">
            <span>{summary.cancelledOrders} cancelados</span>
          </div>
        </Card>
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
                  {METHOD_ICONS[method] || '💰'} {METHOD_LABELS[method] || method}
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
                  Bs. {amount.toFixed(2)}
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
