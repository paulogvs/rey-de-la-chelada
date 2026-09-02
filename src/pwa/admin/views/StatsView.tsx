/**
 * ADMIN — StatsView (v14 2026-08-29): panel de estadísticas del restobar.
 *
 * Para gestión de insumos/stock: ventas por rango, ticket promedio,
 * top productos por cantidad Y por monto, y agrupación por categoría.
 * Export CSV reutilizando csvExport.ts.
 */

import React, { useState, useCallback, useEffect } from 'react';
import { Card } from '@/ui/components/Card';
import { Badge } from '@/ui/components/Badge';
import { Button } from '@/ui/components/Button';
import { Loader } from '@/ui/components/Loader';
import { AppIcon } from '@/ui/components/AppIcon/AppIcon';
import { formatMoney } from '../../_shared/utils/format';
import { businessDayDateStr } from '../../_shared/utils/localDate';
import { fetchSalesRange, fetchPopularItems } from '../../_shared/api/reportsApi';
import { csvLine, downloadCsv } from '../../_shared/utils/csvExport';

interface StatsViewProps {
  token: string;
  onToast: (type: 'success' | 'error' | 'warning', message: string) => void;
  /** v16: rango de fechas controlado desde el topbar (AdminApp). */
  from?: string;
  to?: string;
}

interface PopularRow {
  id?: string;
  item_name?: string;
  category_name?: string;
  times_ordered: number;
  total_quantity: number;
  total_revenue: number;
}

