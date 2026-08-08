/**
 * ICONBUTTON — Square icon button (≥48px)
 *
 * Variants: default (surface), accent (gold), danger (red), ghost.
 * `label` is required → used as aria-label/title.
 * ZERO hardcoded colors — all from CSS variables.
 */

import React from 'react';
import './IconButton.css';

export interface IconButtonProps {
  /** Accessible label (required) */
  label: string;
  /** Icon content */
  children: React.ReactNode;
  onClick?: () => void;
  /** Visual variant */
  variant?: 'default' | 'accent' | 'danger' | 'ghost';
  /** Size: md (56px) | lg (64px KDS) */
  size?: 'md' | 'lg';
  className?: string;
  disabled?: boolean;
}

export function IconButton({
  label,
  children,
  onClick,
  variant = 'default',
  size = 'md',
  className = '',
  disabled = false,
}: IconButtonProps) {
  const classes = [
    'icon-btn',
    `icon-btn--${variant}`,
    `icon-btn--${size}`,
    className,
  ].filter(Boolean).join(' ');

  return (
    <button
      type="button"
      className={classes}
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
    >
      {children}
    </button>
  );
}

export default IconButton;
