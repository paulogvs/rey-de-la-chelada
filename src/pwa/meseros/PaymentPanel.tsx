/**
 * PaymentPanel — Payment processing (API-driven) — FASE 5 SIMPLIFICADO
 *
 * FASE 5 (2026-08-12): 1 SOLO método de pago por pedido (sin splits).
 *   - Monto a cobrar FIJO (order.total) — NO editable.
 *   - cash: campo "Efectivo recibido" → calcula el cambio a devolver.
 *          El efectivo ES dinero físico que entra al restobar (flujo de caja).
 *   - qr:   muestra la imagen QR ESTÁTICA del restobar (appConfig.payments).
 *          Botón 📷 "Tomar foto" del comprobante → se sube en base64 y se
 *          enlaza a la transacción (payments.proof_photo). El QR NO es
 *          dinero físico — va al flujo como "QR (digital)".
 *   - POST /api/payments (1 pago) → al completar, el server libera la mesa.
 */

import React, { useState, useEffect, useCallback } from 'react';
import type { Table, PaymentMethod } from '@/core/types';
import { Button } from '@/ui/components/Button';
import { Card } from '@/ui/components/Card';
import { Badge } from '@/ui/components/Badge';
import { PriceDisplay } from '@/ui/components/PriceDisplay';
import { Loader } from '@/ui/components/Loader';
import { SegmentedControl, type SegmentedOption } from '@/ui/components/SegmentedControl';
import { useToast } from '@/ui/components/Toast';
import { AppIcon } from '@/ui/components/AppIcon/AppIcon';
import { MoneyInput } from '@/ui/components/MoneyInput/MoneyInput';
import { apiFetch } from '../_shared/api/apiFetch';
import { processPayment, uploadPaymentProof } from '../_shared/api/paymentsApi';
import type { Order } from '../_shared/api/ordersApi';
import { PrintReceipt } from '../_shared/components/PrintReceipt';
import { buildReceiptData } from '../_shared/utils/receipt';
import { METHOD_LABELS, methodIcon } from '../_shared/utils/paymentMethods';
import { formatMoney } from '../_shared/utils/format';
import { appConfig } from '@/core/config/app.config';

interface PaymentPanelProps {
  orderId: string;
  table: Table;
  token: string;
  onPaymentComplete: () => void;
  onBack: () => void;
}

const METHOD_OPTIONS: SegmentedOption[] = [
  { value: 'cash', label: (<><AppIcon name={methodIcon('cash')} size="sm" /> {METHOD_LABELS.cash}</>) },
  { value: 'qr', label: (<><AppIcon name={methodIcon('qr')} size="sm" /> {METHOD_LABELS.qr}</>) },
];

