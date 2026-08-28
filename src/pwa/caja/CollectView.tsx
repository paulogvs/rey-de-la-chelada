/**
 * Caja — CollectView (S2-C): pedidos pendientes de cobro
 *
 * Flujo primario, última milla: la caja ve los pedidos servidos/activos
 * que esperan cobro, revisa su detalle y cobra con POST /api/payments
 * (mismo contrato que meseros: { order_id, amount, method, received }).
 * FASE 3: sin propina; efectivo con received/change (vuelto al centavo).
 * El server libera la mesa al pagar completo (payments.js processPayment).
 *
 * Datos (SSOT server): GET /api/orders?pending=1 → orders con total,
 * paid_amount e items. La lista se refresca con refreshTick (WS S2-D).
 */

import React, { useState, useEffect, useCallback } from 'react';
import { fetchPendingOrders, type Order } from '../_shared/api/ordersApi';
import { processMixedPayment, processPayment, uploadPaymentProof } from '../_shared/api/paymentsApi';
import { printOrderTicket } from '../_shared/api/printApi';
import { safeId } from '../_shared/utils/safeId';
import { Card } from '@/ui/components/Card';
import { Button } from '@/ui/components/Button';
import { Badge } from '@/ui/components/Badge';
import { Loader } from '@/ui/components/Loader';
import { EmptyState } from '@/ui/components/EmptyState';
import { PriceDisplay } from '@/ui/components/PriceDisplay';
import { SegmentedControl, type SegmentedOption } from '@/ui/components/SegmentedControl';
import { useToast } from '@/ui/components/Toast';
import { AppIcon } from '@/ui/components/AppIcon/AppIcon';
import { MoneyInput } from '@/ui/components/MoneyInput/MoneyInput';
import { METHOD_LABELS, methodIcon, PAYMENT_METHODS } from '../_shared/utils/paymentMethods';
import { formatMoney } from '../_shared/utils/format';
import { appConfig } from '@/core/config/app.config';
import { buildMixedPaymentPayload } from '../_shared/utils/paymentAllocations';
import './CollectView.css';

interface CollectViewProps {
  token: string;
  refreshTick: number;
  /** Se llama tras un cobro completo (para que App refresque todo) */
  onPaid: (orderId: string) => void;
}

const STATUS_LABELS: Record<string, string> = {
  called: 'Enviado',
  confirmed: 'Confirmado',
  preparing: 'En preparación',
  ready: 'Listo',
  served: 'Servido',
};

const STATUS_VARIANTS: Record<string, 'pending' | 'preparing' | 'ready' | 'paid' | 'info'> = {
  called: 'pending',
  confirmed: 'pending',
  preparing: 'preparing',
  ready: 'ready',
  served: 'paid',
};

/** Método de pago como opciones del SegmentedControl (Premium Minimal). */
const PAYMENT_OPTIONS: SegmentedOption[] = PAYMENT_METHODS.map(m => ({
  value: m,
  label: (<><AppIcon name={methodIcon(m)} size="sm" /> {METHOD_LABELS[m]}</>),
}));

/** Saldo pendiente de un pedido (total − pagos completed). SSOT server. */
export function orderRemaining(order: Order): number {
  return Math.max(0, order.total - order.paidAmount); // v11: centavos exactos
}

