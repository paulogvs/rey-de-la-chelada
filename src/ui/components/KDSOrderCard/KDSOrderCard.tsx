/**
 * KDSOrderCard — Large format order card for kitchen/bar display
 *
 * FASE 4C — FLUJO 2 CLICKS por tarjeta (pedido completo de un módulo+ronda):
 *   - La tarjeta es el PEDIDO COMPLETO de UN módulo+ronda (cocina o bar).
 *   - Click 1 "▶ Iniciar"  → toda la tarjeta pasa a 'preparando' (onStart).
 *   - Click 2 "✓ Listo"    → toda la tarjeta pasa a 'listo' → llama al mesero
 *     (onReady). Ahí termina el ciclo de cocina/bar.
 *   - Los items se VEN en la lista (para saber qué cocinar) pero NO se
 *     tocan individualmente (sin margen de error).
 *   - NO hay botón Rechazar: las cancelaciones las maneja el mesero (quitar
 *     item desde su PWA).
 *
 * - Order number in 48px font + Ronda N
 * - Timer counting up (elapsed minutes)
 * - Status-colored left border (4px)
 * - Urgent mode (red pulse after 15 minutes)
 */

import React, { useEffect, useState } from 'react';
import { Badge } from '../Badge/Badge';
import { AppIcon } from '../AppIcon/AppIcon';
import type { Order, KDSStatus } from '@/core/types';
import './KDSOrderCard.css';

export interface KDSOrderCardProps {
  /** Pedido con items YA filtrados a (módulo, ronda) */
  order: Order;
  /** Número de ronda que representa esta tarjeta (FASE 4B) */
  round: number;
  /** Elapsed minutes (calculated externally or by timer) */
  elapsedMinutes?: number;
  /** Is this order urgent (> 15 min)? */
  isUrgent?: boolean;
  /** Is this a new order (flash animation)? */
  isNew?: boolean;
  /** Click 1 — Iniciar: toda la tarjeta (módulo+ronda) → 'preparing' */
  onStart?: (orderId: string, round: number) => void;
  /** Click 2 — Listo: toda la tarjeta → 'ready' → llama al mesero */
  onReady?: (orderId: string, round: number) => void;
  /** Force KDS module variant (cocina, bar, or kds for unified) */
  variant?: 'cocina' | 'bar' | 'kds';
}

export function KDSOrderCard({
  order,
  round,
  elapsedMinutes: externalMinutes,
  isUrgent = false,
  isNew = false,
  onStart,
  onReady,
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

  // Estado de la tarjeta (derivado de sus items — la tarjeta es la unidad)
  const hasPending = order.items.some(i => i.status === 'pending');
  const hasPreparing = order.items.some(i => i.status === 'preparing');
  const allDone = order.items.length > 0 && order.items.every(i =>
    i.status === 'ready' || i.status === 'delivered' || i.status === 'cancelled'
  );

  const cardState: KDSStatus = hasPending ? 'pending' : hasPreparing ? 'preparing' : 'ready';
  const cardBadgeVariant = cardState === 'preparing' ? 'preparing' : cardState === 'ready' ? 'ready' : 'pending';

  const classes = [
    'kds-order',
    `kds-order--${variant}`,
    isOrderUrgent ? 'kds-order--urgent' : '',
    isNew ? 'kds-order--new' : '',
    allDone ? 'kds-order--complete' : '',
  ].filter(Boolean).join(' ');

  const formatTime = (mins: number): string => {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  };

  return (
    <div className={classes} role="article" aria-label={`Mesa ${order.tableNumber} · Ronda ${round}`}>
      {/* Header */}
      <div className="kds-order__header">
        <div className="kds-order__number" style={{ color: timerColor }}>
          #{order.tableNumber}
        </div>
        <div className="kds-order__meta">
          <div className="kds-order__round">
            {round === 1 ? 'Ronda 1' : (
              <>Ronda {round} <Badge variant="preparing">NUEVA</Badge></>
            )}
          </div>
          <div className="kds-order__timer" style={{ color: timerColor }}>
            {formatTime(elapsed)}
          </div>
          <div className="kds-order__waiter">
            {order.waiterName}
          </div>
          <Badge variant={cardBadgeVariant} large>
            {cardState === 'preparing' ? 'En prep.' : cardState === 'ready' ? 'Listo' : 'Nuevo'}
          </Badge>
        </div>
      </div>

      {/* Items — solo lectura (NO tocables, FASE 4C) */}
      <div className="kds-order__items">
        {order.items.map(item => (
          <div
            key={item.id}
            className={`kds-order__item ${item.status === 'ready' ? 'kds-order__item--ready' : ''} ${item.status === 'delivered' ? 'kds-order__item--done' : ''} ${item.status === 'cancelled' ? 'kds-order__item--cancelled' : ''}`}
          >
            <span className="kds-order__item-check" aria-hidden="true">
              {item.status === 'ready' || item.status === 'delivered'
                ? <AppIcon name="check" size="sm" />
                : item.status === 'cancelled'
                  ? <AppIcon name="x" size="sm" />
                  : item.status === 'preparing' ? '○' : '·'}
            </span>
            <span className="kds-order__item-qty">{item.quantity}x</span>
            <span className="kds-order__item-name">{item.menuItemName}</span>
            {item.promoLabel && (
              <span className="kds-order__item-promo">{item.promoLabel}</span>
            )}
            {item.modifiers.length > 0 && (
              <span className="kds-order__item-mods">
                {item.modifiers.map(m => m.optionName).join(', ')}
              </span>
            )}
            {item.preparationNotes && (
              <span className="kds-order__item-notes">{item.preparationNotes}</span>
            )}
          </div>
        ))}
      </div>

      {/* Acciones — FASE 4C: 2 clicks por tarjeta */}
      <div className="kds-order__actions">
        {hasPending && onStart && (
          <button
            className="kds-order__action kds-order__action--start"
            onClick={() => onStart(order.id, round)}
          >
            <AppIcon name="play" size="sm" /> Iniciar
          </button>
        )}
        {!hasPending && hasPreparing && onReady && (
          <button
            className="kds-order__action kds-order__action--ready"
            onClick={() => onReady(order.id, round)}
          >
            <AppIcon name="check" size="sm" /> Listo
          </button>
        )}
        {allDone && (
          <div className="kds-order__complete-badge"><AppIcon name="check" size="sm" /> COMPLETADO</div>
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
