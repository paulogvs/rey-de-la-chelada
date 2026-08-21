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
import { useToast } from '@/ui/components/Toast';
import { AppIcon } from '@/ui/components/AppIcon/AppIcon';
import { apiFetch } from '../_shared/api/apiFetch';
import { processMixedPayment, processPayment, uploadPaymentProof } from '../_shared/api/paymentsApi';
import { MixedPaymentEditor } from '../_shared/components/MixedPaymentEditor';
import { buildMixedPaymentPayload, previewAllocations } from '../_shared/utils/paymentAllocations';
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

export function PaymentPanel({ orderId, table, token, onPaymentComplete, onBack }: PaymentPanelProps) {
  const { addToast } = useToast();

  const [order, setOrder] = useState<Order | null>(null);
  const [loadingOrder, setLoadingOrder] = useState(true);
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [paymentMode, setPaymentMode] = useState<'simple' | 'mixed'>('simple');
  const [cashAmount, setCashAmount] = useState(0);
  const [qrAmount, setQrAmount] = useState(0);
  const [reference, setReference] = useState('');
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
  const preview = previewAllocations(amountToCollect, paymentMode === 'mixed'
    ? [
      ...(cashAmount > 0 ? [{ method: 'cash' as const, amount: cashAmount, received: received || undefined }] : []),
      ...(qrAmount > 0 ? [{ method: 'qr' as const, amount: qrAmount, reference }] : []),
    ]
    : [{ method, amount: amountToCollect, ...(method === 'cash' ? { received: received || amountToCollect } : {}) }]);

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
      const idempotencyKey = crypto.randomUUID();
      const result = paymentMode === 'mixed'
        ? await processMixedPayment(token, buildMixedPaymentPayload(order.id, [
          ...(cashAmount > 0 ? [{ method: 'cash' as const, amount: cashAmount, received: received || undefined }] : []),
          ...(qrAmount > 0 ? [{ method: 'qr' as const, amount: qrAmount, reference }] : []),
        ], idempotencyKey))
        : await processPayment(token, { order_id: order.id, amount: amountToCollect, method, reference, received: method === 'cash' ? (received || amountToCollect) : undefined, idempotency_key: idempotencyKey });
      if (!result.ok || (paymentMode === 'mixed' && (!preview.valid || preview.total !== amountToCollect))) {
        addToast({ type: 'error', message: result.error || 'Error al registrar el pago', duration: 5000 });
        return;
      }

      const qrPayments = 'payments' in result ? result.payments : (result.payment?.method === 'qr' && result.payment ? [result.payment] : []);
      if (proofPhoto && qrPayments.length > 0) {
        setUploadingProof(true);
        const uploads = await Promise.all(qrPayments.map(payment => uploadPaymentProof(token, payment.id, proofPhoto)));
        setUploadingProof(false);
        if (uploads.some(upload => !upload.ok)) {
          addToast({ type: 'warning', message: 'Pago OK pero no se guardó uno o más comprobantes', duration: 5000 });
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
  }, [order, amountToCollect, method, paymentMode, cashAmount, qrAmount, reference, received, proofPhoto, preview, token, table.number, addToast, onPaymentComplete]);

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

      <MixedPaymentEditor
        total={amountToCollect}
        mode={paymentMode}
        method={method}
        cashAmount={cashAmount}
        qrAmount={qrAmount}
        received={received}
        reference={reference}
        onModeChange={setPaymentMode}
        onMethodChange={setMethod}
        onCashAmountChange={setCashAmount}
        onQrAmountChange={setQrAmount}
        onReceivedChange={setReceived}
        onReferenceChange={setReference}
        qrEnabled={qrEnabled}
      />
      {(method === 'qr' || paymentMode === 'mixed') && qrEnabled && (
        <Card className="payment-panel__qr-block">
          <img src={qrImageUrl} alt="QR de pago del restobar" className="payment-panel__qr-image" />
          <Button variant="secondary" fullWidth onClick={() => document.getElementById('payment-proof-input')?.click()} loading={uploadingProof} disabled={uploadingProof || processing}>
            <AppIcon name="camera" size="sm" /> {proofPhoto ? 'Cambiar foto del comprobante' : 'Tomar foto del comprobante'}
          </Button>
          <input id="payment-proof-input" type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={e => { const file = e.target.files?.[0]; if (file) handleTakePhoto(file); e.target.value = ''; }} />
          {proofPhoto && <img src={proofPhoto} alt="Comprobante" className="payment-panel__proof-preview" />}
        </Card>
      )}

      {/* Invoice info */}
      <Card className="payment-panel__invoice">
        <h4>Facturación</h4>
        <p className="payment-panel__invoice-text">
          {order.total >= appConfig.all.invoicing.nitThreshold
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
            !preview.valid || (paymentMode === 'mixed' && preview.total !== amountToCollect) ||
            ((method === 'qr' || paymentMode === 'mixed') && !qrEnabled)
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
