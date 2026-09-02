/**
 * ReportView — Reporte de CIERRE DE CAJA por día laboral (compartida admin+caja)
 *
 * Selector de fecha (día laboral) → desglose completo del cierre de ese día:
 *   efectivo inicial · efectivo ingresado · QR ingresado · TOTAL GENERAL ·
 *   transacciones · gastos efectivo/QR · efectivo esperado · efectivo contado ·
 *   QR esperado · diferencia
 *
 * Datos: GET /api/payments/closings (historial cerrado con columnas v13).
 * Sin cierre en el día seleccionado → mensaje claro.
 */

import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { Card } from '@/ui/components/Card';
import { Badge } from '@/ui/components/Badge';
import { Button } from '@/ui/components/Button';
import { Loader } from '@/ui/components/Loader';
import { FormField } from '@/ui/components/FormField';
import { AppIcon } from '@/ui/components/AppIcon/AppIcon';
import { fetchClosings, type ClosingRow } from '../api/adminApi';
import { fetchDailySales, fetchPopularItems, type PopularItem } from '../api/reportsApi';
import { localDateTimeStr } from '../utils/localDate';
import { formatMoney } from '../utils/format';
import {
  buildReportHtml,
  buildWhatsAppText,
  downloadReportHtml,
  type ReportClosing,
  type ReportDaily,
  type ReportPopularItem,
} from '../utils/reportExport';

interface ReportViewProps {
  token: string;
  onToast: (type: 'success' | 'error' | 'warning', message: string) => void;
  /** v14 (2026-08-29): día laboral inicial (desde el picker global del Admin). */
  initialDate?: string;
}

/** Convierte un PopularItem del API al tipo del export (subset). */
function toPopular(i: PopularItem): ReportPopularItem {
  return {
    item_name: i.item_name,
    category_name: i.category_name ?? null,
    times_ordered: i.times_ordered,
    total_quantity: i.total_quantity,
    total_revenue: i.total_revenue,
  };
}

