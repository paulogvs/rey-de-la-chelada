import { useCallback } from 'react';
import { Modal } from '@/ui/components/Modal';
import { Button } from '@/ui/components/Button';
import { Card } from '@/ui/components/Card';
import { QuantityStepper } from '@/ui/components/QuantityStepper';
import { AppIcon } from '@/ui/components/AppIcon/AppIcon';
import { formatMoney } from '../../_shared/utils/format';
import { PROMOTIONS_BY_ID } from '@/core/config/promotions.js';
import { resolveCartPromoUnitPrice, type PromoCartItem } from '../promoCart';
import type { CartItem } from '../OrderPanel';
import './CartModal.css';

function resolveCartUnitPrice(
  menuItem: CartItem['menuItem'],
  manualPrice: number | undefined,
  applyPromo: boolean | undefined,
  modAdjustment: number,
): number | null {
  if (applyPromo && menuItem.promo_price != null) return menuItem.promo_price;
  if (menuItem.price != null) return menuItem.price + modAdjustment;
  if (manualPrice != null && manualPrice > 0) return manualPrice + modAdjustment;
  if (modAdjustment > 0) return modAdjustment;
  return null;
}

export interface CartModalProps {
  open: boolean;
  onClose: () => void;
  cart: CartItem[];
  onUpdateQuantity: (index: number, quantity: number) => void;
  onRemove: (index: number) => void;
  onNotesChange: (index: number, notes: string) => void;
  cartTotal: number;
  savings: { savings: number; originalTotal: number; promoTotal?: number };
  onConfirm: () => void;
  submitting: boolean;
  businessDay: string;
  businessDayNameLabel: string;
  activePromos: { id: string; label: string; description: string }[];
  onApplyPromo: (promoId: string) => void;
  onClearPromo: (promoId: string) => void;
}

