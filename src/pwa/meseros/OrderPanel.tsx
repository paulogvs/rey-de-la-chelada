/**
 * OrderPanel — Create orders for a table (API-driven)
 *
 * - Browse menu by category (GET /api/menu)
 * - Select items with modifiers (GET /api/menu/items/:id)
 * - Quantity stepper
 * - Confirm → POST /api/orders (draft) → PATCH /:id/submit (called)
 *   → PATCH /:id/confirm (confirmed → KDS)
 *
 * Replaces the in-memory orderEngine/tableEngine flow.
 */

import React, { useState, useEffect, useCallback } from 'react';
import type { Table, ModifierOption } from '@/core/types';
import { useToast } from '@/ui/components/Toast';
import { Card } from '@/ui/components/Card';
import { Button } from '@/ui/components/Button';
import { Badge } from '@/ui/components/Badge';
import { QuantityStepper } from '@/ui/components/QuantityStepper';
import { Modal } from '@/ui/components/Modal';
import { Loader } from '@/ui/components/Loader';
import { EmptyState } from '@/ui/components/EmptyState';
import { PriceDisplay } from '@/ui/components/PriceDisplay';
import { fetchMenuCategories, fetchMenuItems, fetchMenuItemDetail, type MenuItem } from '../_shared/api/menuApi';
import { createOrder, fetchOrderById, deliverOrder, addOrderItem, removeOrderItem, type Order } from '../_shared/api/ordersApi';
import { PrintReceipt } from '../_shared/components/PrintReceipt';
import { buildReceiptData } from '../_shared/utils/receipt';
import { computeTotals } from '@/core/config/iva';

/** Badge de estado del pedido (S2-B) */
const ORDER_STATUS_BADGE: Record<string, { variant: 'pending' | 'preparing' | 'ready' | 'paid' | 'cancelled' | 'info'; label: string }> = {
  draft:      { variant: 'info',      label: 'Borrador' },
  called:     { variant: 'pending',   label: 'Enviado' },
  confirmed:  { variant: 'pending',   label: 'Confirmado' },
  preparing:  { variant: 'preparing', label: 'En preparación' },
  ready:      { variant: 'ready',     label: 'Listo' },
  served:     { variant: 'paid',      label: 'Servido' },
  paid:       { variant: 'paid',      label: 'Pagado' },
  cancelled:  { variant: 'cancelled', label: 'Cancelado' },
};

const ACTIVE_ORDER_STATUSES = new Set(['called', 'confirmed', 'preparing', 'ready', 'served']);

/** Totales de comanda con modelo SSOT EXTRACTIVO (precio incluye IVA). */
function orderPanelTotals(cartTotal: number) {
  const totals = computeTotals(cartTotal);
  return { subtotal: totals.subtotal, ivaAmount: totals.iva, total: totals.total };
}

interface OrderPanelProps {
  table: Table;
  token: string;
  onOrderPlaced: (orderId: string) => void;
  onCancel: () => void;
  onBack: () => void;
  /** FASE 4C: cobrar el pedido (solo habilitado cuando served — TODO entregado) */
  onRequestPayment: (orderId: string) => void;
}

interface CartItem {
  menuItem: MenuItem;
  quantity: number;
  selectedModifiers: ModifierOption[];
  notes: string;
}

interface DetailModifier {
  option_id: string;
  option_name: string;
  option_price: number;
  option_default: number;
}

interface DetailGroup {
  id: string;
  name: string;
  type: 'select' | 'multi' | 'toggle';
  required: boolean;
  options: DetailModifier[];
}

