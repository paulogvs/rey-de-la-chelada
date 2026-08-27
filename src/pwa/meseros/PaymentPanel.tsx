/**
 * PaymentPanel — Cobro (API-driven) — REDISEÑO 2026-08-26 v2
 *
 * Modelo DINÁMICO (intuitivo):
 *   💵 Efectivo (monto entregado)   → lo que el cliente da en efectivo
 *   📱 QR (monto)                   → lo que paga por QR
 *
 *   💱 CAMBIO (card SIEMPRE visible):
 *     - Se habilita cuando  Efectivo + QR > Pedido  → hay EXCESO a devolver
 *     - Cambio disponible = Efectivo + QR − Pedido
 *     - Se reparte: cambio en EFECTIVO (máx. lo que entró en efectivo) +
 *       el resto por QR (retiro, con foto opcional).
 *     - Validación: cambioEfectivo + cambioQr = cambioDisponible.
 *
 * Al cobrar (SSOT server):
 *   efectivoAplicado = Efectivo − cambioEfectivo   (cubre el pedido)
 *   qrAplicado       = QR − cambioQr
 *   efectivoAplicado + qrAplicado = Pedido  (siempre ✓ si el cambio cuadra)
 *   + retiro QR (transfer_out) por cambioQr (con foto)
 */

import React, { useState, useEffect, useCallback } from 'react';
import type { Table } from '@/core/types';
import { Button } from '@/ui/components/Button';
import { Card } from '@/ui/components/Card';
import { Badge } from '@/ui/components/Badge';
import { PriceDisplay } from '@/ui/components/PriceDisplay';
import { Loader } from '@/ui/components/Loader';
import { MoneyInput } from '@/ui/components/MoneyInput/MoneyInput';
import { useToast } from '@/ui/components/Toast';
import { AppIcon } from '@/ui/components/AppIcon/AppIcon';
import { processMixedPayment, processPayment, uploadPaymentProof } from '../_shared/api/paymentsApi';
import { buildMixedPaymentPayload } from '../_shared/utils/paymentAllocations';
import { fetchOrderById, type Order } from '../_shared/api/ordersApi';
import { PrintReceipt } from '../_shared/components/PrintReceipt';
import { buildReceiptData } from '../_shared/utils/receipt';
import { formatMoney } from '../_shared/utils/format';
import { appConfig } from '@/core/config/app.config';

