/**
 * PaymentPanel — Cobro (API-driven) — REDISEÑO 2026-08-26
 *
 * Flujo directo SIN toggle "único/mixto":
 *   💵 EFECTIVO: monto del total en efectivo + lo que el cliente entrega
 *   📱 QR:       monto del total por QR + botón cámara (se activa con monto
 *                QR > 0) — permite TOMAR VARIAS FOTOS (varias personas pagan
 *                QR con comprobantes separados; todas se enlazan al pago).
 *   💱 CAMBIO:   card debajo de formas de pago (si hay vuelto: recibido > efectivo):
 *                cambio en EFECTIVO + cambio POR QR. Si el cambio es por QR,
 *                el local transfiere y se toma foto del comprobante (retiro QR).
 *
 * Modelo (SSOT server):
 *   - El cobro cubre el total: cashAmount + qrAmount = order.total
 *   - El vuelto total = received − cashAmount; se divide en cambioEfectivo +
 *     cambioQr (server valida la suma).
 *   - El retiro QR (cambioQr) se registra como payment qr transfer_out (amount
 *     negativo) — NO toca el saldo del pedido, SÍ afecta el QR del día.
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
import { apiFetch } from '../_shared/api/apiFetch';
import { processMixedPayment, processPayment, uploadPaymentProof } from '../_shared/api/paymentsApi';
import { buildMixedPaymentPayload } from '../_shared/utils/paymentAllocations';
import type { Order } from '../_shared/api/ordersApi';
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

/** Lee un archivo imagen → data URL */
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
  const [cashAmount, setCashAmount] = useState(0);   // del total, en efectivo
  const [received, setReceived] = useState(0);       // lo que entrega el cliente
  const [qrAmount, setQrAmount] = useState(0);       // del total, por QR
  const [proofPhotos, setProofPhotos] = useState<string[]>([]); // fotos de pagos QR
  // Card CAMBIO
  const [changeCash, setChangeCash] = useState(0);   // vuelto en efectivo
  const [changeQr, setChangeQr] = useState(0);       // vuelto por QR (retiro)
  const [changeQrPhotos, setChangeQrPhotos] = useState<string[]>([]); // fotos del retiro
  const [processing, setProcessing] = useState(false);
  const [printOpen, setPrintOpen] = useState(false);

  const qrEnabled = appConfig.all.payments.qrEnabled;
  const qrImageUrl = appConfig.all.payments.qrImageUrl;

  useEffect(() => {
    let disposed = false;
    (async () => {
      setLoadingOrder(true);
      try {
        const result = await apiFetch<{ success: boolean; order?: Order }>(`/api/orders/${orderId}`, { token });
        if (disposed) return;
        if (result.ok && result.data?.order) {
          setOrder(result.data.order as unknown as Order);
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

  // ── Cálculos ──
  const hasCash = cashAmount > 0;
  const hasQr = qrAmount > 0;
  // Vuelto total (solo efectivo con recibido mayor al monto efectivo aplicado)
  const totalChange = Math.max(0, received - cashAmount);
  const changeValid = totalChange === 0 || (changeCash + changeQr === totalChange);
  // El cobro cubre el total (con cambio, el efectivo aplicado cubre su parte)
  const coversTotal = cashAmount + qrAmount === amountToCollect;
  const canPay = coversTotal && changeValid && (hasCash || hasQr) && qrEnabled !== false;

  // ── Fotos ──
  const handleAddPhoto = useCallback(async (file: File, kind: 'qr' | 'change') => {
    if (!file) return;
    const dataUrl = await readFileAsDataUrl(file).catch(() => null);
    if (!dataUrl) {
      addToast({ type: 'error', message: 'No se pudo leer la imagen', duration: 3000 });
      return;
    }
    if (kind === 'qr') setProofPhotos(prev => [...prev, dataUrl]);
    else setChangeQrPhotos(prev => [...prev, dataUrl]);
    addToast({ type: 'success', message: 'Comprobante agregado', duration: 2500 });
  }, [addToast]);

  // ── Cobrar ──
  const processPaymentNow = useCallback(async () => {
    if (!order) return;
    setProcessing(true);
    try {
      const idempotencyKey = crypto.randomUUID();

      // 1. Cobro del pedido (cash + qr)
      let qrPayments: Array<{ id: string }> = [];
      if (hasCash && hasQr) {
        const result = await processMixedPayment(token, buildMixedPaymentPayload(order.id, [
          { method: 'cash', amount: cashAmount, received, change: changeCash },
          { method: 'qr', amount: qrAmount },
        ], idempotencyKey));
        if (!result.ok) {
          addToast({ type: 'error', message: result.error || 'Error al registrar el pago', duration: 5000 });
          return;
        }
        qrPayments = result.payments?.filter(p => p.method === 'qr') ?? [];
      } else if (hasCash) {
        const result = await processPayment(token, {
          order_id: order.id, amount: cashAmount, method: 'cash',
          received, change: changeCash, idempotency_key: idempotencyKey,
        });
        if (!result.ok) {
          addToast({ type: 'error', message: result.error || 'Error al registrar el pago', duration: 5000 });
          return;
        }
      } else if (hasQr) {
        const result = await processPayment(token, {
          order_id: order.id, amount: qrAmount, method: 'qr',
          idempotency_key: idempotencyKey,
        });
        if (!result.ok) {
          addToast({ type: 'error', message: result.error || 'Error al registrar el pago', duration: 5000 });
          return;
        }
        const payment = result.data?.payment;
        if (payment) qrPayments = [payment];
      }

      // 2. Retiro QR (cambio por QR) — transferencia saliente del local
      let changeQrPaymentId: string | null = null;
      if (changeQr > 0) {
        const retiro = await processPayment(token, {
          order_id: order.id, amount: changeQr, method: 'qr',
          transfer_out: true, idempotency_key: crypto.randomUUID(),
        });
        if (retiro.ok && retiro.data?.payment) {
          changeQrPaymentId = retiro.data.payment.id;
        } else {
          addToast({ type: 'warning', message: 'Pago OK pero el retiro QR no se registró', duration: 5000 });
        }
      }

      // 3. Subir fotos: cada foto QR → a todos los payments QR del cobro;
      //    fotos del retiro → al payment del retiro
      let uploadErrors = 0;
      if (proofPhotos.length > 0 && qrPayments.length > 0) {
        for (const photo of proofPhotos) {
          for (const payment of qrPayments) {
            const up = await uploadPaymentProof(token, payment.id, photo);
            if (!up.ok) uploadErrors++;
          }
        }
      }
      if (changeQrPhotos.length > 0 && changeQrPaymentId) {
        for (const photo of changeQrPhotos) {
          const up = await uploadPaymentProof(token, changeQrPaymentId, photo);
          if (!up.ok) uploadErrors++;
        }
      }
      if (uploadErrors > 0) {
        addToast({ type: 'warning', message: 'Pago OK pero uno o más comprobantes no se guardaron', duration: 5000 });
      }

      addToast({ type: 'success', message: `Pago completado — Mesa ${table.number}`, duration: 3000 });
      setTimeout(onPaymentComplete, 500);
    } catch (err) {
      console.error('[PaymentPanel] process error:', err);
      addToast({ type: 'error', message: 'Error al procesar el pago', duration: 5000 });
    } finally {
      setProcessing(false);
    }
  }, [order, amountToCollect, hasCash, hasQr, cashAmount, qrAmount, received, changeCash, changeQr,
    proofPhotos, changeQrPhotos, token, table.number, addToast, onPaymentComplete]);

  if (loadingOrder) {
    return <div className="payment-panel"><Loader block label="Cargando pedido…" /></div>;
  }

  if (!order) {
    return (
      <div className="payment-panel">
        <p className="payment-panel__loading">Pedido no encontrado</p>
        <Button variant="secondary" onClick={onBack}>Volver</Button>
      </div>
    );
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
                        {mods.map((m, i) => (
                          <span key={i} className="payment-panel__item-mod">
                            {m.optionName}{m.priceAdjustment ? ` +${formatMoney(m.priceAdjustment)}` : ''}
                          </span>
                        ))}
                      </span>
                    )}
                    {item.unitPrice != null && (
                      <span className="payment-panel__item-unit">c/u {formatMoney(item.unitPrice)}</span>
                    )}
                  </div>
                </div>
                <span className="payment-panel__item-price">{formatMoney(item.subtotal)}</span>
              </div>
            );
          })}
        </div>

        <PriceDisplay priceWithIVA={order.total} showBreakdown className="payment-panel__total" />
      </Card>

      {/* ── Formas de pago (directo) ── */}
      <Card className="payment-panel__splits">
        <div className="payment-panel__splits-header"><h4>Formas de pago</h4></div>

        <div className="payment-panel__method-block">
          <label className="payment-panel__method-label" htmlFor="pay-cash-amount">
            <AppIcon name="banknote" size="sm" /> Efectivo (monto)
          </label>
          <MoneyInput
            id="pay-cash-amount"
            value={cashAmount}
            onChange={cents => setCashAmount(cents)}
            placeholder="0"
          />
          <label className="payment-panel__method-label" htmlFor="pay-cash-received">
            Efectivo recibido
          </label>
          <MoneyInput
            id="pay-cash-received"
            value={received}
            onChange={cents => setReceived(cents)}
            placeholder="0"
          />
        </div>

        <div className="payment-panel__method-block">
          <label className="payment-panel__method-label" htmlFor="pay-qr-amount">
            <AppIcon name="smartphone" size="sm" /> QR (monto)
          </label>
          <MoneyInput
            id="pay-qr-amount"
            value={qrAmount}
            onChange={cents => setQrAmount(cents)}
            placeholder="0"
          />
          {qrEnabled && qrImageUrl && hasQr && (
            <img src={qrImageUrl} alt="QR de pago del restobar" className="payment-panel__qr-image" />
          )}
          <Button
            variant="secondary"
            fullWidth
            disabled={qrAmount <= 0 || processing}
            onClick={() => document.getElementById('payment-proof-input')?.click()}
            title={qrAmount <= 0 ? 'Ingresa un monto QR para activar la cámara' : 'Tomar foto del comprobante'}
          >
            <AppIcon name="camera" size="sm" />
            {proofPhotos.length > 0 ? `Comprobantes (${proofPhotos.length}) — agregar foto` : 'Tomar fotografía'}
          </Button>
          {proofPhotos.length > 0 && (
            <div className="payment-panel__proofs">
              {proofPhotos.map((photo, i) => (
                <img key={i} src={photo} alt={`Comprobante QR ${i + 1}`} className="payment-panel__proof-thumb" />
              ))}
            </div>
          )}
          <input id="payment-proof-input" type="file" accept="image/*" capture="environment" style={{ display: 'none' }}
            onChange={e => { const file = e.target.files?.[0]; if (file) void handleAddPhoto(file, 'qr'); e.target.value = ''; }} />
        </div>
      </Card>

      {/* ── Card CAMBIO (si hay vuelto) ── */}
      {totalChange > 0 && (
        <Card className="payment-panel__change-card">
          <div className="payment-panel__splits-header">
            <h4>CAMBIO</h4>
            <span className="payment-panel__change-total">Vuelto: {formatMoney(totalChange)}</span>
          </div>
          <div className="payment-panel__change-grid">
            <div>
              <label className="payment-panel__method-label" htmlFor="change-cash">Cambio en efectivo</label>
              <MoneyInput id="change-cash" value={changeCash} onChange={cents => setChangeCash(cents)} placeholder="0" />
            </div>
            <div>
              <label className="payment-panel__method-label" htmlFor="change-qr">Cambio por QR</label>
              <MoneyInput id="change-qr" value={changeQr} onChange={cents => setChangeQr(cents)} placeholder="0" />
            </div>
          </div>
          {!changeValid && (
            <p className="payment-panel__change-error">El cambio debe sumar {formatMoney(totalChange)}</p>
          )}

          {changeQr > 0 && (
            <div className="payment-panel__change-qr-block">
              <Button
                variant="secondary"
                fullWidth
                disabled={processing}
                onClick={() => document.getElementById('change-proof-input')?.click()}
              >
                <AppIcon name="camera" size="sm" />
                {changeQrPhotos.length > 0 ? `Comprobantes retiro (${changeQrPhotos.length}) — agregar` : 'Tomar foto del retiro QR'}
              </Button>
              {changeQrPhotos.length > 0 && (
                <div className="payment-panel__proofs">
                  {changeQrPhotos.map((photo, i) => (
                    <img key={i} src={photo} alt={`Retiro QR ${i + 1}`} className="payment-panel__proof-thumb" />
                  ))}
                </div>
              )}
              <input id="change-proof-input" type="file" accept="image/*" capture="environment" style={{ display: 'none' }}
                onChange={e => { const file = e.target.files?.[0]; if (file) void handleAddPhoto(file, 'change'); e.target.value = ''; }} />
            </div>
          )}
        </Card>
      )}

      {/* ── Acciones ── */}
      <div className="payment-panel__actions">
        <Button variant="secondary" onClick={onBack} disabled={processing}>
          Volver
        </Button>
        <Button variant="secondary" onClick={() => setPrintOpen(true)} disabled={processing}>
          <AppIcon name="printer" size="sm" /> Imprimir
        </Button>
        <Button
          variant="primary"
          onClick={processPaymentNow}
          loading={processing}
          disabled={processing || !canPay}
          fullWidth
        >
          {processing ? 'Procesando...' : `Cobrar ${formatMoney(amountToCollect)}`}
        </Button>
      </div>
      {!coversTotal && amountToCollect > 0 && (
        <p className="payment-panel__remaining">
          Faltan {formatMoney(Math.max(0, amountToCollect - cashAmount - qrAmount))} — el efectivo + QR deben sumar el total.
        </p>
      )}

      <PrintReceipt
        open={printOpen}
        onClose={() => setPrintOpen(false)}
        kind="order"
        receipt={buildReceiptData(order)}
        label={`${table.number === 0 ? 'BARRA' : `Mesa ${table.number}`} — Pedido ${order.id.slice(0, 8)}`}
      />
    </div>
  );
}

export default PaymentPanel;