export function ReportView({ token, onToast, initialDate }: ReportViewProps) {
  const [closings, setClosings] = useState<ClosingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [date, setDate] = useState(initialDate ?? '');
  // v19: datos extra para el reporte exportable (pedidos + top productos del día)
  const [daily, setDaily] = useState<ReportDaily | null>(null);
  const [popularQty, setPopularQty] = useState<ReportPopularItem[]>([]);
  const [popularRevenue, setPopularRevenue] = useState<ReportPopularItem[]>([]);
  const [exporting, setExporting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await fetchClosings(token);
      setClosings(result.closings);
      // Default: el cierre más reciente
      if (!date && result.closings.length > 0) {
        setDate(result.closings[0].closing_date);
      }
    } catch {
      onToast('error', 'No se pudo cargar el historial de cierres');
    } finally {
      setLoading(false);
    }
  }, [token, onToast, date]);

  // v19: cargar pedidos del día + top productos al cambiar la fecha seleccionada
  const loadDayExtra = useCallback(async (day: string) => {
    if (!day) return;
    try {
      const [dr, qty, rev] = await Promise.all([
        fetchDailySales(token, day),
        fetchPopularItems(token, day, 5, undefined, { from: day, to: day, orderBy: 'quantity', groupBy: 'item' }),
        fetchPopularItems(token, day, 5, undefined, { from: day, to: day, orderBy: 'revenue', groupBy: 'item' }),
      ]);
      if (dr.daily) {
        setDaily({
          totalOrders: dr.daily.totalOrders,
          completedOrders: dr.daily.completedOrders,
          cancelledOrders: dr.daily.cancelledOrders,
          grossRevenue: dr.daily.grossRevenue,
          totalSales: dr.daily.totalSales,
          totalIva: dr.daily.totalIva,
          baseRevenue: dr.daily.baseRevenue,
          averageTicket: dr.daily.averageTicket,
          byMethod: dr.daily.byMethod,
          hourly: dr.daily.hourly,
        });
      }
      if (qty.ok) setPopularQty((qty.data?.items ?? []).map(toPopular));
      if (rev.ok) setPopularRevenue((rev.data?.items ?? []).map(toPopular));
    } catch {
      // silencioso: el reporte principal sigue siendo el cierre
    }
  }, [token]);

  // v14: sincronizar con el picker global del Admin
  useEffect(() => {
    if (initialDate) {
      setDate(initialDate);
      void loadDayExtra(initialDate);
    }
  }, [initialDate, loadDayExtra]);

  useEffect(() => { load(); }, [load]);

  // Selección en el toolbar interno (Caja no tiene picker global)
  const handleDateChange = useCallback((value: string) => {
    setDate(value);
    void loadDayExtra(value);
  }, [loadDayExtra]);

  const selected = useMemo(
    () => closings.find(c => c.closing_date === date) ?? null,
    [closings, date]
  );

  // ── Export HTML / WhatsApp (v19) ─────────────────────────────
  const handleExportHtml = useCallback(() => {
    if (!date) { onToast('warning', 'Selecciona un día para exportar'); return; }
    setExporting(true);
    try {
      const closing: ReportClosing | null = selected
        ? {
            closing_date: selected.closing_date,
            opened_at: selected.opened_at,
            closed_at: selected.closed_at,
            closed_by_name: selected.closed_by_name,
            opening_cash: selected.opening_cash,
            expected_cash: selected.expected_cash,
            actual_cash: selected.actual_cash,
            expected_qr: selected.expected_qr,
            expenses_cash: selected.expenses_cash,
            expenses_qr: selected.expenses_qr,
            transactions: selected.transactions,
            total_general: selected.total_general,
            cash_difference: selected.cash_difference,
            notes: selected.notes,
          }
        : null;
      const html = buildReportHtml({
        closing,
        daily,
        popularQty,
        popularRevenue,
        businessName: 'Rey de la Chelada',
      });
      downloadReportHtml(`reporte-cierre-${date}.html`, html);
      onToast('success', 'Reporte HTML descargado. Ábrelo y usa Ctrl+P → Guardar como PDF.');
    } catch {
      onToast('error', 'No se pudo generar el reporte');
    } finally {
      setExporting(false);
    }
  }, [date, selected, daily, popularQty, popularRevenue, onToast]);

  const handleCopyWhatsApp = useCallback(async () => {
    if (!date) { onToast('warning', 'Selecciona un día para copiar'); return; }
    try {
      const closing: ReportClosing | null = selected
        ? {
            closing_date: selected.closing_date,
            opened_at: selected.opened_at,
            closed_at: selected.closed_at,
            closed_by_name: selected.closed_by_name,
            opening_cash: selected.opening_cash,
            expected_cash: selected.expected_cash,
            actual_cash: selected.actual_cash,
            expected_qr: selected.expected_qr,
            expenses_cash: selected.expenses_cash,
            expenses_qr: selected.expenses_qr,
            transactions: selected.transactions,
            total_general: selected.total_general,
            cash_difference: selected.cash_difference,
            notes: selected.notes,
          }
        : null;
      const text = buildWhatsAppText({ closing, daily, popularQty, popularRevenue, businessName: 'Rey de la Chelada' });
      await navigator.clipboard.writeText(text);
      onToast('success', 'Resumen copiado para WhatsApp');
    } catch {
      onToast('error', 'No se pudo copiar. Revisa permisos del portapapeles.');
    }
  }, [date, selected, daily, popularQty, popularRevenue, onToast]);

  return (
    <div className="admin-view">
      <div className="admin-toolbar">
        {/* v14: el datepicker interno solo se muestra cuando NO hay un picker
            global (Caja no tiene topbar de fecha; Admin sí → usa el global de
            arriba a la derecha, y aquí no se duplica). */}
        {!initialDate && (
          <FormField
            type="date"
            variant="constrained" className="form-input--mono"
            value={date}
            onChange={e => handleDateChange(e.target.value)}
            aria-label="Día del cierre"
          />
        )}
        <Badge variant="info">{closings.length} cierre(s)</Badge>
        <Button variant="secondary" size="sm" onClick={load} loading={loading}>
          <AppIcon name="refresh" size="sm" /> Refrescar
        </Button>
        <Button variant="primary" size="sm" onClick={handleExportHtml} loading={exporting}>
          <AppIcon name="download" size="sm" /> Exportar HTML
        </Button>
        <Button variant="secondary" size="sm" onClick={handleCopyWhatsApp}>
          <AppIcon name="message" size="sm" /> Copiar WhatsApp
        </Button>
      </div>

      {loading ? (
        <Card className="admin-section"><Loader label="Cargando reportes…" /></Card>
      ) : !selected ? (
        <Card className="admin-section">
          <p className="admin-muted">No hay cierre de caja registrado para el día {date || '—'}.</p>
        </Card>
      ) : (
        <>
          <Card className="admin-section">
            <h3>Cierre del día laboral {selected.closing_date}</h3>
            <p className="admin-muted">
              Abierto: {localDateTimeStr(new Date(selected.opened_at))}
              {selected.closed_at && ` · Cerrado: ${localDateTimeStr(new Date(selected.closed_at))}`}
              {selected.closed_by_name && ` · Por: ${selected.closed_by_name}`}
            </p>
          </Card>

          <Card className="admin-section">
            <h3>Movimientos del día</h3>
            <div className="caja-close__breakdown">
              <div className="caja-close__history-item">
                <span>Efectivo inicial (cierre anterior)</span>
                <span className="caja-close__history-value">{formatMoney(selected.opening_cash ?? 0)}</span>
              </div>
              <div className="caja-close__history-item">
                <span>Efectivo ingresado</span>
                <span className="caja-close__history-value">{formatMoney(selected.expected_cash - (selected.opening_cash ?? 0) + (selected.expenses_cash ?? 0))}</span>
              </div>
              <div className="caja-close__history-item">
                <span>QR ingresado</span>
                <span className="caja-close__history-value">{formatMoney((selected.expected_qr ?? 0) + (selected.expenses_qr ?? 0))}</span>
              </div>
              <div className="caja-close__history-item caja-close__history-item--total">
                <span><strong>TOTAL GENERAL</strong></span>
                <span className="caja-close__history-value">{formatMoney(selected.total_general ?? 0)}</span>
              </div>
              <div className="caja-close__history-item">
                <span>Nº de transacciones</span>
                <span className="caja-close__history-value">{selected.transactions ?? 0}</span>
              </div>
            </div>
          </Card>

          <Card className="admin-section">
            <h3>Cierre</h3>
            <div className="caja-close__breakdown">
              <div className="caja-close__history-item">
                <span>Gastos/retiros EFECTIVO</span>
                <span className="caja-close__history-value">{formatMoney(selected.expenses_cash ?? 0)}</span>
              </div>
              <div className="caja-close__history-item">
                <span>Gastos/retiros QR</span>
                <span className="caja-close__history-value">{formatMoney(selected.expenses_qr ?? 0)}</span>
              </div>
              <div className="caja-close__history-item">
                <span>Efectivo esperado</span>
                <span className="caja-close__history-value">{formatMoney(selected.expected_cash)}</span>
              </div>
              <div className="caja-close__history-item">
                <span>Efectivo contado</span>
                <span className="caja-close__history-value">{formatMoney(selected.actual_cash)}</span>
              </div>
              <div className="caja-close__history-item">
                <span>QR esperado</span>
                <span className="caja-close__history-value">{formatMoney(selected.expected_qr ?? 0)}</span>
              </div>
              <div className="caja-close__history-item">
                <span>Diferencia</span>
                <span className={`caja-close__history-value ${selected.cash_difference >= 0 ? 'positive' : 'negative'}`}>
                  {selected.cash_difference >= 0 ? '+' : ''}{formatMoney(selected.cash_difference)}
                </span>
              </div>
              {selected.notes && (
                <div className="caja-close__history-item">
                  <span>Notas</span>
                  <span className="caja-close__history-value">{selected.notes}</span>
                </div>
              )}
            </div>
          </Card>
        </>
      )}
    </div>
  );
}

export default ReportView;