import React from 'react';
import './EmptyState.css';

interface EmptyStateProps {
  /** Icon (ReactNode, e.g. <AppIcon name="bell" />). Los strings emoji legados se ignoran. */
  icon?: React.ReactNode;
  /** Short title, e.g. "No hay pedidos" */
  title?: string;
  /** Supporting message, e.g. "Esperando nuevos pedidos..." */
  message?: string;
  /** Optional actions (buttons) */
  children?: React.ReactNode;
  /** Compact variant for inline panels */
  compact?: boolean;
  className?: string;
}

/**
 * EmptyState — shared empty-list state for every PWA.
 * Replaces duplicated per-PWA empty states (kds-empty, caja-empty, ...).
 */
export function EmptyState({ icon, title, message, children, compact, className }: EmptyStateProps) {
  const cls = ['empty-state', compact && 'empty-state--compact', className]
    .filter(Boolean)
    .join(' ');

  const showIcon = icon != null && typeof icon !== 'string';

  return (
    <div className={cls} role="status" aria-live="polite">
      {showIcon && <div className="empty-state__icon">{icon}</div>}
      {title && <h3 className="empty-state__title">{title}</h3>}
      {message && <p className="empty-state__message">{message}</p>}
      {children && <div className="empty-state__actions">{children}</div>}
    </div>
  );
}

export default EmptyState;
