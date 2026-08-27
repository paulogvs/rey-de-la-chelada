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

import React, { useState, useEffect, useCallback, useRef } from 'react';
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
import { buildMixedPaymentPayload, resolveChangeSplit, resolveChangeFromCash, resolveChangeFromQr, shouldClearChangePhotos, shouldClearProofPhotos } from '../_shared/utils/paymentAllocations';
import { fetchOrderById, type Order } from '../_shared/api/ordersApi';
import { PrintReceipt } from '../_shared/components/PrintReceipt';
import { buildReceiptData } from '../_shared/utils/receipt';
import { formatMoney, formatTableRef } from '../_shared/utils/format';
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

/**
 * Convierte una foto a data URL COMPRIMIDA (reescala a máx ~1280px, JPEG q0.8).
 * FIX 2026-08-27: las fotos `capture="environment"` en base64 pesan 3-8 MB —
 * superaban el límite del body-parser → "comprobantes no se guardaron".
 * Al comprimir en el cliente (canvas) la foto baja a <300 KB y sube sin error,
 * además de no llenar el disco con PNGs gigantes.
 */
async function compressImageToDataUrl(file: File, maxDim = 1280, quality = 0.8): Promise<string> {
  const original = await readFileAsDataUrl(file).catch(() => null);
  if (!original || typeof document === 'undefined') return original ?? '';
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = reject;
      el.src = original;
    });
    const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
    if (scale >= 1) return original; // ya es chica, no comprimir
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) return original;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', quality);
  } catch {
    return original; // si falla el canvas, usa la original (sigue el límite global)
  }
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
  // Reparto del cambio (FIX 2026-08-27): función pura testeable que respeta
  // el rango factible (cambio QR nunca supera lo pagado por QR).
  const changeSplit = resolveChangeSplit(changeAvailable, cashGiven, qrGiven);
  const minChangeCash = changeSplit.minChangeCash;
  const maxChangeCash = changeSplit.maxChangeCash;
  // MEJORA 3 (OPCIÓN A): el EFECTIVO es el estado editable; el QR se DERIVA
  // para que SIEMPRE sumen changeAvailable. Ambos inputs son editables y al
  // escribir en uno el otro se recalcula. Ninguno puede exceder changeAvailable.
  const changeQr = hasChange ? Math.max(0, changeAvailable - changeCash) : 0;
  const changeValid = changeQr >= 0 && changeQr <= qrGiven && changeCash >= 0 && changeCash <= cashGiven;

  // Montos aplicados al pedido
  const cashApplied = Math.max(0, cashGiven - changeCash);
  const qrApplied = Math.max(0, qrGiven - changeQr);
  const coversTotal = cashApplied + qrApplied === amountToCollect;
  const canPay = coversTotal && changeValid && (cashApplied > 0 || qrApplied > 0);

  // Sincronizar changeCash con el DEFAULT de resolveChangeSplit cuando cambian los
  // montos y el usuario AÚN no ha editado el cambio manualmente (ref changeTouched).
  // Si ya editó, se respeta y se clampea al rango factible [minChangeCash, maxChangeCash].
  const changeTouched = useRef(false);
  useEffect(() => {
    if (!hasChange) { setChangeCash(0); changeTouched.current = false; return; }
    setChangeCash(prev => {
      const clamped = Math.min(maxChangeCash, Math.max(minChangeCash, prev));
      return changeTouched.current ? clamped : changeSplit.changeCash;
    });
  }, [changeAvailable, cashGiven, qrGiven, hasChange, minChangeCash, maxChangeCash]);

  // MEJORA 4 (2026-08-27): auto-limpiar fotos cuando el medio de pago ya no aplica.
  // El comprobante debe corresponder a un medio de pago que SÍ se usó:
  //  - sin "cambio por QR" (changeQr<=0) → sobran las fotos del retiro QR.
  //  - sin monto QR aplicado (qrApplied<=0) → sobran las fotos del pago QR.
  useEffect(() => {
    if (shouldClearChangePhotos(changeQr)) setChangeQrPhotos(prev => (prev.length ? [] : prev));
  }, [changeQr]);
  useEffect(() => {
    if (shouldClearProofPhotos(qrApplied)) setProofPhotos(prev => (prev.length ? [] : prev));
  }, [qrApplied]);

  const handleAddPhoto = useCallback(async (file: File, kind: 'qr' | 'change') => {
    if (!file) return;
    // FIX 2026-08-27: comprimir la foto (canvas, máx 1280px, JPEG q0.8) para
    // que el data URL no supere el límite del body-parser → ya no falla
    // "comprobantes no se guardaron".
    const dataUrl = await compressImageToDataUrl(file).catch(() => null);
    if (!dataUrl) { addToast({ type: 'error', message: 'No se pudo leer la imagen', duration: 3000 }); return; }
    if (kind === 'qr') setProofPhotos(prev => [...prev, dataUrl]);
    else setChangeQrPhotos(prev => [...prev, dataUrl]);
    addToast({ type: 'success', message: 'Comprobante agregado', duration: 2500 });
  }, [addToast]);

  // Eliminar una foto del estado local (no subida al server todavía).
  const handleRemovePhoto = useCallback((kind: 'qr' | 'change', index: number) => {
    if (kind === 'qr') setProofPhotos(prev => prev.filter((_, i) => i !== index));
    else setChangeQrPhotos(prev => prev.filter((_, i) => i !== index));
  }, []);

  // MEJORA 3 (OPCIÓN A): cambiar EN EFECTIVO → el QR se recalcula (suma a changeAvailable).
  const handleChangeCashInput = useCallback((cents: number) => {
    changeTouched.current = true;
    setChangeCash(resolveChangeFromCash(changeAvailable, cents, cashGiven, qrGiven).changeCash);
  }, [changeAvailable, cashGiven, qrGiven]);

  // MEJORA 3: cambiar EN QR → el efectivo se recalcula (suma a changeAvailable).
  const handleChangeQrInput = useCallback((cents: number) => {
    changeTouched.current = true;
    setChangeCash(resolveChangeFromQr(changeAvailable, cents, cashGiven, qrGiven).changeCash);
  }, [changeAvailable, cashGiven, qrGiven]);

  const processPaymentNow = useCallback(async () => {
    if (!order) return;
    // MEJORA 3 (refuerzo): validar SIEMPRE que lo pagado − el cambio = monto del pedido.
    // Aunque `canPay` ya lo cubre, este guard evita un cobro fuera de equilibrio.
    if (!coversTotal) {
      addToast({ type: 'error', message: 'El cobro no cuadra: revisá Montos y Cambio', duration: 4000 });
      return;
    }
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

      // 3. Subir fotos — FIX 2026-08-27: antes hacía producto cartesiano
      // (cada foto × cada pago QR = N×M subidas). Ahora cada foto se sube
      // UNA sola vez al primer pago QR del pedido (los comprobantes son del
      // pedido, no por transacción). Evita subidas duplicadas e innecesarias.
      let uploadErrors = 0;
      const qrTarget = qrPayments[0];
      if (proofPhotos.length > 0 && qrTarget) {
        for (const photo of proofPhotos) {
          const up = await uploadPaymentProof(token, qrTarget.id, photo); if (!up.ok) uploadErrors++;
        }
      }
      if (changeQrPhotos.length > 0 && changeQrPaymentId) {
        for (const photo of changeQrPhotos) {
          const up = await uploadPaymentProof(token, changeQrPaymentId, photo); if (!up.ok) uploadErrors++;
        }
      }
      if (uploadErrors > 0) addToast({ type: 'warning', message: 'Pago OK pero uno o más comprobantes no se guardaron', duration: 5000 });

      addToast({ type: 'success', message: `Pago completado — ${formatTableRef(table.number)}`, duration: 3000 });
      setTimeout(onPaymentComplete, 500);
    } catch (err) {
      console.error('[PaymentPanel] process error:', err);
      addToast({ type: 'error', message: 'Error al procesar el pago', duration: 5000 });
    } finally {
      setProcessing(false);
    }
  }, [order, amountToCollect, cashApplied, qrApplied, cashGiven, changeCash, changeQr,
    coversTotal, proofPhotos, changeQrPhotos, token, table.number, addToast, onPaymentComplete]);

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
          <Badge variant="info">{formatTableRef(table.number)}</Badge>
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
            <MoneyInput id="pay-cash" className="payment-panel__money" value={cashGiven} onChange={cents => setCashGiven(cents)} placeholder="0" />
          </div>
          <div className="payment-panel__method-block">
            <label className="payment-panel__method-label" htmlFor="pay-qr">
              <AppIcon name="smartphone" size="sm" /> QR (monto)
            </label>
            <MoneyInput id="pay-qr" className="payment-panel__money" value={qrGiven} onChange={cents => setQrGiven(cents)} placeholder="0" />
            {qrEnabled && qrImageUrl && hasQr && <img src={qrImageUrl} alt="QR de pago del restobar" className="payment-panel__qr-image" />}
            <Button variant="secondary" fullWidth disabled={qrGiven <= 0 || processing}
              onClick={() => document.getElementById('payment-proof-input')?.click()}
              title={qrGiven <= 0 ? 'Ingresa un monto QR para activar la cámara' : 'Tomar foto del comprobante'}>
              <AppIcon name="camera" size="sm" />
              {proofPhotos.length > 0 ? `Comprobantes (${proofPhotos.length}) — agregar` : 'Tomar fotografía'}
            </Button>
            {proofPhotos.length > 0 && <div className="payment-panel__proofs">
              {proofPhotos.map((photo, i) => (
                <div className="payment-panel__proof-thumb-wrap" key={`qr-${i}`}>
                  <img src={photo} alt={`Comprobante QR ${i + 1}`} className="payment-panel__proof-thumb" />
                  <button type="button" className="payment-panel__proof-remove" aria-label="Eliminar comprobante"
                    onClick={() => handleRemovePhoto('qr', i)}>×</button>
                </div>
              ))}
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
            <MoneyInput id="change-cash" className="payment-panel__money" value={changeCash} disabled={!hasChange} onChange={handleChangeCashInput} placeholder="0" />
          </div>
          <div>
            <label className="payment-panel__method-label" htmlFor="change-qr">Cambio por QR</label>
            <MoneyInput id="change-qr" className="payment-panel__money" value={changeQr} disabled={!hasChange} onChange={handleChangeQrInput} placeholder="0" />
          </div>
        </div>
        {!hasChange && <p className="payment-panel__change-hint">Ingresa más en Efectivo + QR que el total del pedido para habilitar el cambio.</p>}
        {hasChange && qrGiven === 0 && (
          <p className="payment-panel__change-hint">
            Sin pago por QR: el cambio se entrega solo en efectivo ({formatMoney(changeAvailable)}).
          </p>
        )}
        {hasChange && qrGiven > 0 && (
          <p className="payment-panel__change-hint">
            Repartí el cambio entre efectivo y QR (el QR no puede superar lo pagado por QR).
          </p>
        )}
        {hasChange && !changeValid && <p className="payment-panel__change-error">El cambio debe sumar {formatMoney(changeAvailable)} (efectivo ≤ {formatMoney(cashGiven)}, QR ≤ {formatMoney(qrGiven)}).</p>}
        {hasChange && changeQr > 0 && (
          <div className="payment-panel__change-qr-block">
            <Button variant="secondary" fullWidth disabled={processing}
              onClick={() => document.getElementById('change-proof-input')?.click()}>
              <AppIcon name="camera" size="sm" />
              {changeQrPhotos.length > 0 ? `Comprobantes retiro (${changeQrPhotos.length}) — agregar` : 'Tomar foto del retiro QR'}
            </Button>
            {changeQrPhotos.length > 0 && <div className="payment-panel__proofs">
              {changeQrPhotos.map((photo, i) => (
                <div className="payment-panel__proof-thumb-wrap" key={`chg-${i}`}>
                  <img src={photo} alt={`Retiro QR ${i + 1}`} className="payment-panel__proof-thumb" />
                  <button type="button" className="payment-panel__proof-remove" aria-label="Eliminar comprobante retiro"
                    onClick={() => handleRemovePhoto('change', i)}>×</button>
                </div>
              ))}
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
        label={`${formatTableRef(table.number)} — Pedido ${order.id.slice(0, 8)}`} />
    </div>
  );
}

export default PaymentPanel;