/**
 * PaymentPanel — Payment processing interface
 *
 * - Total with IVA breakdown
 * - Split payment (multiple methods)
 * - QR generation for client to scan
 * - Cash: calculate change
 * - Card: mark as external POS
 * - Transfer: enter reference
 * - Propina selection (0%, 5%, 10%, 15%, custom)
 * - Print button for thermal ticket
 */

import React, { useState, useCallback } from 'react';
import { orderEngine, tableEngine } from '@/core/engine';
import { appConfig } from '@/core/config';
import type { Order, Table, PaymentMethod } from '@/core/types';
import { Button } from '@/ui/components/Button';
import { Card } from '@/ui/components/Card';
import { Badge } from '@/ui/components/Badge';
import { PriceDisplay } from '@/ui/components/PriceDisplay';
import { QRDisplay } from '@/ui/components/QRDisplay';
import { useToast } from '@/ui/components/Toast';
import './App.css';

interface PaymentPanelProps {
  order: Order;
  table: Table;
  onPaymentComplete: () => void;
  onBack: () => void;
}

interface SplitPayment {
  method: PaymentMethod;
  amount: number;
  reference: string;
}

export function PaymentPanel({ order, table, onPaymentComplete, onBack }: PaymentPanelProps) {
  const { addToast } = useToast();
  const config = appConfig.all;

  const [splitPayments, setSplitPayments] = useState<SplitPayment[]>([
    { method: 'cash', amount: order.total, reference: '' },
  ]);
  const [selectedTip, setSelectedTip] = useState(0);
  const [processing, setProcessing] = useState(false);
  const [showQR, setShowQR] = useState(false);

  const tipAmount = Math.round((order.total * (selectedTip / 100)) * 100) / 100;
  const totalWithTip = order.total + tipAmount;

  // Calculate change for cash payments
  const cashAmount = splitPayments
    .filter(s => s.method === 'cash')
    .reduce((sum, s) => sum + s.amount, 0);
  const cashChange = cashAmount > totalWithTip ? cashAmount - totalWithTip : 0;

  // Add split payment
  const addSplit = useCallback(() => {
    const remaining = totalWithTip - splitPayments.reduce((s, p) => s + p.amount, 0);
    if (remaining <= 0) {
      addToast({ type: 'warning', message: 'El total ya está cubierto', duration: 3000 });
      return;
    }
    setSplitPayments(prev => [...prev, { method: 'cash', amount: remaining, reference: '' }]);
  }, [totalWithTip, splitPayments, addToast]);

  // Update split payment
  const updateSplit = useCallback((index: number, updates: Partial<SplitPayment>) => {
    setSplitPayments(prev => prev.map((sp, i) => i === index ? { ...sp, ...updates } : sp));
  }, []);

  // Remove split
  const removeSplit = useCallback((index: number) => {
    setSplitPayments(prev => prev.filter((_, i) => i !== index));
  }, []);

  // Calculate remaining amount
  const coveredAmount = splitPayments.reduce((sum, sp) => sum + sp.amount, 0);
  const remaining = Math.max(0, totalWithTip - coveredAmount);

  // Process payment
  const processPayment = useCallback(async () => {
    if (remaining > 0.01) {
      addToast({ type: 'warning', message: 'El total no está cubierto', duration: 3000 });
      return;
    }

    setProcessing(true);

    try {
      // Process each split payment
      for (const split of splitPayments) {
        if (split.amount <= 0) continue;
        orderEngine.processPayment(order.id, split.method, split.reference || undefined);
      }

      // Clear table
      tableEngine.clearTable(table.id);

      addToast({
        type: 'success',
        message: `Pago completado — Mesa ${table.number}`,
        duration: 3000,
      });

      setTimeout(onPaymentComplete, 500);
    } catch (err) {
      console.error('[PaymentPanel] Error processing payment:', err);
      addToast({ type: 'error', message: 'Error al procesar el pago', duration: 5000 });
    } finally {
      setProcessing(false);
    }
  }, [remaining, splitPayments, order.id, table.id, table.number, addToast, onPaymentComplete]);

  // Payment method labels
  const methodLabels: Record<PaymentMethod, string> = {
    cash: 'Efectivo',
    qr_yape: 'Yape',
    qr_simple: 'QR Simple',
    card: 'Tarjeta',
    transfer: 'Transferencia',
  };

  const methodIcons: Record<PaymentMethod, string> = {
    cash: '💵',
    qr_yape: '📱',
    qr_simple: '📱',
    card: '💳',
    transfer: '🏦',
  };

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
              <span className="payment-panel__item-price">
                Bs. {item.subtotal.toFixed(2)}
              </span>
            </div>
          ))}
        </div>

        <PriceDisplay
          priceWithIVA={order.total}
          showBreakdown
          className="payment-panel__total"
        />
      </Card>

      {/* Tip selection */}
      <Card className="payment-panel__tip">
        <h4>Propina</h4>
        <div className="payment-panel__tip-options">
          {config.tipping.presetPercentages.map(pct => (
            <Button
              key={pct}
              variant={selectedTip === pct ? 'primary' : 'secondary'}
              size="sm"
              onClick={() => setSelectedTip(pct)}
            >
              {pct === 0 ? 'Sin propina' : `${pct}%`}
            </Button>
          ))}
          {config.tipping.allowCustom && (
            <Button
              variant={![0, 5, 10, 15].includes(selectedTip) && selectedTip > 0 ? 'primary' : 'secondary'}
              size="sm"
              onClick={() => {
                const val = prompt('Propina personalizada (Bs.):');
                if (val) {
                  const n = parseFloat(val);
                  if (!isNaN(n)) setSelectedTip(n);
                }
              }}
            >
              Personalizado
            </Button>
          )}
        </div>
        {selectedTip > 0 && (
          <p className="payment-panel__tip-amount">
            Propina: Bs. {tipAmount.toFixed(2)}
            <span className="text-muted"> (no sujeta a IVA)</span>
          </p>
        )}
      </Card>

      {/* Split payments */}
      <Card className="payment-panel__splits">
        <div className="payment-panel__splits-header">
          <h4>Forma de pago</h4>
          <Button variant="ghost" size="sm" onClick={addSplit} disabled={remaining <= 0}>
            + Dividir pago
          </Button>
        </div>

        {splitPayments.map((split, index) => (
          <div key={index} className="payment-panel__split">
            <div className="payment-panel__split-row">
              <select
                className="payment-panel__split-method"
                value={split.method}
                onChange={e => updateSplit(index, { method: e.target.value as PaymentMethod })}
              >
                {(['cash', 'qr_yape', 'qr_simple', 'card', 'transfer'] as PaymentMethod[]).map(m => (
                  <option key={m} value={m}>
                    {methodIcons[m]} {methodLabels[m]}
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

            {/* Reference field for transfers */}
            {split.method === 'transfer' && (
              <input
                type="text"
                className="payment-panel__split-ref"
                placeholder="Nº de referencia"
                value={split.reference}
                onChange={e => updateSplit(index, { reference: e.target.value })}
              />
            )}

            {/* QR for QR payments */}
            {(split.method === 'qr_yape' || split.method === 'qr_simple') && (
              <div className="payment-panel__split-qr">
                <QRDisplay
                  data={`${order.id}|${split.amount}|${split.method}`}
                  label="Escanea para pagar"
                  size={150}
                />
              </div>
            )}
          </div>
        ))}

        {/* Remaining */}
        <div className="payment-panel__remaining">
          <span>Por cubrir:</span>
          <span className={remaining > 0 ? 'payment-panel__remaining-amount' : 'payment-panel__remaining-paid'}>
            {remaining > 0 ? `Bs. ${remaining.toFixed(2)}` : '✓ Cubierto'}
          </span>
        </div>

        {/* Cash change */}
        {cashChange > 0 && (
          <div className="payment-panel__change">
            <span>Cambio:</span>
            <span className="payment-panel__change-amount">Bs. {cashChange.toFixed(2)}</span>
          </div>
        )}
      </Card>

      {/* Invoice info */}
      <Card className="payment-panel__invoice">
        <h4>Facturación</h4>
        <p className="payment-panel__invoice-text">
          {order.total >= config.invoicing.nitThreshold
            ? 'Monto mayor a Bs. 1,000 — requiere NIT para factura'
            : 'Factura sin NIT (consumidor final)'}
        </p>
        {order.total >= config.invoicing.nitThreshold && (
          <div className="payment-panel__invoice-nit">
            <input
              type="text"
              className="payment-panel__invoice-input"
              placeholder="NIT"
            />
            <input
              type="text"
              className="payment-panel__invoice-input"
              placeholder="Razón Social"
            />
          </div>
        )}
      </Card>

      {/* Actions */}
      <div className="payment-panel__actions">
        <Button variant="secondary" onClick={onBack} disabled={processing}>
          Volver
        </Button>
        <Button
          variant="primary"
          onClick={processPayment}
          loading={processing}
          disabled={remaining > 0.01 || processing}
          fullWidth
        >
          {processing ? 'Procesando...' : `Cobrar Bs. ${totalWithTip.toFixed(2)}`}
        </Button>
      </div>
    </div>
  );
}
