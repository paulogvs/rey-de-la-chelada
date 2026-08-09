/**
 * ADMIN — DashboardView
 *
 * Quick stats for Paulo:
 *   - Items del menú + cuántos sin precio
 *   - Mesas totales (y libres/ocupadas)
 *   - Cortes de caja de hoy (cerrados) + venta de hoy
 *   - Botón de acceso rápido a acciones clave
 */

import React, { useState, useCallback, useEffect } from 'react';
import { Card } from '@/ui/components/Card';
import { StatCard } from '@/ui/components/StatCard';
import { Loader } from '@/ui/components/Loader';
import { fetchAdminMenuItems } from '../../_shared/api/adminApi';
import { fetchTables } from '../../_shared/api/tablesApi';
import { fetchClosings } from '../../_shared/api/adminApi';
import { fetchDailySales } from '../../_shared/api/reportsApi';
import { localDateStr } from '../../_shared/utils/localDate';

interface DashboardViewProps {
  token: string;
  onToast: (type: 'success' | 'error' | 'warning', message: string) => void;
}

interface Stats {
  itemCount: number;
  nullPriceCount: number;
  tableCount: number;
  freeTables: number;
  closingsToday: number;
  revenueToday: number;
}

function emptyStats(): Stats {
  return {
    itemCount: 0,
    nullPriceCount: 0,
    tableCount: 0,
    freeTables: 0,
    closingsToday: 0,
    revenueToday: 0,
  };
}

export function DashboardView({ token, onToast }: DashboardViewProps) {
  const [stats, setStats] = useState<Stats>(emptyStats());
  const [loading, setLoading] = useState(true);
  const [today, setToday] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // C1/2.1: "hoy" = fecha LOCAL America/La_Paz (NUNCA toISOString — corta a las 20:00 local)
      const day = localDateStr();
      setToday(day);

      const [items, tables, closings, daily] = await Promise.all([
        fetchAdminMenuItems(token),
        fetchTables(token),
        fetchClosings(token),
        fetchDailySales(token, day, 0.13),
      ]);

      const nullPrice = items.items.filter(i => i.price == null).length;
      const free = tables.tables.filter(t => t.status === 'free').length;
      const closingsToday = closings.closings.filter(c =>
        (c.closed_at || '').slice(0, 10) === day
      ).length;

      setStats({
        itemCount: items.items.length,
        nullPriceCount: nullPrice,
        tableCount: tables.tables.length,
        freeTables: free,
        closingsToday,
        revenueToday: daily.daily?.totalSales ?? 0,
      });

      if (nullPrice > 0) {
        onToast('warning', `${nullPrice} item(s) sin precio — usa "Precios" o "Carga Masiva"`);
      }
    } catch {
      setStats(emptyStats());
      onToast('error', 'Error al cargar el dashboard');
    } finally {
      setLoading(false);
    }
  }, [token, onToast]);

  useEffect(() => {
    load();
    const interval = setInterval(load, 60000);
    return () => clearInterval(interval);
  }, [load]);

  const pctPriced = stats.itemCount > 0
    ? Math.round(((stats.itemCount - stats.nullPriceCount) / stats.itemCount) * 100)
    : 0;

  return (
    <div className="admin-view">
      {loading && stats.itemCount === 0 ? (
        <Loader label="Cargando estadísticas…" />
      ) : (
        <>
          <div className="admin-dashboard__grid">
            <StatCard
              className={stats.nullPriceCount > 0 ? 'admin-stat admin-stat--alert' : 'admin-stat admin-stat--items'}
              label="Items del menú"
              value={stats.itemCount}
              delta={stats.nullPriceCount > 0
                ? `${stats.nullPriceCount} sin precio`
                : 'Todos con precio'}
              deltaTone={stats.nullPriceCount > 0 ? 'down' : 'up'}
              icon="📊"
            />

            <StatCard
              className="admin-stat"
              label="Precios cargados"
              value={`${pctPriced}%`}
              delta="del menú"
              icon="🏷️"
            />

            <StatCard
              className="admin-stat"
              label="Mesas"
              value={stats.tableCount}
              delta={`${stats.freeTables} libres`}
              icon="🪑"
            />

            <StatCard
              className="admin-stat admin-stat--revenue"
              label={`Ventas ${today}`}
              value={`Bs. ${stats.revenueToday.toFixed(2)}`}
              delta={`${stats.closingsToday} corte(s) hoy`}
              deltaTone={stats.revenueToday > 0 ? 'up' : 'neutral'}
              icon="💰"
            />
          </div>

          <Card className="admin-section">
            <h3>Estado rápido</h3>
            <p className="admin-muted">
              {stats.nullPriceCount > 0
                ? `Hay ${stats.nullPriceCount} producto(s) sin precio. El menú público los muestra como "—".`
                : 'Todos los productos tienen precio. El menú público está listo.'}
            </p>
            <p className="admin-muted">
              {stats.closingsToday === 0
                ? 'No hay cortes de caja cerrados hoy aún (el corte actual se maneja en /caja).'
                : `${stats.closingsToday} corte(s) de caja cerrado(s) hoy — ver historial en "Cortes".`}
            </p>
          </Card>
        </>
      )}
    </div>
  );
}
