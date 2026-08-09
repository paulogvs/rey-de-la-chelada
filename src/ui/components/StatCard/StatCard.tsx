/**
 * STATCARD — Metric card for admin/caja dashboards
 *
 * Label + big value + optional delta trend + optional icon.
 * Built on the shared Card component.
 * ZERO hardcoded colors — all from CSS variables.
 */

import React from 'react';
import { Card } from '../Card/Card';
import './StatCard.css';

export interface StatCardProps {
  /** Metric label */
  label: string;
  /** Big metric value (number or node) */
  value: React.ReactNode;
  /** Optional delta / trend text */
  delta?: string;
  /** Trend tone */
  deltaTone?: 'up' | 'down' | 'neutral';
  /** Optional leading icon */
  icon?: React.ReactNode;
  className?: string;
}

export function StatCard({
  label,
  value,
  delta,
  deltaTone = 'neutral',
  icon,
  className = '',
}: StatCardProps) {
  const classes = ['stat-card', className].filter(Boolean).join(' ');

  return (
    <Card className={classes} padded>
      <div className="stat-card__header">
        <span className="stat-card__label">{label}</span>
        {icon && <span className="stat-card__icon" aria-hidden="true">{icon}</span>}
      </div>
      <div className="stat-card__value">{value}</div>
      {delta && (
        <div className={`stat-card__delta stat-card__delta--${deltaTone}`}>{delta}</div>
      )}
    </Card>
  );
}

export default StatCard;