interface PaymentPanelProps {
  orderId: string;
  table: Table;
  token: string;
  onPaymentComplete: () => void;
  onBack: () => void;
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function PaymentPanel({ orderId, table, token, onPaymentComplete, onBack }: PaymentPanelProps) {
  const { addToast } = useToast();

  const [order, setOrder] = useState<Order | null>(null);
  const [loadingOrder, setLoadingOrder] = useState(true);
  // Formas de pago
  const [cashGiven, setCashGiven] = useState(0);   // efectivo entregado por el cliente
  const [qrGiven, setQrGiven] = useState(0);       // monto pagado por QR
  const [proofPhotos, setProofPhotos] = useState<string[]>([]);      // fotos de pagos QR
  // Card CAMBIO
  const [changeCash, setChangeCash] = useState(0); // vuelto en efectivo
  const [changeQrPhotos, setChangeQrPhotos] = useState<string[]>([]); // fotos del retiro QR
  const [processing, setProcessing] = useState(false);
  const [printOpen, setPrintOpen] = useState(false);

  const qrEnabled = appConfig.all.payments.qrEnabled;
  const qrImageUrl = appConfig.all.payments.qrImageUrl;

  useEffect(() => {
    let disposed = false;
    (async () => {
      setLoadingOrder(true);
      try {
        // fetchOrderById NORMALIZA (camelCase) → resumen completo.
        // FIRMA: fetchOrderById(token, orderId) — token PRIMERO, orderId segundo.
        // (FIX 2026-08-27: estaban invertidos → el JWT iba como orderId en la
        // URL y el UUID como Bearer → 401 INVALID_TOKEN en cada cobro.)
        const result = await fetchOrderById(token, orderId);
        if (disposed) return;
        if (result.ok && result.order) {
          setOrder(result.order);
        } else {
          addToast({ type: 'error', message: result.error || 'No se pudo cargar el pedido', duration: 5000 });
        }
      } catch (err) {
        console.error('[PaymentPanel] load order error:', err);
        if (!disposed) addToast({ type: 'error', message: 'Error al cargar el pedido', duration: 5000 });
      } finally {
        if (!disposed) setLoadingOrder(false);
      }
    })();
    return () => { disposed = true; };
  }, [orderId, token, addToast]);

  const amountToCollect = order?.total ?? 0;

  // ── Cálculos dinámicos ──
  const hasQr = qrGiven > 0;
  // Exceso de pago → cambio disponible (Efectivo + QR − Pedido)
  const changeAvailable = Math.max(0, cashGiven + qrGiven - amountToCollect);
  const hasChange = changeAvailable > 0;
  // Reparto por defecto: todo el cambio en efectivo (si cabe), resto a QR
  useEffect(() => {
    if (!hasChange) { setChangeCash(0); return; }
    const maxCash = Math.min(changeAvailable, cashGiven);
    setChangeCash(maxCash);
  }, [changeAvailable, cashGiven, hasChange]);

  const changeQr = hasChange ? changeAvailable - changeCash : 0;
  const changeValid = !hasChange || (changeCash + changeQr === changeAvailable && changeCash <= cashGiven && changeQr <= qrGiven);

  // Montos aplicados al pedido
  const cashApplied = Math.max(0, cashGiven - changeCash);
  const qrApplied = Math.max(0, qrGiven - changeQr);
  const coversTotal = cashApplied + qrApplied === amountToCollect;
  const canPay = coversTotal && changeValid && (cashApplied > 0 || qrApplied > 0);

  const handleAddPhoto = useCallback(async (file: File, kind: 'qr' | 'change') => {
    if (!file) return;
    const dataUrl = await readFileAsDataUrl(file).catch(() => null);
    if (!dataUrl) { addToast({ type: 'error', message: 'No se pudo leer la imagen', duration: 3000 }); return; }
    if (kind === 'qr') setProofPhotos(prev => [...prev, dataUrl]);
    else setChangeQrPhotos(prev => [...prev, dataUrl]);
    addToast({ type: 'success', message: 'Comprobante agregado', duration: 2500 });
  }, [addToast]);

  const processPaymentNow = useCallback(async () => {
    if (!order) return;
    setProcessing(true);
    try {
      // 1. Cobro del pedido con los montos APLICADOS (netos de cambio)
      let qrPayments: Array<{ id: string }> = [];
      if (cashApplied > 0 && qrApplied > 0) {
        const result = await processMixedPayment(token, buildMixedPaymentPayload(order.id, [
          { method: 'cash', amount: cashApplied, received: cashGiven, change: changeCash },
          { method: 'qr', amount: qrApplied },
        ], crypto.randomUUID()));
        if (!result.ok) { addToast({ type: 'error', message: result.error || 'Error al registrar el pago', duration: 5000 }); return; }
        qrPayments = result.payments?.filter(p => p.method === 'qr') ?? [];
      } else if (cashApplied > 0) {
        const result = await processPayment(token, {
          order_id: order.id, amount: cashApplied, method: 'cash',
          received: cashGiven, change: changeCash, idempotency_key: crypto.randomUUID(),
        });
        if (!result.ok) { addToast({ type: 'error', message: result.error || 'Error al registrar el pago', duration: 5000 }); return; }
      } else if (qrApplied > 0) {
        const result = await processPayment(token, {
          order_id: order.id, amount: qrApplied, method: 'qr', idempotency_key: crypto.randomUUID(),
        });
        if (!result.ok) { addToast({ type: 'error', message: result.error || 'Error al registrar el pago', duration: 5000 }); return; }
        const payment = result.data?.payment;
        if (payment) qrPayments = [payment];
      }

      // 2. Retiro QR (cambio por QR) — transferencia saliente del local
      let changeQrPaymentId: string | null = null;
      if (changeQr > 0) {
        const retiro = await processPayment(token, {
          order_id: order.id, amount: changeQr, method: 'qr', transfer_out: true, idempotency_key: crypto.randomUUID(),
        });
        if (retiro.ok && retiro.data?.payment) changeQrPaymentId = retiro.data.payment.id;
        else addToast({ type: 'warning', message: 'Pago OK pero el retiro QR no se registró', duration: 5000 });
      }

      // 3. Subir fotos
      let uploadErrors = 0;
      if (proofPhotos.length > 0 && qrPayments.length > 0) {
        for (const photo of proofPhotos) for (const payment of qrPayments) {
          const up = await uploadPaymentProof(token, payment.id, photo); if (!up.ok) uploadErrors++;
        }
      }
      if (changeQrPhotos.length > 0 && changeQrPaymentId) {
        for (const photo of changeQrPhotos) {
          const up = await uploadPaymentProof(token, changeQrPaymentId, photo); if (!up.ok) uploadErrors++;
        }
      }
      if (uploadErrors > 0) addToast({ type: 'warning', message: 'Pago OK pero uno o más comprobantes no se guardaron', duration: 5000 });

      addToast({ type: 'success', message: `Pago completado — ${table.number === 0 ? 'Barra' : `Mesa ${table.number}`}`, duration: 3000 });
      setTimeout(onPaymentComplete, 500);
    } catch (err) {
      console.error('[PaymentPanel] process error:', err);
      addToast({ type: 'error', message: 'Error al procesar el pago', duration: 5000 });
    } finally {
      setProcessing(false);
    }
  }, [order, amountToCollect, cashApplied, qrApplied, cashGiven, changeCash, changeQr,
    proofPhotos, changeQrPhotos, token, table.number, addToast, onPaymentComplete]);

  if (loadingOrder) return <div className="payment-panel"><Loader block label="Cargando pedido…" /></div>;
  if (!order) {
    return <div className="payment-panel">
      <p className="payment-panel__loading">Pedido no encontrado</p>
      <Button variant="secondary" onClick={onBack}>Volver</Button>
    </div>;
  }

  return (
    <div className="payment-panel">
      {/* ── Resumen item por item ── */}
      <Card className="payment-panel__summary">
        <div className="payment-panel__summary-header">
          <h3>Resumen</h3>
          <Badge variant="info">{table.number === 0 ? 'BARRA' : `Mesa ${table.number}`}</Badge>
        </div>
        <div className="payment-panel__items">
          {order.items.map(item => {
            const mods = item.modifiers ?? [];
            return (
              <div key={item.id} className="payment-panel__item">
                <div className="payment-panel__item-main">
                  <span className="payment-panel__item-qty">{item.quantity}x</span>
                  <div className="payment-panel__item-info">
                    <span className="payment-panel__item-name">
                      {item.menuItemName}
                      {item.categoryName && <span className="payment-panel__item-cat">{item.categoryName}</span>}
                    </span>
                    {mods.length > 0 && (
                      <span className="payment-panel__item-mods">
                        {mods.map((m, i) => <span key={i} className="payment-panel__item-mod">{m.optionName}{m.priceAdjustment ? ` +${formatMoney(m.priceAdjustment)}` : ''}</span>)}
                      </span>
                    )}
                    {item.unitPrice != null && <span className="payment-panel__item-unit">c/u {formatMoney(item.unitPrice)}</span>}
                  </div>
                </div>
                <span className="payment-panel__item-price">{formatMoney(item.subtotal)}</span>
              </div>
            );
          })}
        </div>
        <PriceDisplay priceWithIVA={order.total} showBreakdown className="payment-panel__total" />
      </Card>

      {/* ── Formas de pago (lado a lado) ── */}
      <Card className="payment-panel__splits">
        <div className="payment-panel__splits-header"><h4>Formas de pago</h4></div>
        <div className="payment-panel__methods">
          <div className="payment-panel__method-block">
            <label className="payment-panel__method-label" htmlFor="pay-cash">
              <AppIcon name="banknote" size="sm" /> Efectivo (monto entregado)
            </label>
            <MoneyInput id="pay-cash" value={cashGiven} onChange={cents => setCashGiven(cents)} placeholder="0" />
          </div>
          <div className="payment-panel__method-block">
            <label className="payment-panel__method-label" htmlFor="pay-qr">
              <AppIcon name="smartphone" size="sm" /> QR (monto)
            </label>
            <MoneyInput id="pay-qr" value={qrGiven} onChange={cents => setQrGiven(cents)} placeholder="0" />
            {qrEnabled && qrImageUrl && hasQr && <img src={qrImageUrl} alt="QR de pago del restobar" className="payment-panel__qr-image" />}
            <Button variant="secondary" fullWidth disabled={qrGiven <= 0 || processing}
              onClick={() => document.getElementById('payment-proof-input')?.click()}
              title={qrGiven <= 0 ? 'Ingresa un monto QR para activar la cámara' : 'Tomar foto del comprobante'}>
              <AppIcon name="camera" size="sm" />
              {proofPhotos.length > 0 ? `Comprobantes (${proofPhotos.length}) — agregar` : 'Tomar fotografía'}
            </Button>
            {proofPhotos.length > 0 && <div className="payment-panel__proofs">
              {proofPhotos.map((photo, i) => <img key={i} src={photo} alt={`Comprobante QR ${i + 1}`} className="payment-panel__proof-thumb" />)}
            </div>}
            <input id="payment-proof-input" type="file" accept="image/*" capture="environment" style={{ display: 'none' }}
              onChange={e => { const file = e.target.files?.[0]; if (file) void handleAddPhoto(file, 'qr'); e.target.value = ''; }} />
          </div>
        </div>
      </Card>

      {/* ── Card CAMBIO (SIEMPRE visible, se habilita con exceso) ── */}
      <Card className={`payment-panel__change-card ${hasChange ? '' : 'payment-panel__change-card--idle'}`}>
        <div className="payment-panel__splits-header">
          <h4>CAMBIO</h4>
          <span className="payment-panel__change-total">
            {hasChange ? `Cambio disponible: ${formatMoney(changeAvailable)}` : 'Sin cambio (Efectivo + QR = Pedido)'}
          </span>
        </div>
        <div className="payment-panel__change-grid">
          <div>
            <label className="payment-panel__method-label" htmlFor="change-cash">Cambio en efectivo</label>
            <MoneyInput id="change-cash" value={changeCash} disabled={!hasChange} onChange={cents => setChangeCash(Math.min(cents, cashGiven))} placeholder="0" />
          </div>
          <div>
            <label className="payment-panel__method-label" htmlFor="change-qr">Cambio por QR</label>
            <MoneyInput id="change-qr" value={changeQr} disabled={!hasChange} onChange={() => {}} placeholder="0" />
          </div>
        </div>
        {!hasChange && <p className="payment-panel__change-hint">Ingresa más en Efectivo + QR que el total del pedido para habilitar el cambio.</p>}
        {hasChange && !changeValid && <p className="payment-panel__change-error">El cambio debe sumar {formatMoney(changeAvailable)} (efectivo ≤ {formatMoney(cashGiven)}, QR ≤ {formatMoney(qrGiven)}).</p>}
        {hasChange && changeQr > 0 && (
          <div className="payment-panel__change-qr-block">
            <Button variant="secondary" fullWidth disabled={processing}
              onClick={() => document.getElementById('change-proof-input')?.click()}>
              <AppIcon name="camera" size="sm" />
              {changeQrPhotos.length > 0 ? `Comprobantes retiro (${changeQrPhotos.length}) — agregar` : 'Tomar foto del retiro QR'}
            </Button>
            {changeQrPhotos.length > 0 && <div className="payment-panel__proofs">
              {changeQrPhotos.map((photo, i) => <img key={i} src={photo} alt={`Retiro QR ${i + 1}`} className="payment-panel__proof-thumb" />)}
            </div>}
            <input id="change-proof-input" type="file" accept="image/*" capture="environment" style={{ display: 'none' }}
              onChange={e => { const file = e.target.files?.[0]; if (file) void handleAddPhoto(file, 'change'); e.target.value = ''; }} />
          </div>
        )}
      </Card>

      {/* ── Acciones ── */}
      <div className="payment-panel__actions">
        <Button variant="secondary" onClick={onBack} disabled={processing}>Volver</Button>
        <Button variant="secondary" onClick={() => setPrintOpen(true)} disabled={processing}>
          <AppIcon name="printer" size="sm" /> Imprimir
        </Button>
        <Button variant="primary" onClick={processPaymentNow} loading={processing} disabled={processing || !canPay} fullWidth>
          {processing ? 'Procesando...' : `Cobrar ${formatMoney(amountToCollect)}`}
        </Button>
      </div>
      {!coversTotal && amountToCollect > 0 && (
        <p className="payment-panel__remaining">
          El cobro aplicado (Efectivo − cambio + QR − cambio) debe sumar {formatMoney(amountToCollect)}.
        </p>
      )}

      <PrintReceipt open={printOpen} onClose={() => setPrintOpen(false)} kind="order"
        receipt={buildReceiptData(order)}
        label={`${table.number === 0 ? 'BARRA' : `Mesa ${table.number}`} — Pedido ${order.id.slice(0, 8)}`} />
    </div>
  );
}

export default PaymentPanel;