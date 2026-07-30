/**
 * PWA CLIENTES — Página de Menú Digital
 *
 * "El pedido activo es el permiso"
 * - Menú siempre visible (offline-first)
 * - Llamar mesero con debounce anti-spam
 * - Pedir cuenta con confirmación
 * - Loading/empty/error states con componentes compartidos
 * - Tap item → detail view (modifiers, description, photo)
 */

import React, { useEffect, useState, useCallback } from 'react';
import { menuEngine } from '@/core/engine';
import type { MenuCategory, MenuItem } from '@/core/types';
import { useTableSession } from '../hooks/useTableSession';
import { MenuItemCard, MenuItemCardSkeleton, MenuItemCardEmpty } from '@/ui/components/MenuItemCard';
import { Badge } from '@/ui/components/Badge';
import { ToastInline } from '@/ui/components/Toast';
import { ForchiBadge } from '@/ui/components/ForchiBadge';
import './MenuPage.css';

/** Category filter bar item */
function CategoryButton({
  label,
  emoji,
  active,
  onClick,
}: {
  label: string;
  emoji?: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className={`clientes-categories__btn ${active ? 'active' : ''}`}
      onClick={onClick}
    >
      {emoji && <span className="clientes-categories__emoji">{emoji}</span>}
      {label}
    </button>
  );
}

