/**
 * PaymentPanel — Payment processing (API-driven)
 *
 * - Fetch the order from GET /api/orders/:id (fresh totals)
 * - Split payments (multiple methods)
 * - Cash: received (lo que entrega el cliente) → change (vuelto) — F3-2
 * - QR: QRDisplay for client scan
 * - FASE 3: propina ELIMINADA (se da directo al mesero, fuera de la app)
 * - POST /api/payments per split → when fully paid, server marks
 *   order paid + we clear the table via PUT /api/tables/:id
 */

import React, { useState, useEffect, useCallback } from 'react';
import type { Table, PaymentMethod } from '@/core/types';
import { Button } from '@/ui/components/Button';
import { Card } from '@/ui/components/Card';
import { Badge } from '@/ui/components/Badge';
import { PriceDisplay } from '@/ui/components/PriceDisplay';
import { QRDisplay } from '@/ui/components/QRDisplay';
import { Loader } from '@/ui/components/Loader';
import { useToast } from '@/ui/components/Toast';
import { apiFetch } from '../_shared/api/apiFetch';
import { processPayment } from '../_shared/api/paymentsApi';
import type { Order } from '../_shared/api/ordersApi';
import { PrintReceipt } from '../_shared/components/PrintReceipt';
import { buildReceiptData } from '../_shared/utils/receipt';
import { METHOD_LABELS, METHOD_ICONS, PAYMENT_METHODS } from '../_shared/utils/paymentMethods';

interface PaymentPanelProps {
  orderId: string;
  table: Table;
  token: string;
  onPaymentComplete: () => void;
  onBack: () => void;
}

interface SplitPayment {
  method: PaymentMethod;
  amount: number;
  received: number;   // efectivo: lo que el cliente entrega (0 = sin especificar)
  reference: string;
}