export function StatsView({ token, onToast, from, to }: StatsViewProps) {
  const today = businessDayDateStr();
  // v16: el rango viene del topbar (AdminApp). Fallback a hoy si no llega.
  const effectiveFrom = from ?? today;
  const effectiveTo = to ?? today;
  const [range, setRange] = useState<{ total_orders: number; total_revenue: number; avg_order: number } | null>(null);
  const [byQty, setByQty] = useState<PopularRow[]>([]);
  const [byRevenue, setByRevenue] = useState<PopularRow[]>([]);
  const [byCategory, setByCategory] = useState<PopularRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!effectiveFrom || !effectiveTo) return;
    setLoading(true);
    try {
      const [sr, qty, rev, cat] = await Promise.all([
        fetchSalesRange(token, effectiveFrom, effectiveTo),
        fetchPopularItems(token, effectiveFrom, 10, undefined, { from: effectiveFrom, to: effectiveTo, orderBy: 'quantity', groupBy: 'item' }),
        fetchPopularItems(token, effectiveFrom, 10, undefined, { from: effectiveFrom, to: effectiveTo, orderBy: 'revenue', groupBy: 'item' }),
        fetchPopularItems(token, effectiveFrom, 20, undefined, { from: effectiveFrom, to: effectiveTo, orderBy: 'quantity', groupBy: 'category' }),
      ]);
      if (sr.ok && sr.totals) setRange(sr.totals);
      if (qty.ok) setByQty(qty.data?.items ?? []);
      if (rev.ok) setByRevenue(rev.data?.items ?? []);
      if (cat.ok) setByCategory(cat.data?.items ?? []);
    } catch {
      onToast('error', 'No se pudieron cargar las estadísticas');
    } finally {
      setLoading(false);
    }
  }, [token, effectiveFrom, effectiveTo, onToast]);

  useEffect(() => { load(); }, [load]);

  const exportCsv = useCallback(() => {
    const lines = [
      csvLine(['Rango', `${effectiveFrom} → ${effectiveTo}`]),
      csvLine([]),
      csvLine(['#', 'Producto', 'Categoría', 'Pedidos', 'Cantidad', 'Ingresos (Bs)']),
      ...byQty.map((p, i) => csvLine([i + 1, p.item_name ?? p.category_name, p.category_name ?? '', p.times_ordered, p.total_quantity, (p.total_revenue / 100).toFixed(2).replace('.', ',')])),
    ];
    const csv = lines.join('\n');
    downloadCsv(`estadisticas-${effectiveFrom}-a-${effectiveTo}.csv`, csv);
    onToast('success', 'CSV descargado');
  }, [effectiveFrom, effectiveTo, byQty, onToast]);

  return (
    <div className="admin-view">
      {/* v16: el rango (Desde → Hasta) vive en el topbar global del Admin. Aquí solo quedan los botones. */}
      <div className="admin-toolbar" style={{ flexWrap: 'wrap', gap: 10 }}>
        <span className="admin-muted">Rango: {effectiveFrom} → {effectiveTo}</span>
        <Button variant="secondary" size="sm" onClick={load} loading={loading}>
          <AppIcon name="refresh" size="sm" /> Actualizar
        </Button>
        <Button variant="secondary" size="sm" onClick={exportCsv}>
          <AppIcon name="download" size="sm" /> Exportar CSV
        </Button>
      </div>

      {loading ? <Loader block label="Calculando estadísticas…" /> : (
        <>
          {/* KPIs */}
          {range && (
            <div className="admin-stats-kpis">
              <Card className="admin-stats-kpi">
                <span className="admin-stats-kpi__label">Ventas totales</span>
                <strong className="admin-stats-kpi__value">{formatMoney(range.total_revenue)}</strong>
              </Card>
              <Card className="admin-stats-kpi">
                <span className="admin-stats-kpi__label">Pedidos</span>
                <strong className="admin-stats-kpi__value">{range.total_orders}</strong>
              </Card>
              <Card className="admin-stats-kpi">
                <span className="admin-stats-kpi__label">Ticket promedio</span>
                <strong className="admin-stats-kpi__value">{formatMoney(range.avg_order)}</strong>
              </Card>
            </div>
          )}

          <div className="admin-stats-grid">
            {/* Top por cantidad */}
            <Card className="admin-section">
              <div className="admin-section__head"><h3>Top productos por CANTIDAD</h3><Badge variant="info">{from} → {to}</Badge></div>
              {byQty.length === 0 ? <p className="admin-muted">Sin datos en el rango.</p> : (
                <>
                  {/* v19: gráfico de barras CSS (top 5 por cantidad) */}
                  <div className="admin-stats-bars">
                    {byQty.slice(0, 5).map((p, i) => {
                      const max = Math.max(...byQty.slice(0, 5).map(x => x.total_quantity), 1);
                      const pct = Math.max(6, Math.round((p.total_quantity / max) * 100));
                      return (
                        <div key={i} className="admin-stats-bar">
                          <span className="admin-stats-bar__label" title={p.item_name}>{p.item_name}</span>
                          <span className="admin-stats-bar__track">
                            <span className="admin-stats-bar__fill" style={{ width: `${pct}%` }} />
                          </span>
                          <span className="admin-stats-bar__val">{p.total_quantity}</span>
                        </div>
                      );
                    })}
                  </div>
                  <table className="admin-stats-table">
                    <thead><tr><th>#</th><th>Producto</th><th>Categoría</th><th>Cantidad</th><th>Ingresos</th></tr></thead>
                    <tbody>
                      {byQty.map((p, i) => (
                        <tr key={i}>
                          <td>{i + 1}</td>
                          <td><strong>{p.item_name ?? p.category_name}</strong></td>
                          <td>{p.category_name ?? ''}</td>
                          <td>{p.total_quantity}</td>
                          <td>{formatMoney(p.total_revenue)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              )}
            </Card>

            {/* Top por ingresos */}
            <Card className="admin-section">
              <div className="admin-section__head"><h3>Top productos por INGRESOS</h3><Badge variant="info">{from} → {to}</Badge></div>
              {byRevenue.length === 0 ? <p className="admin-muted">Sin datos en el rango.</p> : (
                <table className="admin-stats-table">
                  <thead><tr><th>#</th><th>Producto</th><th>Cantidad</th><th>Ingresos</th></tr></thead>
                  <tbody>
                    {byRevenue.map((p, i) => (
                      <tr key={i}>
                        <td>{i + 1}</td>
                        <td><strong>{p.item_name ?? p.category_name}</strong></td>
                        <td>{p.total_quantity}</td>
                        <td>{formatMoney(p.total_revenue)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>

            {/* Por categoría */}
            <Card className="admin-section">
              <div className="admin-section__head"><h3>Por CATEGORÍA (stock)</h3><Badge variant="info">{from} → {to}</Badge></div>
              {byCategory.length === 0 ? <p className="admin-muted">Sin datos en el rango.</p> : (
                <table className="admin-stats-table">
                  <thead><tr><th>#</th><th>Categoría</th><th>Pedidos</th><th>Cantidad</th><th>Ingresos</th></tr></thead>
                  <tbody>
                    {byCategory.map((p, i) => (
                      <tr key={i}>
                        <td>{i + 1}</td>
                        <td><strong>{p.category_name ?? p.item_name}</strong></td>
                        <td>{p.times_ordered}</td>
                        <td>{p.total_quantity}</td>
                        <td>{formatMoney(p.total_revenue)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

export default StatsView;