export function PaymentPanel({ orderId, table, token, onPaymentComplete, onBack }: PaymentPanelProps) {
  const { addToast } = useToast();

  const [order, setOrder] = useState<Order | null>(null);
  const [loadingOrder, setLoadingOrder] = useState(true);
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [received, setReceived] = useState<number>(0);
  const [processing, setProcessing] = useState(false);
  const [printOpen, setPrintOpen] = useState(false);
  const [proofPhoto, setProofPhoto] = useState<string | null>(null);
  const [uploadingProof, setUploadingProof] = useState(false);

  // Config QR (FASE 5): imagen estática del restobar
  const qrEnabled = appConfig.all.payments.qrEnabled;
  const qrImageUrl = appConfig.all.payments.qrImageUrl;

  // Fetch fresh order from the server
  useEffect(() => {
    let disposed = false;
    (async () => {
      setLoadingOrder(true);
      try {
        const result = await apiFetch<{ success: boolean; order?: Order }>(`/api/orders/${orderId}`, {
          token,
        });
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
  const change = method === 'cash' && received > amountToCollect
    ? received - amountToCollect // v11: centavos exactos
    : 0;

  // Tomar foto del comprobante QR (FASE 5): lee el archivo y lo guarda en
  // estado (data URL). Se sube al server DESPUÉS de cobrar (necesita el
  // payment.id para enlazarlo como proof_photo).
  const handleTakePhoto = useCallback((file: File) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = () => {
      setProofPhoto(reader.result as string);
      addToast({ type: 'success', message: 'Foto lista — cobra para guardarla', duration: 3000 });
    };
    reader.readAsDataURL(file);
  }, [addToast]);

  // Procesar pago (1 solo método — FASE 5)
  const processPaymentNow = useCallback(async () => {
    if (!order) return;
    setProcessing(true);
    try {
      const result = await processPayment(token, {
        order_id: order.id,
        amount: amountToCollect,
        method,
        received: method === 'cash' && received > 0 ? received : undefined,
      });
      if (!result.ok) {
        addToast({ type: 'error', message: result.error || 'Error al registrar el pago', duration: 5000 });
        return;
      }

      // Si es QR y se tomó foto del comprobante → subirla enlazada al pago
      if (method === 'qr' && proofPhoto && result.payment?.id) {
        setUploadingProof(true);
        const upload = await uploadPaymentProof(token, result.payment.id, proofPhoto);
        setUploadingProof(false);
        if (!upload.ok) {
          addToast({ type: 'warning', message: upload.error || 'Pago OK pero no se guardó la foto', duration: 5000 });
        }
      }

      addToast({
        type: 'success',
        message: `Pago completado — Mesa ${table.number}`,
        duration: 3000,
      });
      setTimeout(onPaymentComplete, 500);
    } catch (err) {
      console.error('[PaymentPanel] process error:', err);
      addToast({ type: 'error', message: 'Error al procesar el pago', duration: 5000 });
    } finally {
      setProcessing(false);
    }
  }, [order, amountToCollect, method, received, proofPhoto, token, table.number, addToast, onPaymentComplete]);

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
      {/* Order summary */}
      <Card className="payment-panel__summary">
        <div className="payment-panel__summary-header">
          <h3>Resumen</h3>
          <Badge variant="info">Mesa {table.number}</Badge>
        </div>

        <div className="payment-panel__items">
          {order.items.map(item => (
            <div key={item.id} className="payment-panel__item">
              <span className="payment-panel__item-qty">{item.quantity}x</span>
              <span className="payment-panel__item-name">{item.menuItemName}</span>
              <span className="payment-panel__item-price">{formatMoney(item.subtotal)}</span>
            </div>
          ))}
        </div>

        <PriceDisplay
          priceWithIVA={order.total}
          showBreakdown
          className="payment-panel__total"
        />
      </Card>

      {/* Payment (FASE 5: 1 solo método, monto FIJO no editable) */}
      <Card className="payment-panel__splits">
        <div className="payment-panel__splits-header">
          <h4>Forma de pago</h4>
        </div>

        <SegmentedControl
          className="payment-panel__method"
          options={METHOD_OPTIONS}
          value={method}
          onChange={v => setMethod(v as PaymentMethod)}
        />

        {/* Monto a cobrar — FIJO, NO editable */}
        <div className="payment-panel__amount-fixed">
          <span className="payment-panel__amount-label">Monto a cobrar</span>
          <span className="payment-panel__amount-value">{formatMoney(amountToCollect)}</span>
        </div>

        {method === 'cash' && (
          <>
            <div className="payment-panel__cash-fields">
              <label htmlFor="payment-received" className="payment-panel__cash-label">
                Efectivo recibido (Bs) — dinero que entra al restobar
              </label>
              <MoneyInput
                id="payment-received"
                className="payment-panel__received"
                value={received}
                placeholder="Bs"
                onChange={setReceived}
              />
            </div>

            {change > 0 && (
              <p className="payment-panel__change">
                Cambio a devolver: <strong className="payment-panel__change-amount">{formatMoney(change)}</strong>
              </p>
            )}
          </>
        )}

        {method === 'qr' && (
          <div className="payment-panel__qr-block">
            {qrEnabled ? (
              <div className="payment-panel__split-qr">
                {/* QR ESTÁTICO del restobar — no se genera dinámicamente */}
                <img
                  src={qrImageUrl}
                  alt="QR de pago del restobar"
                  className="payment-panel__qr-image"
                />
                <p className="payment-panel__qr-hint">
                  El cliente escanea y transfiere <strong>{formatMoney(amountToCollect)}</strong>
                </p>
                <p className="payment-panel__qr-cashnote">
                  <AppIcon name="smartphone" size="sm" /> El QR NO es dinero físico — se registra como depósito digital en el flujo de caja.
                </p>

                <Button
                  variant="secondary"
                  fullWidth
                  onClick={() => document.getElementById('payment-proof-input')?.click()}
                  loading={uploadingProof}
                  disabled={uploadingProof || processing}
                >
                  <AppIcon name="camera" size="sm" /> {proofPhoto ? 'Cambiar foto del comprobante' : 'Tomar foto del comprobante'}
                </Button>
                <input
                  id="payment-proof-input"
                  type="file"
                  accept="image/*"
                  capture="environment"
                  style={{ display: 'none' }}
                  onChange={e => {
                    const file = e.target.files?.[0];
                    if (file) handleTakePhoto(file);
                    e.target.value = '';
                  }}
                />
                {proofPhoto && (
                  <img src={proofPhoto} alt="Comprobante" className="payment-panel__proof-preview" />
                )}
              </div>
            ) : (
              <div className="payment-panel__qr-disabled">
                <AppIcon name="alert" size="sm" /> El QR de pago no está configurado. El administrador debe subir la imagen del QR.
              </div>
            )}
          </div>
        )}

        <div className="payment-panel__remaining">
          <span>Total a pagar:</span>
          <span className="payment-panel__remaining-amount">{formatMoney(amountToCollect)}</span>
        </div>
      </Card>

      {/* Invoice info */}
      <Card className="payment-panel__invoice">
        <h4>Facturación</h4>
        <p className="payment-panel__invoice-text">
          {order.total >= 1000
            ? 'Monto mayor a Bs 1000 — requiere NIT para factura'
            : 'Factura sin NIT (consumidor final)'}
        </p>
      </Card>

      {/* Actions */}
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
          disabled={
            processing ||
            (method === 'cash' && received > 0 && received < amountToCollect) ||
            (method === 'qr' && !qrEnabled)
          }
          fullWidth
        >
          {processing ? 'Procesando...' : `Cobrar ${formatMoney(amountToCollect)}`}
        </Button>
      </div>

      {/* Print receipt overlay */}
      <PrintReceipt
        open={printOpen}
        onClose={() => setPrintOpen(false)}
        kind="order"
        receipt={buildReceiptData(order)}
        label={`Mesa ${table.number} — Pedido ${order.id.slice(0, 8)}`}
      />
    </div>
  );
}

export default PaymentPanel;
