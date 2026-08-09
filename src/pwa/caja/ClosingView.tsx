/**
 * Caja — ClosingView (API-driven corte de caja)
 *
 * Closing lifecycle via server (cash_closings table):
 *   - GET  /api/payments/closing/current → open closing + today's payments
 *   - POST /api/payments/closing         → open a new closing (expected = today total)
 *   - PUT  /api/payments/closing/close   → close with actual cash + reconcile flag
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  fetchClosingCurrent,
  openClosing,
  closeClosing,
  fetchDailySales,
  type ServerClosing,
  type DailySales,
} from '../_shared/api/reportsApi';
import { Card } from '@/ui/components/Card';
import { Loader } from '@/ui/components/Loader';
import { Button } from '@/ui/components/Button';
import { StatCard } from '@/ui/components/StatCard';
import { FormField } from '@/ui/components/FormField';
import { useToast } from '@/ui/components/Toast';
import { PrintReceipt } from '../_shared/components/PrintReceipt';

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
  const [daily, setDaily] = useState<DailySales | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const [actualCash, setActualCash] = useState<number>(0);
  const [notes, setNotes] = useState('');
  const [reconciled, setReconciled] = useState(false);
  const [printOpen, setPrintOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [curResult, dailyResult] = await Promise.all([
      fetchClosingCurrent(token),
      fetchDailySales(token, today, ivaRate),
    ]);

    const open = curResult.ok ? curResult.closing : null;
    setClosing(open);
    setDaily(dailyResult.ok ? dailyResult.daily : null);

    // Pre-fill actual cash with expected when opening fresh
    if (open && open.expected_cash !== undefined) {
      setActualCash(open.expected_cash);
    }
    setLoading(false);
  }, [token, today, ivaRate]);

  useEffect(() => {
    load();
  }, [load, refreshTick]);

  // Derived: expected cash = opening balance + today's cash sales (if any closing)
  const expectedCash =
    (closing?.expected_cash ?? 0) +
    (closing && closing.expected_cash !== undefined && closing.expected_cash > 0
      ? 0
      : (daily?.byMethod['cash'] ?? 0));

  const difference = Math.round((actualCash - expectedCash) * 100) / 100;

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
    const result = await closeClosing(token, actualCash, reconciled, notes);
    setBusy(false);
    if (!result.ok) {
      addToast({ type: 'warning', message: result.error || 'No se pudo cerrar el corte', duration: 4000 });
      return;
    }
    addToast({ type: 'success', message: 'Cierre de caja completado', duration: 4000 });
    onClosingUpdated();
  }, [token, actualCash, reconciled, notes, addToast, onClosingUpdated]);

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
  const qrTotal = (byMethod['qr_yape'] ?? 0) + (byMethod['qr_simple'] ?? 0);

  return (
    <div className="caja-close">
      <Card className="caja-close__card">
        <h3>{closing ? 'Corte de Caja Activo' : 'Corte de Caja'}</h3>

        {closing ? (
          <div className="caja-close__fields">
            <div className="caja-close__field">
              <label>Iniciado</label>
              <div className="caja-close__value">
                {new Date(closing.opened_at).toLocaleString('es-BO')}
              </div>
            </div>

            <div className="caja-close__field">
              <label>Efectivo esperado (ventas del día)</label>
              <div className="caja-close__value">
                Bs. {(closing.expected_cash ?? 0).toFixed(2)}
              </div>
            </div>

            <div className="caja-close__field">
              <label>Efectivo real en caja</label>
              <FormField
                type="number"
                variant="lg"
                className="form-input--mono"
                value={actualCash}
                step={0.01}
                onChange={e => setActualCash(parseFloat(e.target.value) || 0)}
              />
            </div>

            <div className="caja-close__field">
              <label>Diferencia</label>
              <div className={`caja-close__diff ${difference >= 0 ? 'positive' : 'negative'}`}>
                {difference >= 0 ? '+' : ''}Bs. {difference.toFixed(2)}
              </div>
            </div>

            <div className="caja-close__field">
              <label>Notas</label>
              <textarea
                className="caja-close__textarea"
                value={notes}
                onChange={e => setNotes(e.target.value)}
                placeholder="Observaciones del cierre..."
                rows={3}
              />
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
              <Button variant="secondary" onClick={() => setReconciled(r => !r)}>
                {reconciled ? 'Diferencia conciliada ✓' : 'Marcar diferencia conciliada'}
              </Button>
              <Button variant="secondary" onClick={() => setPrintOpen(true)} disabled={busy}>
                🖨️ Imprimir cierre
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
        <h3>Resumen de hoy</h3>
        <div className="caja-close__stats">
          <StatCard
            label="Total ventas"
            value={<span className="caja-stat caja-stat--gross">Bs. {(daily?.totalSales ?? 0).toFixed(2)}</span>}
          />
          <StatCard
            label="IVA total"
            value={<span className="caja-stat caja-stat--iva">Bs. {(daily?.totalIva ?? 0).toFixed(2)}</span>}
          />
          <StatCard
            label="Pedidos"
            value={<span className="caja-stat caja-stat--orders">{daily?.totalOrders ?? 0}</span>}
          />
        </div>

        <div className="caja-close__breakdown">
          <h4>Por método de pago</h4>
          <div className="caja-close__history-list">
            <div className="caja-close__history-item">
              <span>Ventas efectivo</span>
              <span className="caja-close__history-value">Bs. {(byMethod['cash'] ?? 0).toFixed(2)}</span>
            </div>
            <div className="caja-close__history-item">
              <span>Ventas QR</span>
              <span className="caja-close__history-value">Bs. {qrTotal.toFixed(2)}</span>
            </div>
            <div className="caja-close__history-item">
              <span>Ventas tarjeta</span>
              <span className="caja-close__history-value">Bs. {(byMethod['card'] ?? 0).toFixed(2)}</span>
            </div>
            <div className="caja-close__history-item">
              <span>Ventas transferencia</span>
              <span className="caja-close__history-value">Bs. {(byMethod['transfer'] ?? 0).toFixed(2)}</span>
            </div>
          </div>
        </div>
      </Card>

      {/* Print closing report */}
      <PrintReceipt
        open={printOpen}
        onClose={() => setPrintOpen(false)}
        kind="closing"
        receipt={{
          businessName: 'El Rey de la Chelada',
          date: new Date().toISOString(),
          totalSales: daily?.totalSales ?? 0,
          totalIva: daily?.totalIva ?? 0,
          totalOrders: daily?.totalOrders ?? 0,
          byMethod: { ...byMethod },
          expectedCash: expectedCash,
          actualCash: actualCash,
          difference: difference,
          reconciled: reconciled,
          notes: notes || undefined,
        }}
        label="Cierre de caja"
      />
    </div>
  );
}

export default ClosingView;
