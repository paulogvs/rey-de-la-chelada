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
import { localDateTimeStr } from '../utils/localDate';
import { formatMoney } from '../utils/format';

interface ReportViewProps {
  token: string;
  onToast: (type: 'success' | 'error' | 'warning', message: string) => void;
  /** v14 (2026-08-29): día laboral inicial (desde el picker global del Admin). */
  initialDate?: string;
}

export function ReportView({ token, onToast, initialDate }: ReportViewProps) {
  const [closings, setClosings] = useState<ClosingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [date, setDate] = useState(initialDate ?? '');

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

  // v14: sincronizar con el picker global del Admin
  useEffect(() => {
    if (initialDate) setDate(initialDate);
  }, [initialDate]);

  useEffect(() => { load(); }, [load]);

  const selected = useMemo(
    () => closings.find(c => c.closing_date === date) ?? null,
    [closings, date]
  );

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
            onChange={e => setDate(e.target.value)}
            aria-label="Día del cierre"
          />
        )}
        <Badge variant="info">{closings.length} cierre(s)</Badge>
        <Button variant="secondary" size="sm" onClick={load} loading={loading}>
          <AppIcon name="refresh" size="sm" /> Refrescar
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