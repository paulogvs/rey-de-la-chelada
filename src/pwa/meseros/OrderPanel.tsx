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
import { fetchMenuCategories, fetchMenuItems, fetchMenuItemDetail, type MenuItem } from '../_shared/api/menuApi';
import { createOrder, submitOrder, confirmOrder } from '../_shared/api/ordersApi';
import { PrintReceipt } from '../_shared/components/PrintReceipt';
import { buildReceiptData } from '../_shared/utils/receipt';
import { computeTotals } from '@/core/config/iva';

/** Totales de comanda con modelo SSOT EXTRACTIVO (precio incluye IVA). */
function orderPanelTotals(cartTotal: number) {
  return computeTotals(cartTotal);
}

interface OrderPanelProps {
  table: Table;
  token: string;
  onOrderPlaced: (orderId: string) => void;
  onCancel: () => void;
  onBack: () => void;
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

export function OrderPanel({ table, token, onOrderPlaced, onCancel, onBack }: OrderPanelProps) {
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
    const mods = itemModifiers.map(m => ({
      id: m.id,
      name: m.name,
      priceAdjustment: m.priceAdjustment ?? 0,
    }));
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

  // Place order via API: create (draft) → submit (called) → confirm (confirmed)
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

      // draft → called (client sends to mesero queue)
      const submitted = await submitOrder(token, created.order.id);
      if (!submitted.ok) {
        addToast({ type: 'error', message: submitted.error || 'No se pudo enviar el pedido', duration: 5000 });
        return;
      }

      // called → confirmed (mesero accepts → KDS gets it)
      const confirmed = await confirmOrder(token, created.order.id);
      if (!confirmed.ok) {
        addToast({ type: 'error', message: confirmed.error || 'No se pudo confirmar el pedido', duration: 5000 });
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

  return (
    <div className="order-panel">
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
            Pedido actual ({cart.length} items)
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
                    size="sm"
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
            <Button variant="secondary" onClick={onBack}>
              Cancelar
            </Button>
            <Button
              variant="secondary"
              onClick={() => setPrintOpen(true)}
              disabled={cart.length === 0}
            >
              🖨️ Imprimir
            </Button>
            <Button
              variant="primary"
              onClick={placeOrder}
              disabled={cart.length === 0 || submitting}
              loading={submitting}
              fullWidth
            >
              {submitting ? 'Enviando…' : 'Confirmar Pedido'}
            </Button>
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
    </div>
  );
}

export default OrderPanel;
