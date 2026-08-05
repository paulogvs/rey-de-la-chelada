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
import { ToastInline } from '@/ui/components/Toast';
import { OrderBar } from '@/ui/components/OrderBar';
import { OrderSummary } from '@/ui/components/OrderSummary';
import { ItemDetailModal } from '../components/ItemDetailModal';
import { CategoryButton, MenuBanner, PageHeader, CustomerActions } from '../components/MenuChrome';
import { canSubmitClientOrder } from '../utils/orderSendGate';
import { computeTotals } from '@/core/config/iva';
import './MenuPage.css';

/** Draft item type for local state */
interface DraftItem {
  id: string;
  menuItemId: string;
  name: string;
  quantity: number;
  unitPrice: number;
  /** Selected modifier option ids (pizza sizes, extras) */
  modifierOptionIds: string[];
}

/** Add (or bump) a draft line, optionally with selected modifier options. */
function buildDraftItem(
  item: MenuItem,
  modifierOptionIds: string[] = []
): DraftItem {
  // Unit price = base price + modifier adjustments (size variants)
  const adjustment = item.modifierGroups
    .flatMap(g => g.options)
    .filter(o => modifierOptionIds.includes(o.id))
    .reduce((sum, o) => sum + (o.priceAdjustment ?? 0), 0);
  return {
    id: `draft-${Date.now()}-${item.id}`,
    menuItemId: item.id,
    name: item.name,
    quantity: 1,
    unitPrice: (item.price ?? 0) + adjustment,
    modifierOptionIds,
  };
}

export function MenuPage({
  onSubmitOrder,
}: {
  /** Called with the draft payload to create the public order (parent handles API + tracking). */
  onSubmitOrder: (input: {
    table_number: number;
    session_id: string;
    items: Array<{
      menu_item_id: string;
      quantity: number;
      modifiers?: Array<{ option_id: string }>;
    }>;
    guest_count?: number;
  }) => void;
}) {
  const session = useTableSession();
  const { categories, items, loading, error: apiError, refresh: loadMenu } = useMenu();
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [detailItem, setDetailItem] = useState<MenuItem | null>(null);
  const [callFeedback, setCallFeedback] = useState<string | null>(null);
  const [billFeedback, setBillFeedback] = useState<string | null>(null);

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

  // Add item to draft (with optional modifier selections)
  const handleAddToDraft = useCallback((item: MenuItem, modifierOptionIds: string[] = []) => {
    setDraftItems(prev => {
      const existing = prev.find(d => d.menuItemId === item.id);
      if (existing) {
        return prev.map(d =>
          d.menuItemId === item.id
            ? { ...d, quantity: d.quantity + 1 }
            : d
        );
      }
      return [...prev, buildDraftItem(item, modifierOptionIds)];
    });
  }, []);

  // Draft totals — MODELO SSOT EXTRACTIVO (precio INCLUYE IVA).
  // draftTotal = suma de precios (ya incluye IVA → es lo que paga el cliente).
  const draftTotal = draftItems.reduce((sum, d) => sum + d.unitPrice * d.quantity, 0);
  const draftBreakdown = computeTotals(draftTotal);
  const draftIva = draftBreakdown.iva;
  const draftTotalWithIva = draftBreakdown.total; // = draftTotal (incluye IVA)
  const draftItemCount = draftItems.reduce((sum, d) => sum + d.quantity, 0);

  // Send draft to waiter via the PUBLIC client-orders endpoint
  // (no JWT — table_number + session_id is the permission)
  const handleSendDraft = useCallback(async () => {
    // FASE 1: antes usaba `session.tableId` (campo inexistente) → el pedido
    // jamás se enviaba. Ahora usa el helper centralizado con `tableNumber`.
    if (!canSubmitClientOrder(session, draftItems.length)) return;
    setSending(true);
    setCallFeedback(null);
    try {
      onSubmitOrder({
        table_number: session.tableNumber,
        session_id: session.sessionId,
        items: draftItems.map(d => ({
          menu_item_id: d.menuItemId,
          quantity: d.quantity,
          modifiers: d.modifierOptionIds.length > 0
            ? d.modifierOptionIds.map(option_id => ({ option_id }))
            : undefined,
        })),
        guest_count: 1,
      });
      setDraftItems([]);
      setShowSummary(false);
    } catch {
      setCallFeedback('❌ Error al enviar pedido');
      setTimeout(() => setCallFeedback(null), 4000);
    } finally {
      setSending(false);
    }
  }, [draftItems, session.tableNumber, session.sessionId, onSubmitOrder]);

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
      <PageHeader
        tableNumber={session.tableNumber}
        sessionValid={session.isValid}
        sessionError={session.error}
      />

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
      <CustomerActions
        canCallWaiter={session.canCallWaiter}
        canRequestBill={session.canRequestBill}
        isReadOnly={session.isReadOnly}
        isValid={session.isValid}
        onCallWaiter={handleCallWaiter}
        onRequestBill={handleRequestBill}
      />

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
    </div>
  );
}
