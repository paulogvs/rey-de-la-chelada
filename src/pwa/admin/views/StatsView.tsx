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
import { FormField } from '@/ui/components/FormField';
import { AppIcon } from '@/ui/components/AppIcon/AppIcon';
import { formatMoney } from '../../_shared/utils/format';
import { businessDayDateStr } from '../../_shared/utils/localDate';
import { fetchSalesRange, fetchPopularItems } from '../../_shared/api/reportsApi';
import { csvLine, downloadCsv } from '../../_shared/utils/csvExport';

interface StatsViewProps {
  token: string;
  onToast: (type: 'success' | 'error' | 'warning', message: string) => void;
}

interface PopularRow {
  id?: string;
  item_name?: string;
  category_name?: string;
  times_ordered: number;
  total_quantity: number;
  total_revenue: number;
}

export function StatsView({ token, onToast }: StatsViewProps) {
  const today = businessDayDateStr();
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [range, setRange] = useState<{ total_orders: number; total_revenue: number; avg_order: number } | null>(null);
  const [byQty, setByQty] = useState<PopularRow[]>([]);
  const [byRevenue, setByRevenue] = useState<PopularRow[]>([]);
  const [byCategory, setByCategory] = useState<PopularRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!from || !to) return;
    setLoading(true);
    try {
      const [sr, qty, rev, cat] = await Promise.all([
        fetchSalesRange(token, from, to),
        fetchPopularItems(token, from, 10, undefined, { from, to, orderBy: 'quantity', groupBy: 'item' }),
        fetchPopularItems(token, from, 10, undefined, { from, to, orderBy: 'revenue', groupBy: 'item' }),
        fetchPopularItems(token, from, 20, undefined, { from, to, orderBy: 'quantity', groupBy: 'category' }),
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
  }, [token, from, to, onToast]);

  useEffect(() => { load(); }, [load]);

  const exportCsv = useCallback(() => {
    const lines = [
      csvLine(['Rango', `${from} → ${to}`]),
      csvLine([]),
      csvLine(['#', 'Producto', 'Categoría', 'Pedidos', 'Cantidad', 'Ingresos (Bs)']),
      ...byQty.map((p, i) => csvLine([i + 1, p.item_name ?? p.category_name, p.category_name ?? '', p.times_ordered, p.total_quantity, (p.total_revenue / 100).toFixed(2).replace('.', ',')])),
    ];
    const csv = lines.join('\n');
    downloadCsv(`estadisticas-${from}-a-${to}.csv`, csv);
    onToast('success', 'CSV descargado');
  }, [from, to, byQty, onToast]);

  return (
    <div className="admin-view">
      <div className="admin-toolbar" style={{ flexWrap: 'wrap', gap: 10 }}>
        <FormField type="date" variant="sm" value={from} onChange={e => setFrom(e.target.value)} aria-label="Desde" />
        <span className="admin-muted">→</span>
        <FormField type="date" variant="sm" value={to} onChange={e => setTo(e.target.value)} aria-label="Hasta" />
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