/**
 * OrderSummary — Modal showing draft order items + quantities + totals
 *
 * Shows all items in the draft with quantity steppers,
 * individual prices, and total. "Confirmar" button to submit.
 *
 * Zero hardcoded colors — all from CSS variables
 */

import React from 'react';
import { AppIcon } from '@/ui/components/AppIcon/AppIcon';
import { formatMoney } from '@/pwa/_shared/utils/format';
import './OrderSummary.css';

export interface OrderSummaryItem {
  id: string;
  name: string;
  quantity: number;
  unitPrice: number;
  subtotal: number;
  notes?: string;
}

export interface OrderSummaryProps {
  /** Items in the draft order */
  items: OrderSummaryItem[];
  /** Total with IVA */
  total: number;
  /** IVA amount */
  ivaAmount: number;
  /** Confirm callback */
  onConfirm: () => void;
  /** Cancel/close callback */
  onClose: () => void;
  /** Whether confirm is in progress */
  confirming?: boolean;
}

export function OrderSummary({
  items,
  total,
  ivaAmount,
  onConfirm,
  onClose,
  confirming = false,
}: OrderSummaryProps) {
  if (items.length === 0) return null;

  return (
    <div className="order-summary-overlay" onClick={onClose}>
      <div className="order-summary" onClick={e => e.stopPropagation()}>
        <header className="order-summary__header">
          <h2 className="order-summary__title">Tu Pedido</h2>
          <button className="order-summary__close" onClick={onClose} aria-label="Cerrar"><AppIcon name="x" size="sm" /></button>
        </header>

        <div className="order-summary__items">
          {items.map(item => (
            <div key={item.id} className="order-summary__item">
              <div className="order-summary__item-info">
                <span className="order-summary__item-qty">{item.quantity}x</span>
                <span className="order-summary__item-name">{item.name}</span>
              </div>
              <span className="order-summary__item-price">
                {formatMoney(item.subtotal)}
              </span>
            </div>
          ))}
        </div>

        <footer className="order-summary__footer">
          <div className="order-summary__totals">
            <div className="order-summary__row">
              <span>Subtotal</span>
              <span>{formatMoney(total - ivaAmount)}</span>
            </div>
            <div className="order-summary__row">
              <span>IVA (13%)</span>
              <span>{formatMoney(ivaAmount)}</span>
            </div>
            <div className="order-summary__divider" />
            <div className="order-summary__row order-summary__row--total">
              <span>Total</span>
              <span className="order-summary__total-amount">{formatMoney(total)}</span>
            </div>
          </div>

          <button
            className="order-summary__confirm"
            onClick={onConfirm}
            disabled={confirming || items.length === 0}
          >
            {confirming ? 'Enviando...' : 'Confirmar Pedido'}
          </button>
        </footer>
      </div>
    </div>
  );
}

export default OrderSummary;