export function OrderPanel({ table, token, onOrderPlaced, onCancel: _onCancel, onBack, onRequestPayment }: OrderPanelProps) {
  const { addToast } = useToast();
  const [categories, setCategories] = useState<{ id: string; name: string; emoji: string }[]>([]);
  const [items, setItems] = useState<MenuItem[]>([]);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [itemDetail, setItemDetail] = useState<MenuItem | null>(null);
  const [detailGroups, setDetailGroups] = useState<DetailGroup[]>([]);
  const [itemQuantity, setItemQuantity] = useState(1);
  const [itemModifiers, setItemModifiers] = useState<ModifierOption[]>([]);
  const [itemNotes, setItemNotes] = useState('');
  const [loadingMenu, setLoadingMenu] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [printOpen, setPrintOpen] = useState(false);

  // ── S2-B: pedido en curso de la mesa (si hay uno activo) ──
  const [activeOrder, setActiveOrder] = useState<Order | null>(null);
  const [loadingActive, setLoadingActive] = useState(false);
  const [delivering, setDelivering] = useState(false);
  const [removingItemId, setRemovingItemId] = useState<string | null>(null);
  const [activeOrderTick, setActiveOrderTick] = useState(0);
  // FASE 4A: modo edición del pedido activo (agregar items → nueva ronda)
  const [editMode, setEditMode] = useState(false);

  // Si la mesa ya tiene currentOrderId, cargar el pedido y mostrar su estado
  // en lugar de crear uno nuevo (el mesero ve items/listos y puede entregar).
  useEffect(() => {
    let disposed = false;
    const orderId = table.currentOrderId;
    if (!orderId) {
      setActiveOrder(null);
      return undefined;
    }
    (async () => {
      setLoadingActive(true);
      try {
        const result = await fetchOrderById(token, orderId);
        if (disposed) return;
        if (result.ok && result.order && ACTIVE_ORDER_STATUSES.has(result.order.status)) {
          setActiveOrder(result.order);
        } else {
          setActiveOrder(null);
        }
      } catch (err) {
        console.error('[OrderPanel] active order error:', err);
        if (!disposed) setActiveOrder(null);
      } finally {
        if (!disposed) setLoadingActive(false);
      }
    })();
    return () => { disposed = true; };
  }, [table.currentOrderId, token, activeOrderTick]);

  // FASE 4C: entregar por ronda+módulo — el botón "Pedido Entregado"
  // entrega TODA la ronda de ESE módulo de una vez (cocina / bar).
  const handleDeliver = useCallback(async (module: 'bar' | 'cocina', round: number) => {
    if (!activeOrder) return;
    setDelivering(true);
    try {
      const result = await deliverOrder(token, activeOrder.id, { module, round });
      if (!result.ok) {
        addToast({ type: 'error', message: result.error || 'No se pudo marcar como entregado', duration: 5000 });
        return;
      }
      addToast({
        type: 'success',
        message: `Mesa ${table.number} — Ronda ${round} ${module === 'bar' ? '🍺 barra' : '🍳 cocina'} entregada ✓`,
        duration: 3000,
      });
      setActiveOrderTick(t => t + 1);
    } catch (err) {
      console.error('[OrderPanel] deliver error:', err);
      addToast({ type: 'error', message: 'Error al marcar el pedido como entregado', duration: 5000 });
    } finally {
      setDelivering(false);
    }
  }, [activeOrder, token, table.number, addToast]);

  // FASE 4A: quitar item del pedido activo (cancelación vía mesero)
  const handleRemoveItem = useCallback(async (itemId: string) => {
    if (!activeOrder) return;
    setRemovingItemId(itemId);
    try {
      const result = await removeOrderItem(token, activeOrder.id, itemId);
      if (!result.ok) {
        addToast({ type: 'error', message: result.error || 'No se pudo quitar el item', duration: 5000 });
        return;
      }
      addToast({ type: 'success', message: 'Item quitado del pedido', duration: 2500 });
      setActiveOrderTick(t => t + 1);
    } catch (err) {
      console.error('[OrderPanel] remove item error:', err);
      addToast({ type: 'error', message: 'Error al quitar el item', duration: 5000 });
    } finally {
      setRemovingItemId(null);
    }
  }, [activeOrder, token, addToast]);

  // FASE 4A: agregar items al pedido activo (ronda nueva si ya se procesó)
  const handleAddItemsToActiveOrder = useCallback(async () => {
    if (!activeOrder) return;
    if (cart.length === 0) {
      addToast({ type: 'warning', message: 'Agrega items al pedido', duration: 3000 });
      return;
    }
    setSubmitting(true);
    try {
      for (const ci of cart) {
        const res = await addOrderItem(token, activeOrder.id, {
          menu_item_id: ci.menuItem.id,
          quantity: ci.quantity,
          notes: ci.notes || undefined,
          modifiers: ci.selectedModifiers.map(m => ({
            groupName: (detailGroups.find(g => g.options.some(o => o.option_id === m.id))?.name) || '',
            optionName: m.name,
            priceAdjustment: m.priceAdjustment ?? 0,
          })),
        });
        if (!res.ok) {
          addToast({ type: 'error', message: res.error || `No se pudo agregar ${ci.menuItem.name}`, duration: 5000 });
          return;
        }
      }
      addToast({
        type: 'success',
        message: `Mesa ${table.number} — items agregados (${cart.length}) — enviados a cocina/bar`,
        duration: 3500,
      });
      setCart([]);
      setEditMode(false);
      setActiveOrderTick(t => t + 1);
    } catch (err) {
      console.error('[OrderPanel] add items error:', err);
      addToast({ type: 'error', message: 'Error al agregar items al pedido', duration: 5000 });
    } finally {
      setSubmitting(false);
    }
  }, [activeOrder, cart, token, table.number, detailGroups, addToast]);

  // Load menu (public endpoints)
  useEffect(() => {
    let disposed = false;
    (async () => {
      setLoadingMenu(true);
      const [cats, its] = await Promise.all([fetchMenuCategories(), fetchMenuItems()]);
      if (disposed) return;
      if (cats.ok) setCategories(cats.categories.map(c => ({ id: c.id, name: c.name, emoji: c.emoji })));
      if (its.ok) setItems(its.items.filter(i => i.is_active === 1 && i.is_available === 1));
      setLoadingMenu(false);
    })();
    return () => { disposed = true; };
  }, []);

  const filteredItems = activeCategory ? items.filter(i => i.category_id === activeCategory) : items;

  // Load modifiers when an item is opened
  const openItem = useCallback(async (item: MenuItem) => {
    setItemDetail(item);
    setItemQuantity(1);
    setItemModifiers([]);
    setItemNotes('');
    setDetailGroups([]);
    try {
      const detail = await fetchMenuItemDetail(item.id);
      if (detail.ok && detail.modifiers) {
        setDetailGroups(detail.modifiers.map(g => ({
          id: g.id,
          name: g.name,
          type: g.type,
          required: g.required === 1,
          options: g.options.map(o => ({
            option_id: o.option_id,
            option_name: o.option_name,
            option_price: o.option_price,
            option_default: o.option_default,
          })),
        })));
      }
    } catch (err) {
      console.error('[OrderPanel] modifiers error:', err);
    }
  }, []);

  const closeItem = useCallback(() => {
    setItemDetail(null);
    setItemQuantity(1);
    setItemModifiers([]);
    setItemNotes('');
  }, []);

  // Cart totals (modifier adjustments included)
  const cartTotal = cart.reduce((sum, ci) => {
    const modAdjustment = ci.selectedModifiers.reduce((s, m) => s + (m.priceAdjustment ?? 0), 0);
    return sum + (((ci.menuItem.price ?? 0) + modAdjustment) * ci.quantity);
  }, 0);

  const addToCart = useCallback(() => {
    if (!itemDetail) return;
    setCart(prev => {
      const existing = prev.find(ci =>
        ci.menuItem.id === itemDetail.id &&
        JSON.stringify(ci.selectedModifiers.map(m => m.id).sort()) === JSON.stringify(itemModifiers.map(m => m.id).sort())
      );
      if (existing) {
        return prev.map(ci => (ci === existing ? { ...ci, quantity: ci.quantity + itemQuantity } : ci));
      }
      return [...prev, {
        menuItem: itemDetail,
        quantity: itemQuantity,
        selectedModifiers: itemModifiers,
        notes: itemNotes,
      }];
    });
    closeItem();
  }, [itemDetail, itemQuantity, itemModifiers, itemNotes, closeItem]);

  const removeFromCart = useCallback((index: number) => {
    setCart(prev => prev.filter((_, i) => i !== index));
  }, []);

  const updateQuantity = useCallback((index: number, quantity: number) => {
    setCart(prev => prev.map((ci, i) => (i === index ? { ...ci, quantity } : ci)));
  }, []);

  // FASE 4A: crear pedido en UNA llamada — POST /api/orders crea directo
  // 'confirmed' y el server lo envía al KDS al instante (adiós submit/confirm).
  const placeOrder = useCallback(async () => {
    if (cart.length === 0) {
      addToast({ type: 'warning', message: 'Agrega items al pedido', duration: 3000 });
      return;
    }

    setSubmitting(true);
    try {
      const payload = {
        table_id: table.id,
        guest_count: table.capacity,
        items: cart.map(ci => ({
          menu_item_id: ci.menuItem.id,
          quantity: ci.quantity,
          notes: ci.notes || undefined,
          modifiers: ci.selectedModifiers.map(m => ({
            groupName: (detailGroups.find(g => g.options.some(o => o.option_id === m.id))?.name) || '',
            optionName: m.name,
            priceAdjustment: m.priceAdjustment ?? 0,
          })),
        })),
      };

      const created = await createOrder(token, payload);
      if (!created.ok || !created.order) {
        addToast({ type: 'error', message: created.error || 'No se pudo crear el pedido', duration: 5000 });
        return;
      }

      onOrderPlaced(created.order.id);
    } catch (err) {
      console.error('[OrderPanel] placeOrder error:', err);
      addToast({ type: 'error', message: 'Error al enviar el pedido', duration: 5000 });
    } finally {
      setSubmitting(false);
    }
  }, [cart, table, token, detailGroups, addToast, onOrderPlaced]);

  // FASE 4B: rondas del pedido activo (items agrupados por round)
  const rounds = activeOrder
    ? [...new Set(activeOrder.items.map(i => i.round ?? 1))].sort((a, b) => a - b)
    : [];

  const modLabel = (mod: string) => (mod === 'bar' ? '🍺 Barra' : '🍳 Cocina');

  // ¿Se puede editar el pedido? (agregar/quitar) — no si está cerrado
  const canEditOrder = !!activeOrder && !['paid', 'cancelled'].includes(activeOrder.status);

  // FASE 4C: cobro SOLO cuando TODO el pedido está entregado (served)
  const canCharge = !!activeOrder && activeOrder.status === 'served';

  return (
    <div className="order-panel">
      {/* ── S2-B: Pedido en curso (mesa con order activo) ── */}
      {loadingActive && <Loader variant="block" label="Cargando pedido…" />}

      {!loadingActive && activeOrder && !editMode && (
        <div className="order-panel__active">
          {/* Header del pedido (sin card contenedor — cada ronda es su card) */}
          <div className="order-panel__active-header">
            <div>
              <h3>Pedido en curso — Mesa {table.number}</h3>
              <p className="order-panel__active-sub">
                {activeOrder.items.length} items · {activeOrder.waiterName ? `atendido por ${activeOrder.waiterName}` : ''}
              </p>
            </div>
            <Badge variant={ORDER_STATUS_BADGE[activeOrder.status]?.variant ?? 'info'}>
              {ORDER_STATUS_BADGE[activeOrder.status]?.label ?? activeOrder.status}
            </Badge>
          </div>

          {/* FASE 4.5: CADA RONDA es un Card independiente (con borde propio),
              apilados hacia abajo — el scroll de la página muestra todas.
              Dentro: cards de módulo lado a lado (🍺 Barra | 🍳 Cocina).
              - Ronda con 2 módulos → 2 columnas
              - Ronda con 1 módulo → ancho completo
              Cada card de módulo es independiente: entregar una no toca otras. */}
          {rounds.map(round => {
            const roundItems = activeOrder.items.filter(i => (i.round ?? 1) === round);
            const modsInRound = [...new Set(roundItems.map(i => i.kdsModule || 'cocina'))];
            const roundTotal = roundItems.reduce((s, i) => s + i.subtotal, 0);
            return (
              <Card key={round} padded={false} className="order-panel__round-group">
                <div className="order-panel__round-group-header">
                  <span className="order-panel__round-group-title">
                    {round === 1 ? 'Ronda 1' : `Ronda ${round} 🆕`}
                  </span>
                  <span className="order-panel__round-group-total">
                    Bs. {roundTotal.toFixed(2)}
                  </span>
                </div>
                <div
                  className={`order-panel__round-group-cards${modsInRound.length === 1 ? ' order-panel__round-group-cards--single' : ''}`}
                >
                  {modsInRound.map(mod => {
                    const modKey = (mod === 'bar' ? 'bar' : 'cocina') as 'bar' | 'cocina';
                    const modItems = roundItems.filter(i => (i.kdsModule || 'cocina') === mod);
                    const hasReady = modItems.some(i => i.status === 'ready');
                    const inProgress = modItems.some(i => i.status === 'pending' || i.status === 'preparing');
                    const cardState = hasReady ? 'ready' : inProgress ? 'preparing' : 'done';
                    const modTotal = modItems.reduce((s, i) => s + i.subtotal, 0);
                    return (
                      <div
                        key={`${round}-${mod}`}
                        className={`order-panel__mod-card order-panel__mod-card--${cardState}`}
                      >
                        <div className="order-panel__mod-card-header">
                          <span className="order-panel__mod-card-title">
                            {modLabel(mod)}
                            {round > 1 && <span className="order-panel__mod-card-round"> · Ronda {round} 🆕</span>}
                          </span>
                          <span className="order-panel__mod-card-state">
                            {cardState === 'ready' ? '✓ Listo' : cardState === 'preparing' ? 'En proceso…' : '✓ Entregado'}
                          </span>
                        </div>

                        <div className="order-panel__mod-card-items">
                          {modItems.map(item => {
                            const canRemove = canEditOrder && ['pending', 'preparing'].includes(item.status);
                            return (
                              <div key={item.id} className="order-panel__active-item">
                                <span className="order-panel__active-item-qty">{item.quantity}x</span>
                                <span className="order-panel__active-item-name">{item.menuItemName}</span>
                                <span className="order-panel__active-item-price">Bs. {item.subtotal.toFixed(2)}</span>
                                {canRemove && (
                                  <button
                                    className="order-panel__active-item-remove"
                                    onClick={() => handleRemoveItem(item.id)}
                                    disabled={removingItemId === item.id}
                                    aria-label={`Quitar ${item.menuItemName}`}
                                    title="Quitar item"
                                  >
                                    {removingItemId === item.id ? '…' : '🗑️'}
                                  </button>
                                )}
                              </div>
                            );
                          })}
                        </div>

                        <div className="order-panel__mod-card-footer">
                          <span className="order-panel__mod-card-total">Bs. {modTotal.toFixed(2)}</span>
                          {cardState === 'ready' && (
                            <Button
                              size="sm"
                              variant="primary"
                              className="order-panel__mod-card-deliver"
                              onClick={() => handleDeliver(modKey, round)}
                              loading={delivering}
                              disabled={delivering}
                            >
                              ✅ Entregado
                            </Button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </Card>
            );
          })}

          <PriceDisplay
            priceWithIVA={activeOrder.total}
            showBreakdown
            className="order-panel__active-total"
          />

          <div className="order-panel__actions">
            <Button variant="secondary" onClick={onBack}>
              ← Volver a mesas
            </Button>
            {canEditOrder && (
              <Button variant="secondary" onClick={() => setEditMode(true)}>
                ➕ Agregar items
              </Button>
            )}
            {canCharge && (
              <Button
                variant="primary"
                onClick={() => onRequestPayment(activeOrder.id)}
                fullWidth
              >
                💰 Cobrar Mesa {table.number}
              </Button>
            )}
            {!canCharge && activeOrder.status === 'served' && (
              <p className="order-panel__active-hint">
                Pedido servido — todo entregado. El botón 💰 Cobrar aparecerá al refrescar la mesa.
              </p>
            )}
            {!canCharge && !['paid', 'cancelled', 'served'].includes(activeOrder.status) && (
              <p className="order-panel__active-hint">
                Esperando a que cocina/bar marquen los items como listos 🍽️
              </p>
            )}
          </div>
        </div>
      )}

      {/* ── Flujo de creación / edición (sin pedido activo o editMode) ── */}
      {!loadingActive && (!activeOrder || editMode) && (
      <>
      {editMode && (
        <div className="order-panel__edit-banner">
          Agregando items al pedido de la Mesa {table.number}
          {activeOrder && (
            <button className="order-panel__edit-cancel" onClick={() => { setEditMode(false); setCart([]); }}>
              Cancelar edición
            </button>
          )}
        </div>
      )}
      {/* Category bar */}
      <nav className="order-panel__categories">
        <button
          className={`order-panel__cat-btn ${!activeCategory ? 'active' : ''}`}
          onClick={() => setActiveCategory(null)}
        >
          Todo
        </button>
        {categories.map(cat => (
          <button
            key={cat.id}
            className={`order-panel__cat-btn ${activeCategory === cat.id ? 'active' : ''}`}
            onClick={() => setActiveCategory(cat.id)}
          >
            {cat.emoji} {cat.name}
          </button>
        ))}
      </nav>

      <div className="order-panel__content">
        {/* Menu items */}
        <div className="order-panel__items">
          {loadingMenu && <Loader label="Cargando menú…" />}
          {!loadingMenu && filteredItems.length === 0 && (
            <EmptyState compact icon="🍺" message="Sin items en esta categoría" />
          )}
          {filteredItems.map(item => (
            <button
              key={item.id}
              className="order-panel__item"
              onClick={() => openItem(item)}
            >
              <div className="order-panel__item-info">
                <span className="order-panel__item-name">{item.name}</span>
                <span className="order-panel__item-price">
                  {item.price != null ? `Bs. ${item.price.toFixed(2)}` : 'Ver variantes'}
                </span>
              </div>
              {item.subtitle && (
                <span className="order-panel__item-subtitle">{item.subtitle}</span>
              )}
            </button>
          ))}
        </div>

        {/* Cart */}
        <div className="order-panel__cart">
          <h3 className="order-panel__cart-title">
            {editMode ? `Agregar al pedido de Mesa ${table.number} (${cart.length} items)` : `Pedido actual (${cart.length} items)`}
          </h3>

          {cart.length === 0 && (
            <p className="order-panel__cart-empty">
              Selecciona items del menú para agregar al pedido
            </p>
          )}

          {cart.map((ci, index) => {
            const modAdjustment = ci.selectedModifiers.reduce((s, m) => s + (m.priceAdjustment ?? 0), 0);
            const lineTotal = ((ci.menuItem.price ?? 0) + modAdjustment) * ci.quantity;

            return (
              <Card key={index} padded={false} className="order-panel__cart-item">
                <div className="order-panel__cart-item-header">
                  <span className="order-panel__cart-item-name">{ci.menuItem.name}</span>
                  <button
                    className="order-panel__cart-item-remove"
                    onClick={() => removeFromCart(index)}
                    aria-label="Eliminar"
                  >
                    ✕
                  </button>
                </div>
                {ci.selectedModifiers.length > 0 && (
                  <div className="order-panel__cart-item-mods">
                    {ci.selectedModifiers.map(m => m.name).join(', ')}
                  </div>
                )}
                {ci.notes && <div className="order-panel__cart-item-notes">{ci.notes}</div>}
                <div className="order-panel__cart-item-footer">
                  <QuantityStepper
                    value={ci.quantity}
                    min={1}
                    max={50}
                    onChange={(q) => updateQuantity(index, q)}
                    size="md"
                  />
                  <span className="order-panel__cart-item-total">
                    Bs. {lineTotal.toFixed(2)}
                  </span>
                </div>
              </Card>
            );
          })}

          {cart.length > 0 && (
            <div className="order-panel__cart-total">
              <span>Total</span>
              <span className="order-panel__cart-total-amount">Bs. {cartTotal.toFixed(2)}</span>
            </div>
          )}

          <div className="order-panel__actions">
            <Button variant="secondary" onClick={editMode ? () => { setEditMode(false); setCart([]); } : onBack}>
              {editMode ? 'Cancelar edición' : 'Cancelar'}
            </Button>
            <Button
              variant="secondary"
              onClick={() => setPrintOpen(true)}
              disabled={cart.length === 0}
            >
              🖨️ Imprimir
            </Button>
            {editMode ? (
              <Button
                variant="primary"
                onClick={handleAddItemsToActiveOrder}
                disabled={cart.length === 0 || submitting}
                loading={submitting}
                fullWidth
              >
                {submitting ? 'Agregando…' : '➕ Agregar al Pedido'}
              </Button>
            ) : (
              <Button
                variant="primary"
                onClick={placeOrder}
                disabled={cart.length === 0 || submitting}
                loading={submitting}
                fullWidth
              >
                {submitting ? 'Enviando…' : 'Confirmar Pedido'}
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Item detail modal */}
      <Modal
        open={!!itemDetail}
        onClose={closeItem}
        title={itemDetail?.name || ''}
      >
        {itemDetail && (
          <div className="order-panel__detail">
            {itemDetail.description && (
              <p className="order-panel__detail-desc">{itemDetail.description}</p>
            )}
            {itemDetail.price != null && (
              <p className="order-panel__detail-price">Bs. {itemDetail.price.toFixed(2)}</p>
            )}

            {/* Modifiers */}
            {detailGroups.map(group => (
              <div key={group.id} className="order-panel__detail-mod-group">
                <label className="order-panel__detail-mod-label">
                  {group.name}
                  {group.required && <span className="text-muted"> (requerido)</span>}
                </label>
                <div className="order-panel__detail-mod-options">
                  {group.options.map(opt => {
                    const selected = itemModifiers.some(m => m.id === opt.option_id);
                    return (
                      <button
                        key={opt.option_id}
                        className={`order-panel__detail-mod-option ${selected ? 'active' : ''}`}
                        onClick={() => {
                          const mod: ModifierOption = {
                            id: opt.option_id,
                            name: opt.option_name,
                            priceAdjustment: opt.option_price,
                            isDefault: opt.option_default === 1,
                            sortOrder: 0,
                          };
                          if (group.type === 'select') {
                            setItemModifiers(prev => [
                              ...prev.filter(m => !group.options.some(o => o.option_id === m.id)),
                              mod,
                            ]);
                          } else {
                            setItemModifiers(prev =>
                              selected
                                ? prev.filter(m => m.id !== opt.option_id)
                                : [...prev, mod]
                            );
                          }
                        }}
                      >
                        {opt.option_name}
                        {opt.option_price !== 0 && (
                          <span className="order-panel__detail-mod-price">
                            {opt.option_price > 0 ? '+' : ''}Bs. {opt.option_price.toFixed(2)}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}

            {/* Notes */}
            <div className="order-panel__detail-notes">
              <label htmlFor="item-notes">Notas de preparación</label>
              <textarea
                id="item-notes"
                className="order-panel__detail-textarea"
                value={itemNotes}
                onChange={e => setItemNotes(e.target.value)}
                placeholder="Ej: sin hielo, bien cocido..."
                rows={2}
              />
            </div>

            {/* Quantity + Add */}
            <div className="order-panel__detail-footer">
              <QuantityStepper
                value={itemQuantity}
                min={1}
                max={50}
                onChange={setItemQuantity}
                size="md"
              />
              <Button variant="primary" onClick={addToCart} fullWidth>
                Agregar (Bs. {(((itemDetail.price ?? 0) * itemQuantity)).toFixed(2)})
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Print comanda (cart preview) */}
      <PrintReceipt
        open={printOpen}
        onClose={() => setPrintOpen(false)}
        kind="order"
        receipt={buildReceiptData({
          id: `comanda-${Date.now()}`,
          tableNumber: table.number,
          createdAt: new Date().toISOString(),
          // Modelo SSOT EXTRACTIVO: cartTotal ya incluye IVA
          ...orderPanelTotals(cartTotal),
          paymentMethod: undefined,
          items: cart.map(ci => ({
            menuItemName: ci.menuItem.name,
            quantity: ci.quantity,
            unitPrice: (ci.menuItem.price ?? 0) + ci.selectedModifiers.reduce((s, m) => s + (m.priceAdjustment ?? 0), 0),
            subtotal: (((ci.menuItem.price ?? 0) + ci.selectedModifiers.reduce((s, m) => s + (m.priceAdjustment ?? 0), 0)) * ci.quantity),
            modifiers: ci.selectedModifiers.map(m => ({
              optionName: m.name,
              priceAdjustment: m.priceAdjustment ?? 0,
            })),
          })),
        })}
        label={`Mesa ${table.number} — Comanda`}
      />
      </>
      )}
    </div>
  );
}

export default OrderPanel;