export function PaymentPanel({ orderId, table, token, onPaymentComplete, onBack }: PaymentPanelProps) {
  const { addToast } = useToast();

  const [order, setOrder] = useState<Order | null>(null);
  const [loadingOrder, setLoadingOrder] = useState(true);
  const [splitPayments, setSplitPayments] = useState<SplitPayment[]>([]);
  const [processing, setProcessing] = useState(false);
  const [printOpen, setPrintOpen] = useState(false);

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
          const o = result.data.order as unknown as Order;
          setOrder(o);
          setSplitPayments([{ method: 'cash', amount: o.total, received: 0, reference: '' }]);
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

  const totalToCollect = order?.total ?? 0;

  const addSplit = useCallback(() => {
    const remaining = totalToCollect - splitPayments.reduce((s, p) => s + p.amount, 0);
    if (remaining <= 0) {
      addToast({ type: 'warning', message: 'El total ya está cubierto', duration: 3000 });
      return;
    }
    setSplitPayments(prev => [...prev, { method: 'cash', amount: remaining, received: 0, reference: '' }]);
  }, [totalToCollect, splitPayments, addToast]);

  const updateSplit = useCallback((index: number, updates: Partial<SplitPayment>) => {
    setSplitPayments(prev => prev.map((sp, i) => (i === index ? { ...sp, ...updates } : sp)));
  }, []);

  const removeSplit = useCallback((index: number) => {
    setSplitPayments(prev => prev.filter((_, i) => i !== index));
  }, []);

  const coveredAmount = splitPayments.reduce((sum, sp) => sum + sp.amount, 0);
  const remaining = Math.max(0, totalToCollect - coveredAmount);

  // Process payment via API (one POST per split) then clear the table
  const processPaymentNow = useCallback(async () => {
    if (!order) return;
    if (remaining > 0.01) {
      addToast({ type: 'warning', message: 'El total no está cubierto', duration: 3000 });
      return;
    }

    setProcessing(true);
    try {
      for (let i = 0; i < splitPayments.length; i++) {
        const split = splitPayments[i];
        if (split.amount <= 0) continue;
        const result = await processPayment(token, {
          order_id: order.id,
          amount: split.amount,
          method: split.method,
          reference: split.reference || undefined,
          received: split.method === 'cash' && split.received > 0 ? split.received : undefined,
        });
        if (!result.ok) {
          addToast({ type: 'error', message: result.error || 'Error al registrar el pago', duration: 5000 });
          return;
        }
      }

      // A3/2.4: la mesa la libera el SERVIDOR (processPayment) SOLO si no
      // hay otros pedidos activos. ANTES el cliente forzaba free aquí con
      // updateTableStatus(..., 'free') — rompía el escenario de 2 pedidos
      // en la misma mesa. El hook useTables (polling 15s) refresca el estado.
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
  }, [order, remaining, splitPayments, token, table.id, table.number, addToast, onPaymentComplete]);

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
              <span className="payment-panel__item-price">Bs. {item.subtotal.toFixed(2)}</span>
            </div>
          ))}
        </div>

        <PriceDisplay
          priceWithIVA={order.total}
          showBreakdown
          className="payment-panel__total"
        />
      </Card>

      {/* Split payments */}
      <Card className="payment-panel__splits">
        <div className="payment-panel__splits-header">
          <h4>Forma de pago</h4>
          <Button variant="ghost" size="md" onClick={addSplit} disabled={remaining <= 0}>
            + Dividir pago
          </Button>
        </div>

        {splitPayments.map((split, index) => {
          const change = split.method === 'cash' && split.received > split.amount
            ? Math.round((split.received - split.amount) * 100) / 100
            : 0;
          return (
            <div key={index} className="payment-panel__split">
              <div className="payment-panel__split-row">
                <select
                  className="payment-panel__split-method"
                  value={split.method}
                  onChange={e => updateSplit(index, { method: e.target.value as PaymentMethod, received: 0 })}
                >
                  {PAYMENT_METHODS.map(m => (
                    <option key={m} value={m}>
                      {METHOD_ICONS[m]} {METHOD_LABELS[m]}
                    </option>
                  ))}
                </select>

                <input
                  type="number"
                  className="payment-panel__split-amount"
                  value={split.amount}
                  min={0}
                  step={0.01}
                  onChange={e => updateSplit(index, { amount: parseFloat(e.target.value) || 0 })}
                />

                {splitPayments.length > 1 && (
                  <button
                    className="payment-panel__split-remove"
                    onClick={() => removeSplit(index)}
                    aria-label="Eliminar"
                  >
                    ✕
                  </button>
                )}
              </div>

              {split.method === 'cash' && (
                <input
                  type="number"
                  className="payment-panel__split-received"
                  placeholder="Efectivo recibido (Bs.)"
                  value={split.received || ''}
                  min={split.amount}
                  step={0.01}
                  onChange={e => updateSplit(index, { received: parseFloat(e.target.value) || 0 })}
                />
              )}

              {change > 0 && (
                <p className="payment-panel__change">
                  Cambio: <strong>Bs. {change.toFixed(2)}</strong>
                </p>
              )}

              {split.method === 'qr' && (
                <div className="payment-panel__split-qr">
                  <QRDisplay
                    data={`${order.id}|${split.amount}|${split.method}`}
                    label="Escanea para pagar"
                    size={150}
                  />
                </div>
              )}
            </div>
          );
        })}

        <div className="payment-panel__remaining">
          <span>Por cubrir:</span>
          <span className={remaining > 0 ? 'payment-panel__remaining-amount' : 'payment-panel__remaining-paid'}>
            {remaining > 0 ? `Bs. ${remaining.toFixed(2)}` : '✓ Cubierto'}
          </span>
        </div>
      </Card>

      {/* Invoice info */}
      <Card className="payment-panel__invoice">
        <h4>Facturación</h4>
        <p className="payment-panel__invoice-text">
          {order.total >= 1000
            ? 'Monto mayor a Bs. 1,000 — requiere NIT para factura'
            : 'Factura sin NIT (consumidor final)'}
        </p>
      </Card>

      {/* Actions */}
      <div className="payment-panel__actions">
        <Button variant="secondary" onClick={onBack} disabled={processing}>
          Volver
        </Button>
        <Button variant="secondary" onClick={() => setPrintOpen(true)} disabled={processing}>
          🖨️ Imprimir
        </Button>
        <Button
          variant="primary"
          onClick={processPaymentNow}
          loading={processing}
          disabled={remaining > 0.01 || processing}
          fullWidth
        >
          {processing ? 'Procesando...' : `Cobrar Bs. ${totalToCollect.toFixed(2)}`}
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
