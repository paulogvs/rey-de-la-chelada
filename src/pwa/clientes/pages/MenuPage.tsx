/**
 * PWA CLIENTES — Página de Menú Digital
 *
 * "El pedido activo es el permiso"
 * - Menú siempre visible (offline-first)
 * - Draft order with OrderBar + OrderSummary
 * - Llamar mesero con debounce anti-spam
 * - Pedir cuenta con confirmación
 * - Loading/empty/error states con componentes compartidos
 * - Tap item → detail view (modifiers, description, photo)
 */

import React, { useState, useCallback } from 'react';
import type { MenuItem } from '@/core/types';
import { useTableSession } from '../hooks/useTableSession';
import { useMenu } from '../hooks/useMenu';
import { MenuItemCard, MenuItemCardSkeleton, MenuItemCardEmpty } from '@/ui/components/MenuItemCard';
import { Badge } from '@/ui/components/Badge';
import { ToastInline } from '@/ui/components/Toast';
import { ForchiBadge } from '@/ui/components/ForchiBadge';
import { OrderBar } from '@/ui/components/OrderBar';
import { OrderSummary } from '@/ui/components/OrderSummary';
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

/**
 * Full-width hero banner above the header.
 * Hides itself if the image is missing (404 / network error).
 * The path is data served by the Express /menu-photos mount.
 */
function MenuBanner() {
  const [imgError, setImgError] = useState(false);
  if (imgError) return null;
  return (
    <img
      src="/menu-photos/micheladas/header-micheladas.png"
      alt="Rey de la Chelada"
      className="clientes-banner"
      onError={() => setImgError(true)}
    />
  );
}

/** Item detail modal */
function ItemDetailModal({
  item,
  onClose,
  onAdd,
}: {
  item: MenuItem;
  onClose: () => void;
  onAdd: (item: MenuItem) => void;
}) {
  // Photo fallback: hide image and show a colored placeholder if it 404s
  const [imgError, setImgError] = React.useState(false);
  const showImage = item.imageUrl && !imgError;
  return (
    <div className="clientes-detail-overlay" onClick={onClose}>
      <div className="clientes-detail" onClick={e => e.stopPropagation()}>
        <button className="clientes-detail__close" onClick={onClose}>✕</button>

        {showImage ? (
          <img
            src={item.imageUrl ?? ''}
            alt={item.name}
            className="clientes-detail__image"
            onError={() => setImgError(true)}
          />
        ) : (
          <div className="clientes-detail__image clientes-detail__image--placeholder" aria-hidden="true">
            {item.name.charAt(0)}
          </div>
        )}

        <h2 className="clientes-detail__name">{item.name}</h2>
        <p className="clientes-detail__desc">{item.description}</p>

        <div className="clientes-detail__price">
          {item.price != null ? `Bs. ${item.price.toFixed(2)}` : '—'}
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

        <button
          className="clientes-detail__add-btn"
          onClick={() => { onAdd(item); onClose(); }}
        >
          Agregar al pedido
        </button>
      </div>
    </div>
  );
}

/** Draft item type for local state */
interface DraftItem {
  id: string;
  menuItemId: string;
  name: string;
  quantity: number;
  unitPrice: number;
}

