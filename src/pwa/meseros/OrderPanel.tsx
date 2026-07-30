/**
 * OrderPanel — Create/edit orders for a table
 *
 * - Browse menu by category
 * - Select items with modifiers
 * - Quantity stepper
 * - Order summary with running total
 * - Confirm → send to KDS
 */

import React, { useState, useEffect, useCallback } from 'react';
import { menuEngine, orderEngine, tableEngine } from '@/core/engine';
import type { Table, MenuItem, MenuCategory, Order, OrderLineItem, ModifierOption } from '@/core/types';
import { useToast } from '@/ui/components/Toast';
import { Card } from '@/ui/components/Card';
import { Button } from '@/ui/components/Button';
import { Badge } from '@/ui/components/Badge';
import { QuantityStepper } from '@/ui/components/QuantityStepper';
import { Modal } from '@/ui/components/Modal';

interface OrderPanelProps {
  table: Table;
  onOrderPlaced: (order: Order) => void;
  onCancel: () => void;
  onBack: () => void;
}

interface CartItem {
  menuItem: MenuItem;
  quantity: number;
  selectedModifiers: ModifierOption[];
  notes: string;
}

export function OrderPanel({ table, onOrderPlaced, onCancel, onBack }: OrderPanelProps) {
  const { addToast } = useToast();
  const [categories, setCategories] = useState<MenuCategory[]>([]);
  const [items, setItems] = useState<MenuItem[]>([]);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [itemDetail, setItemDetail] = useState<MenuItem | null>(null);
  const [itemQuantity, setItemQuantity] = useState(1);
  const [itemModifiers, setItemModifiers] = useState<ModifierOption[]>([]);
  const [itemNotes, setItemNotes] = useState('');

  // Load menu
  useEffect(() => {
    setCategories(menuEngine.getCategories());
    setItems(menuEngine.getItems().filter(i => i.isActive && i.isAvailable));
  }, []);

  // Filter items by category
  const filteredItems = activeCategory
    ? items.filter(i => i.categoryId === activeCategory)
    : items;

  // Calculate cart totals
  const cartTotal = cart.reduce((sum, ci) => {
    const modAdjustment = ci.selectedModifiers.reduce((s, m) => s + m.priceAdjustment, 0);
    return sum + ((ci.menuItem.price + modAdjustment) * ci.quantity);
  }, 0);

  // Add item to cart from detail modal
  const addToCart = useCallback(() => {
    if (!itemDetail) return;

    setCart(prev => {
      const existing = prev.find(ci =>
        ci.menuItem.id === itemDetail.id &&
        JSON.stringify(ci.selectedModifiers.map(m => m.id).sort()) === JSON.stringify(itemModifiers.map(m => m.id).sort())
      );

      if (existing) {
        return prev.map(ci =>
          ci === existing ? { ...ci, quantity: ci.quantity + itemQuantity } : ci
        );
      }

      return [...prev, {
        menuItem: itemDetail,
        quantity: itemQuantity,
        selectedModifiers: itemModifiers,
        notes: itemNotes,
      }];
    });

    setItemDetail(null);
    setItemQuantity(1);
    setItemModifiers([]);
    setItemNotes('');
  }, [itemDetail, itemQuantity, itemModifiers, itemNotes]);

  // Remove from cart
  const removeFromCart = useCallback((index: number) => {
    setCart(prev => prev.filter((_, i) => i !== index));
  }, []);

  // Update cart item quantity
  const updateQuantity = useCallback((index: number, quantity: number) => {
    setCart(prev => prev.map((ci, i) => i === index ? { ...ci, quantity } : ci));
  }, []);

  // Place order
  const placeOrder = useCallback(() => {
    if (cart.length === 0) {
      addToast({ type: 'warning', message: 'Agrega items al pedido', duration: 3000 });
      return;
    }

    // Create order via engine
    const order = orderEngine.createOrder({
      tableId: table.id,
      tableNumber: table.number,
      waiterId: 'mesero-1', // In production: actual logged-in user
      waiterName: 'Mesero', // In production: actual name
      guestCount: table.capacity,
    });

    // Add items to order
    cart.forEach(ci => {
      const modAdjustment = ci.selectedModifiers.reduce((s, m) => s + m.priceAdjustment, 0);
      const lineItem: OrderLineItem = {
        id: `li-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
        menuItemId: ci.menuItem.id,
        menuItemName: ci.menuItem.name,
        quantity: ci.quantity,
        unitPrice: ci.menuItem.price,
        modifiers: ci.selectedModifiers.map(m => ({
          groupName: ci.menuItem.modifierGroups.find(g => g.options.some(o => o.id === m.id))?.name || '',
          optionName: m.name,
          priceAdjustment: m.priceAdjustment,
        })),
        subtotal: (ci.menuItem.price + modAdjustment) * ci.quantity,
        status: 'pending',
        preparationNotes: ci.notes,
        createdAt: new Date().toISOString(),
      };
      orderEngine.addItem(order.id, lineItem);
    });

    // Confirm order (send to KDS)
    orderEngine.confirmOrder(order.id);

    // Update table status
    tableEngine.assignOrder(table.id, order.id);

    // Get final order
    const placedOrder = orderEngine.getOrder(order.id);
    if (placedOrder) {
      onOrderPlaced(placedOrder);
    }
  }, [cart, table, addToast, onOrderPlaced]);

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
          {filteredItems.map(item => (
            <button
              key={item.id}
              className="order-panel__item"
              onClick={() => setItemDetail(item)}
            >
              <div className="order-panel__item-info">
                <span className="order-panel__item-name">{item.name}</span>
                <span className="order-panel__item-price">
                  Bs. {item.price.toFixed(2)}
                </span>
              </div>
              {item.modifierGroups.length > 0 && (
                <span className="order-panel__item-mods-hint">
                  {item.modifierGroups.map(g => g.name).join(' · ')}
                </span>
              )}
              {item.tags.length > 0 && (
                <div className="order-panel__item-tags">
                  {item.tags.map(tag => (
                    <Badge key={tag} variant="info">{tag}</Badge>
                  ))}
                </div>
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
            const modAdjustment = ci.selectedModifiers.reduce((s, m) => s + m.priceAdjustment, 0);
            const lineTotal = (ci.menuItem.price + modAdjustment) * ci.quantity;

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
                {ci.notes && (
                  <div className="order-panel__cart-item-notes">{ci.notes}</div>
                )}
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

          {/* Cart total */}
          {cart.length > 0 && (
            <div className="order-panel__cart-total">
              <span>Total</span>
              <span className="order-panel__cart-total-amount">
                Bs. {cartTotal.toFixed(2)}
              </span>
            </div>
          )}

          {/* Actions */}
          <div className="order-panel__actions">
            <Button variant="secondary" onClick={onBack}>
              Cancelar
            </Button>
            <Button
              variant="primary"
              onClick={placeOrder}
              disabled={cart.length === 0}
              fullWidth
            >
              Confirmar Pedido
            </Button>
          </div>
        </div>
      </div>

      {/* Item detail modal */}
      <Modal
        open={!!itemDetail}
        onClose={() => { setItemDetail(null); setItemQuantity(1); setItemModifiers([]); setItemNotes(''); }}
        title={itemDetail?.name || ''}
      >
        {itemDetail && (
          <div className="order-panel__detail">
            <p className="order-panel__detail-desc">{itemDetail.description}</p>
            <p className="order-panel__detail-price">
              Bs. {itemDetail.price.toFixed(2)}
            </p>

            {/* Modifiers */}
            {itemDetail.modifierGroups.map(group => (
              <div key={group.id} className="order-panel__detail-mod-group">
                <label className="order-panel__detail-mod-label">
                  {group.name}
                  {group.required && <span className="text-muted"> (requerido)</span>}
                </label>
                <div className="order-panel__detail-mod-options">
                  {group.options.map(opt => {
                    const selected = itemModifiers.some(m => m.id === opt.id);
                    return (
                      <button
                        key={opt.id}
                        className={`order-panel__detail-mod-option ${selected ? 'active' : ''}`}
                        onClick={() => {
                          if (group.type === 'select') {
                            // Single selection
                            setItemModifiers(prev => [
                              ...prev.filter(m => !group.options.some(o => o.id === m.id)),
                              opt,
                            ]);
                          } else if (group.type === 'multi') {
                            // Toggle
                            setItemModifiers(prev =>
                              selected
                                ? prev.filter(m => m.id !== opt.id)
                                : [...prev, opt]
                            );
                          } else {
                            // Toggle (simple on/off)
                            setItemModifiers(prev =>
                              selected
                                ? prev.filter(m => m.id !== opt.id)
                                : [...prev, opt]
                            );
                          }
                        }}
                      >
                        {opt.name}
                        {opt.priceAdjustment !== 0 && (
                          <span className="order-panel__detail-mod-price">
                            {opt.priceAdjustment > 0 ? '+' : ''}Bs. {opt.priceAdjustment.toFixed(2)}
                          </span>
                        )}
                        {(opt.isDefault && itemModifiers.length === 0) && (
                          <span className="order-panel__detail-mod-default">Default</span>
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
                Agregar (Bs. {(itemDetail.price * itemQuantity).toFixed(2)})
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
