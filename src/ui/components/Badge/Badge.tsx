/**
 * BADGE — Status pill component
 *
 * Variants: pending (amber), preparing (gold), ready (green), cancelled (red), paid (emerald)
 * Zero hardcoded colors — all from CSS variables
 */

import React, { type ReactNode } from 'react';
import './Badge.css';

export type BadgeVariant = 'pending' | 'preparing' | 'ready' | 'cancelled' | 'paid' | 'info' | 'warning' | 'success';

export interface BadgeProps {
  variant?: BadgeVariant;
  children?: ReactNode;
  className?: string;
  /** Show a small pulsing dot indicator */
  dot?: boolean;
  /** Make the badge larger for KDS display */
  large?: boolean;
}

const VARIANT_LABELS: Record<BadgeVariant, string> = {
  pending: 'Pendiente',
  preparing: 'Preparando',
  ready: 'Listo',
  cancelled: 'Cancelado',
  paid: 'Pagado',
  info: 'Info',
  warning: 'Advertencia',
  success: 'Éxito',
};

export function Badge({
  variant = 'info',
  children,
  className = '',
  dot = false,
  large = false,
}: BadgeProps) {
  const classes = [
    'badge',
    `badge--${variant}`,
    large ? 'badge--large' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <span className={classes} role="status">
      {dot && <span className="badge__dot" aria-hidden="true" />}
      {children || VARIANT_LABELS[variant]}
    </span>
  );
}

/** Skeleton placeholder for Badge */
export function BadgeSkeleton() {
  return (
    <span className="badge badge--skeleton" aria-hidden="true">
      <span className="skeleton-line skeleton-line--w60" />
    </span>
  );
}

export default Badge;