export function MenuPage() {
  const session = useTableSession();
  const { categories, items, loading, error: apiError, refresh: loadMenu } = useMenu();
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [detailItem, setDetailItem] = useState<MenuItem | null>(null);
  const [callFeedback, setCallFeedback] = useState<string | null>(null);
  const [billFeedback, setBillFeedback] = useState<string | null>(null);
  // Logo fallback: keep text-only brand if the image is missing
  const [logoError, setLogoError] = useState(false);

  // Draft order state
  const [draftItems, setDraftItems] = useState<DraftItem[]>([]);
  const [showSummary, setShowSummary] = useState(false);
  const [sending, setSending] = useState(false);

  // Map API shape (snake_case) → UI shape (camelCase)
  const cats = (selectedCategory
    ? categories.filter(c => c.id === selectedCategory)
    : categories
  ).map(c => ({ ...c, isActive: c.is_active ?? c.isActive ?? true }));

  const filteredItems = items
    .map(i => ({
      ...i,
      categoryId: i.category_id ?? i.categoryId,
      isActive: i.is_active ?? i.isActive ?? true,
      isAvailable: i.is_available ?? i.isAvailable ?? true,
      modifierGroups: i.modifierGroups ?? [],
      tags: i.tags ?? [],
      imageUrl: i.image_url ?? i.imageUrl,
      ivaPercentage: i.iva_percentage ?? i.ivaPercentage ?? 13,
      preparationTime: i.preparation_time ?? i.preparationTime ?? 15,
    }))
    .filter(i => (selectedCategory ? i.categoryId === selectedCategory : true))
    .filter(i => i.isActive && i.isAvailable);

  // Add item to draft
  const handleAddToDraft = useCallback((item: MenuItem) => {
    const price = item.price ?? 0;
    setDraftItems(prev => {
      const existing = prev.find(d => d.menuItemId === item.id);
      if (existing) {
        return prev.map(d =>
          d.menuItemId === item.id
            ? { ...d, quantity: d.quantity + 1 }
            : d
        );
      }
      return [...prev, {
        id: `draft-${Date.now()}-${item.id}`,
        menuItemId: item.id,
        name: item.name,
        quantity: 1,
        unitPrice: price,
      }];
    });
  }, []);

  // Draft totals
  const draftTotal = draftItems.reduce((sum, d) => sum + d.unitPrice * d.quantity, 0);
  const draftIva = Math.round(draftTotal * 0.13 * 100) / 100;
  const draftTotalWithIva = Math.round((draftTotal + draftIva) * 100) / 100;
  const draftItemCount = draftItems.reduce((sum, d) => sum + d.quantity, 0);

  // Send draft to waiter
  const handleSendDraft = useCallback(async () => {
    if (draftItems.length === 0 || !session.tableId) return;
    setSending(true);
    try {
      // Create order via API
      const response = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          table_id: session.tableId,
          items: draftItems.map(d => ({
            menu_item_id: d.menuItemId,
            quantity: d.quantity,
          })),
          guest_count: 1,
        }),
      });

      if (!response.ok) throw new Error('Error al crear pedido');

      const data = await response.json();
      if (data.success && data.order) {
        // Submit the order (draft → called)
        await fetch(`/api/orders/${data.order.id}/submit`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
        });
      }

      setDraftItems([]);
      setShowSummary(false);
      setCallFeedback('✅ Pedido enviado al mesero');
      setTimeout(() => setCallFeedback(null), 3000);
    } catch {
      setCallFeedback('❌ Error al enviar pedido');
      setTimeout(() => setCallFeedback(null), 3000);
    } finally {
      setSending(false);
    }
  }, [draftItems, session.tableId]);

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
      {/* Hero banner (full-width, hidden if missing) */}
      <MenuBanner />

      {/* Header */}
      <header className="clientes-header">
        <div className="clientes-header__brand">
          {!logoError && (
            <img
              src="/logo/rey_de_la_chelada_logo.png"
              alt=""
              className="clientes-header__logo"
              onError={() => setLogoError(true)}
            />
          )}
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
      {!loading && apiError && (
        <section className="clientes-items">
          <MenuItemCardEmpty onRetry={loadMenu} />
        </section>
      )}

      {/* Categories + Items */}
      {!loading && !apiError && (
        <>
          {/* Category filter */}
          <nav className="clientes-categories" role="tablist">
            <CategoryButton
              label="Todo el Menú"
              active={!selectedCategory}
              onClick={() => setSelectedCategory(null)}
            />
            {cats.map(cat => (
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

      {/* Order Bar (draft) */}
      <OrderBar
        itemCount={draftItemCount}
        total={draftTotalWithIva}
        onSend={() => setShowSummary(true)}
        sending={sending}
      />

      {/* Order Summary Modal */}
      {showSummary && (
        <OrderSummary
          items={draftItems.map(d => ({
            id: d.id,
            name: d.name,
            quantity: d.quantity,
            unitPrice: d.unitPrice,
            subtotal: d.unitPrice * d.quantity,
          }))}
          total={draftTotalWithIva}
          ivaAmount={draftIva}
          onConfirm={handleSendDraft}
          onClose={() => setShowSummary(false)}
          confirming={sending}
        />
      )}

      {/* Item detail modal */}
      {detailItem && (
        <ItemDetailModal
          item={detailItem}
          onClose={() => setDetailItem(null)}
          onAdd={handleAddToDraft}
        />
      )}

      {/* FORCH.i badge */}
      <ForchiBadge />
    </div>
  );
}
