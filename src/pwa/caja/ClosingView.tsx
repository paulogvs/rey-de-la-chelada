/**
 * Caja — ClosingView (API-driven corte de caja — v13 rediseñado)
 *
 * Desglose del cierre de día laboral (turno 15:00 → 06:00):
 *   - Efectivo inicial (con el que se cerró el día anterior laboral)
 *   - Efectivo ingresado (del día trabajado) · QR ingresado (del día)
 *   - *** TOTAL GENERAL *** (inicial + efectivo + QR)
 *   - Nº de transacciones (del día)
 *   - [Al cerrar] Gastos/retiros EFECTIVO + QR (luz, etc.)
 *   - Efectivo esperado = inicial + efectivo − gastos efectivo
 *   - Efectivo contado (la cajera lo ingresa al cerrar)
 *   - QR esperado = QR − gastos QR
 *
 * API: GET /closing/current (desglose vivo) · POST /closing (abrir)
 *      PUT /closing/close (cerrar con gastos)
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  fetchClosingCurrent,
  openClosing,
  closeClosing,
  type ServerClosing,
  type ClosingBreakdown,
} from '../_shared/api/paymentsApi';
import { fetchDailySales, type DailySales } from '../_shared/api/reportsApi';
import { Card } from '@/ui/components/Card';
import { Loader } from '@/ui/components/Loader';
import { Button } from '@/ui/components/Button';
import { MoneyInput } from '@/ui/components/MoneyInput/MoneyInput';
import { useToast } from '@/ui/components/Toast';
import { AppIcon } from '@/ui/components/AppIcon/AppIcon';
import { PrintReceipt } from '../_shared/components/PrintReceipt';
import { localDateTimeStr } from '../_shared/utils/localDate';
import { formatMoney } from '../_shared/utils/format';

interface ClosingViewProps {
  token: string;
  today: string;
  ivaRate: number;
  refreshTick: number;
  onClosingUpdated: () => void;
}

export function ClosingView({ token, today, ivaRate, refreshTick, onClosingUpdated }: ClosingViewProps) {
  const { addToast } = useToast();

  const [closing, setClosing] = useState<ServerClosing | null>(null);
  const [breakdown, setBreakdown] = useState<ClosingBreakdown | null>(null);
  const [daily, setDaily] = useState<DailySales | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  // Al cerrar: la cajera ingresa estos 3 valores
  const [expensesCash, setExpensesCash] = useState<number>(0);
  const [expensesQr, setExpensesQr] = useState<number>(0);
  const [actualCash, setActualCash] = useState<number>(0);
  const [notes, setNotes] = useState('');
  const [printOpen, setPrintOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [curResult, dailyResult] = await Promise.all([
        fetchClosingCurrent(token),
        fetchDailySales(token, today, ivaRate),
      ]);

      const open = curResult.ok ? curResult.closing : null;
      const brk = curResult.ok ? curResult.breakdown : null;
      setClosing(open);
      setBreakdown(brk);
      setDaily(dailyResult.ok ? dailyResult.daily : null);

      // Pre-fill: efectivo contado con el esperado al abrir (la cajera ajusta)
      if (open && brk) {
        setExpensesCash(brk.expenses_cash || 0);
        setExpensesQr(brk.expenses_qr || 0);
        setActualCash(brk.expected_cash);
      }
    } finally {
      setLoading(false);
    }
  }, [token, today, ivaRate]);

  useEffect(() => {
    load();
  }, [load, refreshTick]);

  const handleOpen = useCallback(async () => {
    setBusy(true);
    const result = await openClosing(token);
    setBusy(false);
    if (!result.ok) {
      addToast({ type: 'warning', message: result.error || 'No se pudo abrir el corte', duration: 4000 });
      return;
    }
    addToast({ type: 'success', message: 'Corte de caja iniciado', duration: 3000 });
    onClosingUpdated();
  }, [token, addToast, onClosingUpdated]);

  const handleClose = useCallback(async () => {
    setBusy(true);
    const result = await closeClosing(token, actualCash, {
      expensesCash,
      expensesQr,
      notes,
    });
    setBusy(false);
    if (!result.ok) {
      addToast({ type: 'warning', message: result.error || 'No se pudo cerrar el corte', duration: 4000 });
      return;
    }
    addToast({ type: 'success', message: 'Cierre de caja completado', duration: 4000 });
    onClosingUpdated();
  }, [token, actualCash, expensesCash, expensesQr, notes, addToast, onClosingUpdated]);

  if (loading && !closing) {
    return (
      <div className="caja-close">
        <Card className="caja-close__card">
          <Loader block label="Cargando corte de caja…" />
        </Card>
      </div>
    );
  }

  const byMethod = daily?.byMethod ?? {};
  const qrTotal = (byMethod['qr'] ?? 0) + (byMethod['qr_yape'] ?? 0) + (byMethod['qr_simple'] ?? 0);

  // Desglose (vivo o snapshot del cierre abierto)
  const openingCash = breakdown?.opening_cash ?? closing?.opening_cash ?? 0;
  const cashToday = breakdown?.cash_today ?? 0;
  const qrToday = breakdown?.qr_today ?? qrTotal;
  const totalGeneral = breakdown?.total_general ?? closing?.total_general ?? 0;
  const transactions = breakdown?.transactions ?? closing?.transactions ?? 0;
  const expCash = expensesCash || 0;
  const expQr = expensesQr || 0;
  const expectedCash = openingCash + cashToday - expCash;
  const expectedQr = qrToday - expQr;
  const difference = actualCash - expectedCash;

  return (
    <div className="caja-close">
      <Card className="caja-close__card">
        <h3>{closing ? 'Corte de Caja Activo' : 'Corte de Caja'}</h3>

        {closing ? (
          <div className="caja-close__fields">
            <div className="caja-close__section">
              <h4 className="caja-close__section-title">Día laboral {closing.closing_date}</h4>
              <div className="caja-close__field">
                <span className="caja-close__field-label">Iniciado</span>
                <div className="caja-close__value">{localDateTimeStr(new Date(closing.opened_at))}</div>
              </div>
              <div className="caja-close__field">
                <span className="caja-close__field-label">Efectivo inicial (cierre anterior)</span>
                <div className="caja-close__value">{formatMoney(openingCash)}</div>
              </div>
              <div className="caja-close__field">
                <span className="caja-close__field-label">Efectivo ingresado (del día)</span>
                <div className="caja-close__value">{formatMoney(cashToday)}</div>
              </div>
              <div className="caja-close__field">
                <span className="caja-close__field-label">QR ingresado (del día)</span>
                <div className="caja-close__value">{formatMoney(qrToday)}</div>
              </div>
              <div className="caja-close__field caja-close__field--total">
                <span className="caja-close__field-label">TOTAL GENERAL</span>
                <div className="caja-close__value caja-close__value--total">{formatMoney(openingCash + cashToday + qrToday)}</div>
              </div>
              <div className="caja-close__field">
                <span className="caja-close__field-label">Nº de transacciones (del día)</span>
                <div className="caja-close__value">{transactions}</div>
              </div>
            </div>

            <div className="caja-close__section">
              <h4 className="caja-close__section-title">Cierre — la cajera registra</h4>
              <div className="caja-close__field">
                <label htmlFor="expenses-cash">Gastos/retiros de caja EFECTIVO (luz, etc.)</label>
                <MoneyInput
                  id="expenses-cash"
                  variant="sm" className="form-input--mono"
                  value={expensesCash}
                  onChange={setExpensesCash}
                  placeholder="0"
                />
              </div>
              <div className="caja-close__field">
                <label htmlFor="expenses-qr">Gastos/retiros de caja QR</label>
                <MoneyInput
                  id="expenses-qr"
                  variant="sm" className="form-input--mono"
                  value={expensesQr}
                  onChange={setExpensesQr}
                  placeholder="0"
                />
              </div>
              <div className="caja-close__field">
                <span className="caja-close__field-label">Efectivo esperado en caja</span>
                <div className="caja-close__value">{formatMoney(expectedCash)}</div>
              </div>
              <div className="caja-close__field">
                <label htmlFor="actual-cash">Efectivo contado</label>
                <MoneyInput
                  id="actual-cash"
                  variant="lg" className="form-input--mono"
                  value={actualCash}
                  onChange={setActualCash}
                />
              </div>
              <div className="caja-close__field">
                <span className="caja-close__field-label">QR esperado en caja</span>
                <div className="caja-close__value">{formatMoney(expectedQr)}</div>
              </div>
              <div className="caja-close__field">
                <span className="caja-close__field-label">Diferencia (contado − esperado)</span>
                <div className={`caja-close__diff ${difference >= 0 ? 'positive' : 'negative'}`}>
                  {difference >= 0 ? '+' : ''}{formatMoney(difference)}
                </div>
              </div>
              <div className="caja-close__field">
                <label htmlFor="closing-notes">Notas</label>
                <textarea
                  id="closing-notes"
                  className="caja-close__textarea"
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  placeholder="Observaciones del cierre..."
                  rows={3}
                />
              </div>
            </div>
          </div>
        ) : (
          <p className="caja-close__hint">
            No hay corte de caja abierto. Inícialo para registrar las ventas del día.
          </p>
        )}

        <div className="caja-close__actions">
          {closing ? (
            <>
              <Button variant="secondary" onClick={() => setPrintOpen(true)} disabled={busy}>
                <AppIcon name="printer" size="sm" /> Imprimir cierre
              </Button>
              <Button variant="primary" onClick={handleClose} disabled={busy} fullWidth>
                {busy ? 'Cerrando…' : 'Cerrar Día'}
              </Button>
            </>
          ) : (
            <Button variant="primary" onClick={handleOpen} disabled={busy} fullWidth>
              {busy ? 'Abriendo…' : 'Abrir Corte de Caja'}
            </Button>
          )}
        </div>
      </Card>

      <Card className="caja-close__history">
        <h3>Resumen del día laboral (15:00 → 06:00)</h3>
        <div className="caja-close__breakdown">
          <div className="caja-close__history-item">
            <span><AppIcon name="banknote" size="sm" /> Efectivo (físico — va al cajón)</span>
            <span className="caja-close__history-value">{formatMoney(cashToday)}</span>
          </div>
          <div className="caja-close__history-item">
            <span><AppIcon name="smartphone" size="sm" /> QR (digital — depositado)</span>
            <span className="caja-close__history-value">{formatMoney(qrToday)}</span>
          </div>
        </div>
      </Card>

      <PrintReceipt
        open={printOpen}
        onClose={() => setPrintOpen(false)}
        kind="closing"
        receipt={{
          businessName: 'El Rey de la Chelada',
          date: new Date().toISOString(),
          totalSales: totalGeneral,
          totalIva: daily?.totalIva ?? 0,
          totalOrders: transactions,
          byMethod: { cash: cashToday, qr: qrToday },
          expectedCash,
          actualCash,
          difference,
          reconciled: Math.abs(difference) <= 0.01,
          notes: notes || undefined,
        }}
        label="Cierre de caja"
      />
    </div>
  );
}

export default ClosingView;