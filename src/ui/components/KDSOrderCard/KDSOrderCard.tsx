/**
 * KDSOrderCard — Large format order card for kitchen/bar display
 *
 * - Order number in 48px font
 * - Timer counting up (elapsed minutes)
 * - Status-colored left border (4px)
 * - Item list with checkboxes
 * - Urgent mode (red pulse after 15 minutes)
 * - Touch-friendly tap to mark items
 */

import React, { useEffect, useState, useCallback } from 'react';
import { Badge } from '../Badge/Badge';
import type { Order, KDSStatus } from '@/core/types';
import './KDSOrderCard.css';

export interface KDSOrderCardProps {
  order: Order;
  /** Elapsed minutes (calculated externally or by timer) */
  elapsedMinutes?: number;
  /** Is this order urgent (> 15 min)? */
  isUrgent?: boolean;
  /** Is this a new order (flash animation)? */
  isNew?: boolean;
  /** Callback when an item status changes */
  onItemStatusChange?: (orderId: string, itemId: string, status: KDSStatus) => void;
  /** Callback to acknowledge/reject the order */
  onAcknowledge?: (orderId: string) => void;
  onReject?: (orderId: string) => void;
  /** Force KDS module variant (cocina, bar, or kds for unified) */
  variant?: 'cocina' | 'bar' | 'kds';
}

export function KDSOrderCard({
  order,
  elapsedMinutes: externalMinutes,
  isUrgent = false,
  isNew = false,
  onItemStatusChange,
  onAcknowledge,
  onReject,
  variant = 'cocina',
}: KDSOrderCardProps) {
  const [elapsed, setElapsed] = useState(externalMinutes ?? 0);

  // Internal timer if no external elapsed provided
  useEffect(() => {
    if (externalMinutes !== undefined) {
      setElapsed(externalMinutes);
      return;
    }

    const created = new Date(order.createdAt).getTime();
    const updateTimer = () => {
      setElapsed(Math.floor((Date.now() - created) / 60000));
    };
    updateTimer();
    const interval = setInterval(updateTimer, 30000);
    return () => clearInterval(interval);
  }, [order.createdAt, externalMinutes]);

  const isOrderUrgent = isUrgent || elapsed >= 15;
  const timerColor = elapsed < 10 ? 'var(--kds-completed)' : elapsed < 15 ? 'var(--kds-warning)' : 'var(--kds-urgent)';

  const handleItemClick = useCallback((itemId: string, currentStatus: KDSStatus) => {
    if (!onItemStatusChange) return;
    const nextStatus: Record<KDSStatus, KDSStatus> = {
      pending: 'preparing',
      preparing: 'ready',
      ready: 'delivered',
      delivered: 'delivered',
      cancelled: 'cancelled',
    };
    onItemStatusChange(order.id, itemId, nextStatus[currentStatus] || 'preparing');
  }, [order.id, onItemStatusChange]);

  const allReady = order.items.every(i => i.status === 'delivered' || i.status === 'cancelled');

  const classes = [
    'kds-order',
    `kds-order--${variant}`,
    isOrderUrgent ? 'kds-order--urgent' : '',
    isNew ? 'kds-order--new' : '',
    allReady ? 'kds-order--complete' : '',
  ].filter(Boolean).join(' ');

  const formatTime = (mins: number): string => {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  };

  return (
    <div className={classes} role="article" aria-label={`Orden #${order.tableNumber}`}>
      {/* Header */}
      <div className="kds-order__header">
        <div className="kds-order__number" style={{ color: timerColor }}>
          #{order.tableNumber}
        </div>
        <div className="kds-order__meta">
          <div className="kds-order__timer" style={{ color: timerColor }}>
            {formatTime(elapsed)}
          </div>
          <div className="kds-order__waiter">
            {order.waiterName}
          </div>
          <Badge
            variant={order.status === 'confirmed' ? 'pending' : order.status === 'preparing' ? 'preparing' : 'ready'}
            large
          />
        </div>
      </div>

      {/* Items */}
      <div className="kds-order__items">
        {order.items.map(item => (
          <button
            key={item.id}
            className={`kds-order__item ${item.status === 'ready' ? 'kds-order__item--ready' : ''} ${item.status === 'delivered' ? 'kds-order__item--done' : ''} ${item.status === 'cancelled' ? 'kds-order__item--cancelled' : ''}`}
            onClick={() => handleItemClick(item.id, item.status)}
            disabled={item.status === 'delivered' || item.status === 'cancelled'}
          >
            <span className="kds-order__item-check" aria-hidden="true">
              {item.status === 'ready' || item.status === 'delivered' ? '✓' : item.status === 'cancelled' ? '✕' : item.status === 'preparing' ? '○' : '·'}
            </span>
            <span className="kds-order__item-qty">{item.quantity}x</span>
            <span className="kds-order__item-name">{item.menuItemName}</span>
            {item.modifiers.length > 0 && (
              <span className="kds-order__item-mods">
                {item.modifiers.map(m => m.optionName).join(', ')}
              </span>
            )}
            {item.preparationNotes && (
              <span className="kds-order__item-notes">{item.preparationNotes}</span>
            )}
            <span className={`kds-order__item-status ${item.status === 'ready' ? 'kds-order__item-status--ready' : ''}`}>
              {item.status === 'ready' ? 'LISTO' : item.status === 'delivered' ? 'ENTREGADO' : item.status === 'preparing' ? '...' : ''}
            </span>
          </button>
        ))}
      </div>

      {/* Actions */}
      <div className="kds-order__actions">
        {order.status === 'confirmed' && onAcknowledge && (
          <button
            className="kds-order__action kds-order__action--accept"
            onClick={() => onAcknowledge(order.id)}
          >
            Aceptar Pedido
          </button>
        )}
        {order.status === 'confirmed' && onReject && (
          <button
            className="kds-order__action kds-order__action--reject"
            onClick={() => onReject(order.id)}
          >
            Rechazar
          </button>
        )}
        {order.status !== 'confirmed' && allReady && (
          <div className="kds-order__complete-badge">✓ COMPLETADO</div>
        )}
      </div>
    </div>
  );
}

/** Skeleton for KDS loading state */
export function KDSOrderCardSkeleton() {
  return (
    <div className="kds-order kds-order--skeleton" aria-hidden="true">
      <div className="kds-order__header">
        <div className="skeleton-line skeleton-line--w40" />
        <div className="skeleton-line skeleton-line--w60" />
      </div>
      <div className="kds-order__items">
        <div className="skeleton-line skeleton-line--w80" />
        <div className="skeleton-line skeleton-line--w60" />
        <div className="skeleton-line skeleton-line--w90" />
      </div>
    </div>
  );
}

export default KDSOrderCard;