export function CartModal({
  open,
  onClose,
  cart,
  onUpdateQuantity,
  onRemove,
  onNotesChange,
  cartTotal,
  savings,
  onConfirm,
  submitting,
  businessDay,
  businessDayNameLabel,
  activePromos,
  onApplyPromo,
  onClearPromo,
}: CartModalProps) {
  const handleNotes = useCallback(
    (idx: number, value: string) => onNotesChange(idx, value),
    [onNotesChange],
  );

  const totalQty = cart.reduce((s, ci) => s + ci.quantity, 0);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Pedido actual · ${totalQty} unidades`}
      className="cart-modal"
      footer={
        <div className="cart-modal__footer">
          <Button variant="secondary" onClick={onClose} disabled={submitting}>
            Cancelar
          </Button>
          <Button variant="primary" onClick={onConfirm} disabled={cart.length === 0 || submitting} loading={submitting} fullWidth>
            {submitting ? 'Enviando…' : 'Confirmar y Enviar'}
          </Button>
        </div>
      }
    >
      <div className="cart-modal__body">
        <div className="cart-modal__scroll" style={{ overscrollBehavior: 'contain' as const }}>
          {activePromos.length > 0 && (
            <div className="order-panel__promos">
              <p className="order-panel__promos-title">Promos de hoy ({businessDayNameLabel})</p>
              {activePromos.map(promo => {
                const applied = cart.some(ci => ci.promoType === promo.id);
                return (
                  <button
                    key={promo.id}
                    className={`order-panel__promo-btn${applied ? ' order-panel__promo-btn--applied' : ''}`}
                    onClick={() => (applied ? onClearPromo(promo.id) : onApplyPromo(promo.id))}
                    title={promo.description}
                    type="button"
                  >
                    <span className="order-panel__promo-btn-name">{promo.label}</span>
                    <span className="order-panel__promo-btn-desc">{promo.description}</span>
                    <span className="order-panel__promo-btn-action">{applied ? 'Quitar' : 'Aplicar'}</span>
                  </button>
                );
              })}
              {savings.savings > 0 && (
                <p className="order-panel__promos-savings">Ahorro aplicado: <strong>{formatMoney(savings.savings)}</strong></p>
              )}
            </div>
          )}

          <section className="cart-modal__items" aria-label="Items del pedido">
            <h3 className="cart-modal__items-title">Items del pedido</h3>
            {cart.length === 0 ? (
              <p className="order-panel__cart-empty">Selecciona items del menú para agregar al pedido</p>
            ) : (
              cart.map((ci, index) => {
              const modAdj = ci.selectedModifiers.reduce((s, m) => s + (m.priceAdjustment ?? 0), 0);
              const unit = ci.promoType
                ? (resolveCartPromoUnitPrice(ci as PromoCartItem, businessDay) ?? 0)
                : (resolveCartUnitPrice(ci.menuItem, ci.manualPrice, ci.applyPromo, modAdj) ?? 0);
              const lineTotal = unit * ci.quantity;
              const promoLabel = ci.promoType ? PROMOTIONS_BY_ID[ci.promoType]?.label : null;
              return (
                <Card key={index} padded={false} className="order-panel__cart-item cart-modal__item">
                  <div className="order-panel__cart-item-line">
                    <span className="order-panel__cart-item-name">
                      {ci.menuItem.name}
                      {ci.promoType && (
                        <span className="order-panel__item-badge order-panel__item-badge--promo">{promoLabel || ci.promoType}</span>
                      )}
                      {ci.applyPromo && (
                        <span className="order-panel__item-badge order-panel__item-badge--promo">Promo</span>
                      )}
                      {ci.manualPrice != null && (
                        <span className="order-panel__item-badge order-panel__item-badge--manual">{formatMoney(ci.manualPrice)}</span>
                      )}
                    </span>
                    <span className="order-panel__cart-item-total">{formatMoney(lineTotal)}</span>
                  </div>
                  <span className="order-panel__cart-item-math">
                    {ci.promoType && unit === 0 ? 'GRATIS' : ci.quantity > 1 ? `${ci.quantity} × ${formatMoney(unit)}` : formatMoney(unit)}
                  </span>
                  {ci.promoType && (
                    <button className="order-panel__cart-item-unpromo" onClick={() => onClearPromo(ci.promoType!)} type="button">
                      Quitar promo
                    </button>
                  )}
                  {ci.selectedModifiers.length > 0 && (
                    <div className="order-panel__cart-item-mods">
                      {ci.selectedModifiers.map(m => (
                        <span key={m.id} className="order-panel__cart-item-mod">
                          + {m.name}{m.priceAdjustment ? ` (${formatMoney(m.priceAdjustment)})` : ''}
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="cart-modal__notes">
                    <label className="cart-modal__notes-label" htmlFor={`cart-notes-${index}`}>Notas</label>
                    <textarea
                      id={`cart-notes-${index}`}
                      className="order-panel__detail-textarea cart-modal__textarea"
                      value={ci.notes}
                      onChange={e => handleNotes(index, e.target.value)}
                      placeholder="Ej: sin hielo, bien cocido..."
                      rows={2}
                    />
                  </div>
                  <div className="order-panel__cart-item-footer">
                    <QuantityStepper value={ci.quantity} min={1} max={50} onChange={q => onUpdateQuantity(index, q)} size="md" />
                    <button
                      className="order-panel__cart-item-remove"
                      onClick={() => onRemove(index)}
                      aria-label={`Quitar ${ci.menuItem.name}`}
                      title="Quitar item"
                      type="button"
                    >
                      <AppIcon name="trash" size="sm" />
                    </button>
                  </div>
                </Card>
              );
              })
            )}
          </section>

          {cart.length > 0 && (
            <div className="order-panel__cart-total">
              <span>Total</span>
              <span className="order-panel__cart-total-amount">
                {savings.savings > 0 && (
                  <span className="order-panel__cart-total-original">{formatMoney(savings.originalTotal)}</span>
                )}
                {formatMoney(cartTotal)}
              </span>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}

export default CartModal;
