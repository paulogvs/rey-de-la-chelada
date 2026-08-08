/**
 * TableStatusIcon — Simple circle/square with status color
 *
 * Zero hardcoded colors — all from CSS variables
 * Color-blind friendly: shape + color
 */

import React from 'react';
import type { TableStatus } from '@/core/types';
import './TableStatusIcon.css';

export type IconShape = 'circle' | 'square';

export interface TableStatusIconProps {
  status: TableStatus;
  shape?: IconShape;
  size?: 'sm' | 'md' | 'lg';
  pulsing?: boolean;
  className?: string;
}

const STATUS_CONFIG: Record<TableStatus, { cssVar: string; label: string }> = {
  free:     { cssVar: 'var(--status-confirmed)',  label: 'Libre' },
  occupied: { cssVar: 'var(--status-pending)',    label: 'Ocupada' },
  ordered:  { cssVar: 'var(--status-preparing)',  label: 'Pedido' },
  serving:  { cssVar: 'var(--status-preparing)',  label: 'Servida' },
  payment:  { cssVar: 'var(--status-cancelled)',  label: 'Pagando' },
  closed:   { cssVar: 'var(--status-delivered)',  label: 'Cerrada' },
};

export function TableStatusIcon({
  status,
  shape = 'circle',
  size = 'md',
  pulsing = false,
  className = '',
}: TableStatusIconProps) {
  const config = STATUS_CONFIG[status] || STATUS_CONFIG.free;

  const classes = [
    'table-status-icon',
    `table-status-icon--${shape}`,
    `table-status-icon--${size}`,
    pulsing ? 'table-status-icon--pulse' : '',
    className,
  ].filter(Boolean).join(' ');

  return (
    <span
      className={classes}
      style={{ backgroundColor: config.cssVar, color: config.cssVar }}
      role="img"
      aria-label={config.label}
      title={config.label}
    />
  );
}

export default TableStatusIcon;