export function CollectView({ token, refreshTick, onPaid }: CollectViewProps) {
  const { addToast } = useToast();

  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [method, setMethod] = useState<(typeof PAYMENT_METHODS)[number]>('cash');
  const [paymentMode, setPaymentMode] = useState<'simple' | 'mixed'>('simple');
  const [cashAmount, setCashAmount] = useState(0);
  const [qrAmount, setQrAmount] = useState(0);
  const [reference, setReference] = useState('');
  const [received, setReceived] = useState(0);
  const [paying, setPaying] = useState(false);
  // FASE 5: foto del comprobante QR (data URL) — se sube tras cobrar
  const [proofPhoto, setProofPhoto] = useState<string | null>(null);
  const [uploadingProof, setUploadingProof] = useState(false);
  const [breakdowns, setBreakdowns] = useState<Record<string, { cash: number; qr: number }>>({});

  const qrEnabled = appConfig.all.payments.qrEnabled;
  const qrImageUrl = appConfig.all.payments.qrImageUrl;

  const handleTakePhoto = useCallback((file: File) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = () => {
      setProofPhoto(reader.result as string);
      addToast({ type: 'success', message: 'Foto lista — cobra para guardarla', duration: 3000 });
    };
    reader.readAsDataURL(file);
  }, [addToast]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await fetchPendingOrders(token);
      if (!result.ok) {
        setError(result.error || 'No se pudieron cargar los pedidos pendientes');
        return;
      }
      setOrders(result.orders);
      setError(null);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load, refreshTick]);

  const pendingTotal = orders.reduce((sum, o) => sum + orderRemaining(o), 0);

  const handlePay = useCallback(
    async (order: Order) => {
      setPaying(true);
      try {
        const remaining = orderRemaining(order);
        if (remaining <= 0) {
          addToast({ type: 'warning', message: 'El pedido ya está cubierto', duration: 3000 });
          return;
        }
        const idempotencyKey = safeId();
        const allocationInputs = [
          ...(cashAmount > 0 ? [{ method: 'cash' as const, amount: cashAmount, received: received || undefined }] : []),
          ...(qrAmount > 0 ? [{ method: 'qr' as const, amount: qrAmount, reference }] : []),
        ];
        const result = paymentMode === 'mixed'
          ? await processMixedPayment(token, buildMixedPaymentPayload(order.id, allocationInputs, idempotencyKey))
          : await processPayment(token, { order_id: order.id, amount: remaining, method, idempotency_key: idempotencyKey, reference, received: method === 'cash' ? (received || remaining) : undefined });
        if (!result.ok) {
          addToast({ type: 'error', message: result.error || 'Error al procesar el pago', duration: 5000 });
          return;
        }
        if ('byMethod' in result) setBreakdowns(current => ({ ...current, [order.id]: result.byMethod }));

        // FASE 5: si es QR y hay foto → subir enlazada al pago
        const qrPayments = 'payments' in result ? result.payments : (result.payment?.method === 'qr' && result.payment ? [result.payment] : []);
        if (proofPhoto && qrPayments.length > 0) {
          setUploadingProof(true);
          const uploads = await Promise.all(qrPayments.map(payment => uploadPaymentProof(token, payment.id, proofPhoto)));
          setUploadingProof(false);
          if (uploads.some(upload => !upload.ok)) {
            addToast({ type: 'warning', message: 'Pago OK pero no se guardó uno o más comprobantes', duration: 5000 });
          }
        }

        const fullyPaid = 'isFullyPaid' in result ? result.isFullyPaid : result.fullyPaid;
        if (fullyPaid) {
          addToast({
            type: 'success',
            message: `Mesa ${order.tableNumber} cobrada`,
            duration: 3000,
          });
          // v14: imprimir ticket térmico (server-side, impresora de Windows).
          // No bloquea el cobro: si falla, avisamos sin romper el flujo.
          const paymentId =
            'payment' in result && result.payment?.id
              ? result.payment.id
              : ('payments' in result && Array.isArray(result.payments) && result.payments[0]?.id) || undefined;
          const print = await printOrderTicket(token, order.id, paymentId);
          if (!print.ok) {
            addToast({
              type: 'warning',
              message: `Mesa cobrada pero no se imprimió el ticket: ${print.error || 'revisa la impresora'}`,
              duration: 6000,
            });
          }
          onPaid(order.id);
          setExpandedId(null);
          setProofPhoto(null);
        } else {
          addToast({
            type: 'info',
            message: `Pago parcial — restante ${formatMoney(result.remaining)}`,
            duration: 3000,
          });
        }
        load();
      } catch (err) {
        console.error('[CollectView] pay error:', err);
        addToast({ type: 'error', message: 'Error al procesar el pago', duration: 5000 });
      } finally {
        setPaying(false);
      }
    },
    [token, method, paymentMode, cashAmount, qrAmount, reference, received, proofPhoto, addToast, onPaid, load]
  );

  if (loading && orders.length === 0) {
    return (
      <div className="caja-collect">
        <Loader variant="block" label="Cargando pedidos pendientes…" />
      </div>
    );
  }

  return (
    <div className="caja-collect">
      {/* Resumen */}
      <Card className="caja-collect__summary">
        <div className="caja-collect__summary-label">
          {orders.length === 0
            ? 'Sin pedidos pendientes'
            : `${orders.length} pedido${orders.length === 1 ? '' : 's'} pendiente${orders.length === 1 ? '' : 's'} de cobro`}
        </div>
        <div className="caja-collect__summary-value">
          {orders.length === 0 ? <AppIcon name="check" size="md" /> : formatMoney(pendingTotal)}
        </div>
      </Card>

      {error && (
        <Card className="caja-collect__error">
          <p>{error}</p>
          <Button variant="secondary" size="sm" onClick={load}>Reintentar</Button>
        </Card>
      )}

      {!error && orders.length === 0 && (
        <EmptyState
          icon={<AppIcon name="wallet" size="lg" />}
          message="No hay pedidos esperando cobro. Los pedidos servidos o en preparación aparecerán aquí."
        />
      )}

      <div className="caja-collect__list">
        {orders.map(order => {
          const remaining = orderRemaining(order);
          const isExpanded = expandedId === order.id;
          const change = method === 'cash' && received > remaining
            ? received - remaining // v11: centavos exactos
            : 0;
          return (
            <Card key={order.id} padded={false} className="caja-collect__order">
              <button
                className="caja-collect__order-head"
                onClick={() => setExpandedId(isExpanded ? null : order.id)}
                aria-expanded={isExpanded}
              >
                <span className="caja-collect__order-table">Mesa {order.tableNumber}</span>
                <Badge variant={STATUS_VARIANTS[order.status] ?? 'info'}>
                  {STATUS_LABELS[order.status] ?? order.status}
                </Badge>
                <span className="caja-collect__order-items">
                  {order.items.reduce((n, i) => n + i.quantity, 0)} items
                </span>
                <span className="caja-collect__order-amount">
                  {formatMoney(remaining)}
                </span>
                <span className="caja-collect__order-caret" aria-hidden="true">
                  {isExpanded ? <AppIcon name="chevron-up" size="sm" /> : <AppIcon name="chevron-down" size="sm" />}
                </span>
              </button>

              {isExpanded && (
                <div className="caja-collect__order-detail">
                  <div className="caja-collect__order-items-list">
                    {order.items.map(item => (
                      <div key={item.id} className="caja-collect__item">
                        <span className="caja-collect__item-qty">{item.quantity}x</span>
                        <span className="caja-collect__item-name">{item.menuItemName}</span>
                        <span className="caja-collect__item-price">{formatMoney(item.subtotal)}</span>
                      </div>
                    ))}
                  </div>

                  <PriceDisplay
                    priceWithIVA={order.total}
                    showBreakdown
                    className="caja-collect__order-total"
                  />
                   {order.paidAmount > 0 && (
                    <p className="caja-collect__paid-hint">
                      Ya cobrado: {formatMoney(order.paidAmount)} · Saldo: {formatMoney(remaining)}
                    </p>
                   )}
                  {breakdowns[order.id] && (
                    <p className="caja-collect__paid-hint">
                      Último cobro server: efectivo {formatMoney(breakdowns[order.id].cash)} · QR {formatMoney(breakdowns[order.id].qr)}
                    </p>
                  )}

                  {/* Cobro */}
                  <div className="caja-collect__pay">
                    <div className="caja-collect__pay-field">
                      <span className="caja-collect__pay-label" id={`method-label-${order.id}`}>Método</span>
                      <SegmentedControl
                        className="caja-collect__pay-method"
                        options={PAYMENT_OPTIONS}
                        value={method}
                        onChange={v => setMethod(v as (typeof PAYMENT_METHODS)[number])}
                      />
                    </div>

                    <div className="caja-collect__pay-field">
                      <fieldset className="caja-collect__pay-group">
                        <legend className="caja-collect__pay-label">Modalidad</legend>
                        <SegmentedControl options={[{ value: 'simple', label: 'Un método' }, { value: 'mixed', label: 'Mixto' }]} value={paymentMode} onChange={value => setPaymentMode(value as 'simple' | 'mixed')} />
                      </fieldset>
                    </div>

                    {paymentMode === 'mixed' ? (
                      <div className="caja-collect__pay-field">
                        <label htmlFor={`mixed-cash-${order.id}`}>Efectivo aplicado</label>
                        <MoneyInput id={`mixed-cash-${order.id}`} value={cashAmount} onChange={setCashAmount} placeholder="Bs" />
                        <label htmlFor={`mixed-received-${order.id}`}>Efectivo recibido</label>
                        <MoneyInput id={`mixed-received-${order.id}`} value={received} onChange={setReceived} placeholder="Bs" />
                        <label htmlFor={`mixed-qr-${order.id}`}>QR aplicado</label>
                        <MoneyInput id={`mixed-qr-${order.id}`} value={qrAmount} onChange={setQrAmount} placeholder="Bs" />
                        <label htmlFor={`mixed-ref-${order.id}`}>Referencia QR</label>
                        <input id={`mixed-ref-${order.id}`} value={reference} onChange={event => setReference(event.target.value)} />
                        <p>Asignado: {formatMoney(cashAmount + qrAmount)} · Saldo: {formatMoney(Math.max(0, remaining - cashAmount - qrAmount))}</p>
                      </div>
                    ) : method === 'cash' && (
                      <div className="caja-collect__pay-field">
                        <label htmlFor={`received-${order.id}`}>Efectivo recibido</label>
                        <MoneyInput
                          id={`received-${order.id}`}
                          className="caja-collect__received"
                          value={received}
                          placeholder="Bs"
                          onChange={setReceived}
                        />
                        {change > 0 && (
                          <p className="caja-collect__change">
                            Cambio: <strong>{formatMoney(change)}</strong>
                          </p>
                        )}
                      </div>
                    )}

                    {(method === 'qr' || paymentMode === 'mixed') && (
                      <div className="caja-collect__pay-field">
                        {qrEnabled ? (
                          <>
                            <div className="caja-collect__qr-box">
                              <img
                                src={qrImageUrl}
                                alt="QR de pago del restobar"
                                className="caja-collect__qr-image"
                              />
                              <p className="caja-collect__qr-hint">El cliente transfiere por QR el importe asignado.</p>
                              <Button
                                variant="secondary"
                                size="sm"
                                fullWidth
                                onClick={() => document.getElementById(`proof-${order.id}`)?.click()}
                                loading={uploadingProof}
                                disabled={uploadingProof || paying}
                              >
                                <AppIcon name="camera" size="sm" /> {proofPhoto ? 'Cambiar comprobante' : 'Tomar foto del comprobante'}
                              </Button>
                              <input
                                id={`proof-${order.id}`}
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
                                <img src={proofPhoto} alt="Comprobante" className="caja-collect__proof-preview" />
                              )}
                            </div>
                          </>
                        ) : (
                          <p className="caja-collect__qr-disabled">
                            <AppIcon name="alert" size="sm" /> El QR de pago no está configurado
                          </p>
                        )}
                      </div>
                    )}

                    <Button
                      variant="primary"
                      fullWidth
                      loading={paying}
                       disabled={paying || (paymentMode === 'mixed' && (cashAmount + qrAmount <= 0 || cashAmount + qrAmount > remaining)) || ((method === 'qr' || paymentMode === 'mixed') && !qrEnabled)}
                      onClick={() => handlePay(order)}
                    >
                      Cobrar {formatMoney(remaining)}
                    </Button>
                  </div>
                </div>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}

export default CollectView;
