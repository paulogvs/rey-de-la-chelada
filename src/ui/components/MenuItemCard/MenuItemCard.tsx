/**
 * MenuItemCard — Product display with name, description, price, modifiers
 *
 * Zero hardcoded colors — all from CSS variables
 * Touch-friendly tap target for selection
 * Includes loading/empty/error states
 */

import React from 'react';
import type { MenuItem } from '@/core/types';
import { Badge } from '../Badge/Badge';
import { PriceDisplay } from '../PriceDisplay/PriceDisplay';
import './MenuItemCard.css';

export interface MenuItemCardProps {
  item: MenuItem;
  onSelect?: (item: MenuItem) => void;
  /** Show modifier hints */
  showModifiers?: boolean;
  /** Selected state (for order building) */
  selected?: boolean;
  className?: string;
}

export function MenuItemCard({
  item,
  onSelect,
  showModifiers = true,
  selected = false,
  className = '',
}: MenuItemCardProps) {
  const classes = [
    'menu-item-card',
    selected ? 'menu-item-card--selected' : '',
    !item.isAvailable ? 'menu-item-card--unavailable' : '',
    className,
  ].filter(Boolean).join(' ');

  return (
    <button
      className={classes}
      onClick={() => item.isAvailable && onSelect?.(item)}
      disabled={!item.isAvailable}
      aria-label={`${item.name} — Bs. ${item.price.toFixed(2)}`}
    >
      {/* Image placeholder */}
      <div className="menu-item-card__image">
        {item.imageUrl ? (
          <img src={item.imageUrl} alt={item.name} loading="lazy" />
        ) : (
          <span className="menu-item-card__image-placeholder" aria-hidden="true">
            {item.name.charAt(0)}
          </span>
        )}
      </div>

      {/* Info */}
      <div className="menu-item-card__info">
        <div className="menu-item-card__header">
          <h3 className="menu-item-card__name">{item.name}</h3>
          <span className="menu-item-card__price">
            Bs. {item.price.toFixed(2)}
          </span>
        </div>

        <p className="menu-item-card__desc">{item.description}</p>

        {/* Tags */}
        {item.tags.length > 0 && (
          <div className="menu-item-card__tags">
            {item.tags.map(tag => (
              <Badge key={tag} variant="info">{tag}</Badge>
            ))}
          </div>
        )}

        {/* Modifier hint */}
        {showModifiers && item.modifierGroups.length > 0 && (
          <span className="menu-item-card__modifiers-hint">
            {item.modifierGroups.map(g => g.name).join(' · ')}
          </span>
        )}

        {/* Unavailable badge */}
        {!item.isAvailable && (
          <span className="menu-item-card__unavailable-badge">
            No disponible
          </span>
        )}
      </div>
    </button>
  );
}

/** Skeleton loading for menu items */
export function MenuItemCardSkeleton() {
  return (
    <div className="menu-item-card menu-item-card--skeleton" aria-hidden="true">
      <div className="menu-item-card__image">
        <div className="skeleton-line skeleton-line--w100" style={{ height: '100%' }} />
      </div>
      <div className="menu-item-card__info">
        <div className="skeleton-line skeleton-line--w80" />
        <div className="skeleton-line skeleton-line--w60" />
        <div className="skeleton-line skeleton-line--w40" />
      </div>
    </div>
  );
}

/** Empty state for no items */
export function MenuItemCardEmpty({ onRetry }: { onRetry?: () => void }) {
  return (
    <div className="menu-item-card menu-item-card--empty">
      <div className="menu-item-card__empty-content">
        <span className="menu-item-card__empty-icon">🍽</span>
        <p>Menú no disponible</p>
        {onRetry && (
          <button className="menu-item-card__retry-btn" onClick={onRetry}>
            Reintentar
          </button>
        )}
      </div>
    </div>
  );
}

export default MenuItemCard;