/** Item detail modal */
function ItemDetailModal({
  item,
  onClose,
}: {
  item: MenuItem;
  onClose: () => void;
}) {
  return (
    <div className="clientes-detail-overlay" onClick={onClose}>
      <div className="clientes-detail" onClick={e => e.stopPropagation()}>
        <button className="clientes-detail__close" onClick={onClose}>✕</button>

        {item.imageUrl && (
          <img src={item.imageUrl} alt={item.name} className="clientes-detail__image" />
        )}

        <h2 className="clientes-detail__name">{item.name}</h2>
        <p className="clientes-detail__desc">{item.description}</p>

        <div className="clientes-detail__price">
          Bs. {item.price.toFixed(2)}
        </div>

        {item.tags.length > 0 && (
          <div className="clientes-detail__tags">
            {item.tags.map(tag => (
              <Badge key={tag} variant="info">{tag}</Badge>
            ))}
          </div>
        )}

        {item.modifierGroups.length > 0 && (
          <div className="clientes-detail__modifiers">
            <h4>Variantes disponibles:</h4>
            {item.modifierGroups.map(g => (
              <div key={g.id} className="clientes-detail__mod-group">
                <strong>{g.name}</strong>
                <div className="clientes-detail__mod-options">
                  {g.options.map(o => (
                    <span key={o.id} className="clientes-detail__mod-option">
                      {o.name}
                      {o.priceAdjustment !== 0 && (
                        <span className="clientes-detail__mod-price">
                          {o.priceAdjustment > 0 ? '+' : ''}Bs. {o.priceAdjustment.toFixed(2)}
                        </span>
                      )}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function MenuPage() {
  const session = useTableSession();
  const [categories, setCategories] = useState<MenuCategory[]>([]);
  const [items, setItems] = useState<MenuItem[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detailItem, setDetailItem] = useState<MenuItem | null>(null);
  const [callFeedback, setCallFeedback] = useState<string | null>(null);
  const [billFeedback, setBillFeedback] = useState<string | null>(null);

  // Cargar menú
  const loadMenu = useCallback(() => {
    setLoading(true);
    setError(null);
    try {
      const cats = menuEngine.getCategories();
      const its = menuEngine.getItems();
      setCategories(cats);
      setItems(its);
      if (cats.length === 0 && its.length === 0) {
        setError('Menú no disponible');
      }
    } catch (err) {
      console.error('[MenuPage] Error loading menu:', err);
      setError('Error al cargar el menú');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadMenu();
    return menuEngine.onChange(loadMenu);
  }, [loadMenu]);

  // Categorías y items filtrados
  const cats = selectedCategory
    ? categories.filter(c => c.id === selectedCategory)
    : categories;

  const filteredItems = selectedCategory
    ? items.filter(i => i.categoryId === selectedCategory && i.isActive && i.isAvailable)
    : items.filter(i => i.isActive && i.isAvailable);

  // Call waiter con feedback
  const handleCallWaiter = useCallback(async () => {
    if (!session.canCallWaiter) return;
    try {
      await session.callWaiter();
      setCallFeedback('✅ Mesero notificado');
      setTimeout(() => setCallFeedback(null), 3000);
    } catch {
      setCallFeedback('❌ Error al notificar');
      setTimeout(() => setCallFeedback(null), 3000);
    }
  }, [session]);

  // Request bill con feedback
  const handleRequestBill = useCallback(async () => {
    if (!session.canRequestBill) return;
    try {
      await session.requestBill();
      setBillFeedback('✅ Cuenta solicitada');
      setTimeout(() => setBillFeedback(null), 3000);
    } catch {
      setBillFeedback('❌ Error al solicitar cuenta');
      setTimeout(() => setBillFeedback(null), 3000);
    }
  }, [session]);

  return (
    <div className="clientes-page">
      {/* Header */}
      <header className="clientes-header">
        <div className="clientes-header__brand">
          <h1>Rey de la Chelada</h1>
          {session.tableNumber > 0 && (
            <Badge variant="info">Mesa {session.tableNumber}</Badge>
          )}
        </div>
        {!session.isValid && session.error && (
          <div className="clientes-alert clientes-alert--error">
            {session.error}
          </div>
        )}
      </header>

      {/* Feedback toasts */}
      {(callFeedback || billFeedback) && (
        <div className="clientes-feedback">
          {callFeedback && <ToastInline type="success" message={callFeedback} />}
          {billFeedback && <ToastInline type="success" message={billFeedback} />}
        </div>
      )}

      {/* Loading state */}
      {loading && (
        <section className="clientes-items">
          <div className="clientes-items__grid">
            {[1, 2, 3, 4].map(i => (
              <MenuItemCardSkeleton key={i} />
            ))}
          </div>
        </section>
      )}

      {/* Error state */}
      {!loading && error && (
        <section className="clientes-items">
          <MenuItemCardEmpty onRetry={loadMenu} />
        </section>
      )}

      {/* Categories + Items */}
      {!loading && !error && (
        <>
          {/* Category filter */}
          <nav className="clientes-categories" role="tablist">
            <CategoryButton
              label="Todo el Menú"
              active={!selectedCategory}
              onClick={() => setSelectedCategory(null)}
            />
            {categories.filter(c => c.isActive).map(cat => (
              <CategoryButton
                key={cat.id}
                label={cat.name}
                emoji={cat.emoji}
                active={selectedCategory === cat.id}
                onClick={() => setSelectedCategory(cat.id)}
              />
            ))}
          </nav>

          {/* Menu items */}
          <section className="clientes-items">
            {cats.map(cat => {
              const catItems = filteredItems.filter(i => i.categoryId === cat.id);
              if (catItems.length === 0) return null;

              return (
                <div key={cat.id} className="clientes-category-group">
                  {selectedCategory && (
                    <h2 className="clientes-category-title">
                      {cat.emoji} {cat.name}
                    </h2>
                  )}
                  <div className="clientes-items__grid">
                    {catItems.map(item => (
                      <MenuItemCard
                        key={item.id}
                        item={item}
                        onSelect={() => setDetailItem(item)}
                      />
                    ))}
                  </div>
                </div>
              );
            })}

            {cats.length === 0 && items.length === 0 && (
              <MenuItemCardEmpty onRetry={loadMenu} />
            )}
          </section>
        </>
      )}

      {/* Customer actions */}
      {session.canCallWaiter && (
        <footer className="clientes-actions">
          <button
            className="clientes-actions__btn clientes-actions__btn--call animate-fade-in-up"
            onClick={handleCallWaiter}
          >
            Llamar Mesero
          </button>
          <button
            className="clientes-actions__btn clientes-actions__btn--bill animate-fade-in-up"
            onClick={handleRequestBill}
          >
            Pedir Cuenta
          </button>
        </footer>
      )}

      {/* Read-only mode */}
      {session.isReadOnly && !session.canCallWaiter && session.isValid && (
        <footer className="clientes-actions clientes-actions--readonly">
          <p>Escanea el QR cuando tengas un pedido activo para llamar al mesero.</p>
        </footer>
      )}

      {/* Item detail modal */}
      {detailItem && (
        <ItemDetailModal item={detailItem} onClose={() => setDetailItem(null)} />
      )}

      {/* FORCH.i badge */}
      <ForchiBadge />
    </div>
  );
}
