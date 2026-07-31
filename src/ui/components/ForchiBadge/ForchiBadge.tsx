/**
 * ForchiBadge — "Built with FORCH.i by Paulo Velasco"
 *
 * Artículo VIII: Branding FORCH.iA Nivel ≥ 2
 * Required in footer of every PWA
 */

import React from 'react';
import './ForchiBadge.css';

export interface ForchiBadgeProps {
  /** Color variant: light on dark, dark on light */
  variant?: 'default' | 'light';
  className?: string;
}

export function ForchiBadge({ variant = 'default', className = '' }: ForchiBadgeProps) {
  const classes = ['forchi-badge', `forchi-badge--${variant}`, className].filter(Boolean).join(' ');

  return (
    <div className={classes}>
      <span>Built with </span>
      <a
        href="https://forch-i-a-hub.vercel.app/"
        target="_blank"
        rel="noopener noreferrer"
      >
        FORCH.i
      </a>
      <span> by Paulo Velasco</span>
    </div>
  );
}

export default ForchiBadge;
