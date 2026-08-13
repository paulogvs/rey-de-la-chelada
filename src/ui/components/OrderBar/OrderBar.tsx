/**
 * OrderBar — Fixed bottom bar showing draft order count + total + send button
 *
 * Shows when there are items in the draft order.
 * "Enviar a mesero" button transitions draft → called.
 *
 * Zero hardcoded colors — all from CSS variables
 */

import React from 'react';
import { formatMoney } from '@/pwa/_shared/utils/format';
import './OrderBar.css';

export interface OrderBarProps {
  /** Number of unique items in draft */
  itemCount: number;
  /** Total price of draft order */
  total: number;
  /** Send to waiter callback */
  onSend: () => void;
  /** Whether send is in progress */
  sending?: boolean;
}

export function OrderBar({ itemCount, total, onSend, sending = false }: OrderBarProps) {
  if (itemCount === 0) return null;

  const totalLabel = total > 0 ? formatMoney(total) : '—';

  return (
    <div className="order-bar">
      <div className="order-bar__info">
        <span className="order-bar__count">
          {itemCount} {itemCount === 1 ? 'item' : 'items'}
        </span>
        <span className="order-bar__total">{totalLabel}</span>
      </div>
      <button
        className="order-bar__send"
        onClick={onSend}
        disabled={sending || itemCount === 0}
      >
        {sending ? 'Enviando...' : 'Enviar a mesero'}
      </button>
    </div>
  );
}

export default OrderBar;
