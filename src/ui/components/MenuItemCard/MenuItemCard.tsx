/**
 * MenuItemCard — Product display with name, description, price, modifiers
 *
 * Variants:
 *   'text' (default) — side-by-side layout: image + info
 *   'photo'          — full-width image + price overlay + "+" button
 *
 * Zero hardcoded colors — all from CSS variables
 * Touch-friendly tap target for selection
 * Includes loading/empty/error states
 *
 * Photo fallback: if the image fails to load (404, network), we hide
 * the <img> and show a colored placeholder with the item's first
 * letter. This works for both `text` and `photo` variants.
 */

import React, { useState } from 'react';
import type { MenuItem } from '@/core/types';
import { Badge } from '../Badge/Badge';
import { AppIcon } from '../AppIcon/AppIcon';
import './MenuItemCard.css';

export interface MenuItemCardProps {
  item: MenuItem;
  onSelect?: (item: MenuItem) => void;
  /** Show modifier hints */
  showModifiers?: boolean;
  /** Selected state (for order building) */
  selected?: boolean;
  /** Visual variant: text (default) or photo (full-width image) */
  variant?: 'text' | 'photo';
  className?: string;
}

export function MenuItemCard({
  item,
  onSelect,
  showModifiers = true,
  selected = false,
  variant = 'text',
  className = '',
}: MenuItemCardProps) {
  // Image load state — if it errors (404 / network), fall back to placeholder.
  // `loaded` starts false so we don't briefly show a broken image icon.
  const [imgError, setImgError] = useState(false);
  const showImage = item.imageUrl && !imgError;

  const classes = [
    'menu-item-card',
    `menu-item-card--${variant}`,
    selected ? 'menu-item-card--selected' : '',
    !item.isAvailable ? 'menu-item-card--unavailable' : '',
    className,
  ].filter(Boolean).join(' ');

  const priceLabel = item.price != null ? `Bs. ${item.price.toFixed(2)}` : '—';
  const handleImgError = () => setImgError(true);

  if (variant === 'photo') {
    return (
      <button
        className={classes}
        onClick={() => item.isAvailable && onSelect?.(item)}
        disabled={!item.isAvailable}
        aria-label={`${item.name} — ${priceLabel}`}
      >
        <div className="menu-item-card__photo-image">
          {showImage ? (
            <img
              src={item.imageUrl ?? ''}
              alt={item.name}
              loading="lazy"
              onError={handleImgError}
            />
          ) : (
            <span className="menu-item-card__image-placeholder" aria-hidden="true">
              {item.name.charAt(0)}
            </span>
          )}
          <div className="menu-item-card__photo-overlay">
            <span className="menu-item-card__photo-price">{priceLabel}</span>
            <span className="menu-item-card__photo-add">+</span>
          </div>
        </div>
        <div className="menu-item-card__photo-info">
          <h3 className="menu-item-card__name">{item.name}</h3>
          {item.description && (
            <p className="menu-item-card__desc">{item.description}</p>
          )}
        </div>
        {!item.isAvailable && (
          <span className="menu-item-card__unavailable-badge">No disponible</span>
        )}
      </button>
    );
  }

  return (
    <button
      className={classes}
      onClick={() => item.isAvailable && onSelect?.(item)}
      disabled={!item.isAvailable}
      aria-label={`${item.name} — ${priceLabel}`}
    >
      {/* Image (or placeholder on error) */}
      <div className="menu-item-card__image">
        {showImage ? (
          <img
            src={item.imageUrl ?? ''}
            alt={item.name}
            loading="lazy"
            onError={handleImgError}
          />
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
          <span className="menu-item-card__price">{priceLabel}</span>
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
        <span className="menu-item-card__empty-icon"><AppIcon name="utensils" size="lg" /></span>
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
