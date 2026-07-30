/**
 * CARD — Shared card component with optional status border
 *
 * Zero hardcoded colors — all from CSS variables
 * Touch-friendly: tap area, hover states
 */

import React, { type ReactNode, type HTMLAttributes } from 'react';
import './Card.css';

export type CardStatus = 'pending' | 'preparing' | 'ready' | 'cancelled' | 'paid' | 'none';

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  status?: CardStatus;
  padded?: boolean;
  elevated?: boolean;
  clickable?: boolean;
  header?: ReactNode;
  footer?: ReactNode;
  children?: ReactNode;
}

export function Card({
  status = 'none',
  padded = true,
  elevated = false,
  clickable = false,
  header,
  footer,
  children,
  className = '',
  onClick,
  ...rest
}: CardProps) {
  const classes = [
    'card',
    `card--status-${status}`,
    padded ? 'card--padded' : '',
    elevated ? 'card--elevated' : '',
    clickable || onClick ? 'card--clickable' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      className={classes}
      role={clickable || onClick ? 'button' : undefined}
      tabIndex={clickable || onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') onClick(e as unknown as React.MouseEvent<HTMLDivElement>); } : undefined}
      {...rest}
    >
      {header && <div className="card__header">{header}</div>}
      {children && <div className="card__body">{children}</div>}
      {footer && <div className="card__footer">{footer}</div>}
    </div>
  );
}

/** Skeleton loading placeholder for Card */
export function CardSkeleton() {
  return (
    <div className="card card--padded card--skeleton" aria-hidden="true">
      <div className="skeleton-line skeleton-line--w60" />
      <div className="skeleton-line skeleton-line--w80" />
      <div className="skeleton-line skeleton-line--w40" />
    </div>
  );
}

export default Card;
