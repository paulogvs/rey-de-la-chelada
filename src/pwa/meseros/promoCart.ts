/**
 * ═══════════════════════════════════════════════════════════
 *  promoCart — helper PURA del carrito del mesero (promos data-driven)
 *
 *  v16 (2026-09-01): el SSOT (src/core/config/promotions.js) quedó ELIMINADO.
 *  Las promos viven en la DB (GET /api/promotions) y llegan al carrito con
 *  promoType = promo.id (UUID). El server SIEMPRE re-valida al facturar
 *  (nunca confía en el cliente). Aquí solo se resuelve el precio de DISPLAY
 *  y el ahorro. Funciones 100% puras (testeables sin React).
 * ═══════════════════════════════════════════════════════════
 */

import type { DbPromoLike } from './promosData';
import { resolvePromoUnitPrice as dbResolvePromoUnitPrice } from './promosData';

/** Forma mínima de un item del carrito (duck typing — el CartItem real del
 *  OrderPanel tiene más campos: manualPrice, applyPromo, modifiers…). */
export interface PromoCartItem {
  menuItem: {
    id: string;
    category_id: string;
    category_name?: string | null;
    name: string;
    price: number | null;
  };
  quantity: number;
  promoType?: string | null;
  /** Precio unitario de display ya resuelto al aplicar la promo (DB). */
  promoUnitPrice?: number;
}

/**
 * Precio unitario resuelto de una línea del carrito con promo (display):
 *   - con promoType → resolver con la promo de la DB (modelo A/B)
 *   - sin promoType → precio base del item
 *   - promo no encontrada en activas → null (el server rechazaría la línea)
 */
export function resolveCartPromoUnitPrice(
  item: PromoCartItem,
  activePromos: DbPromoLike[],
): number | null {
  if (item.promoType) {
    const promo = activePromos.find(p => p.id === item.promoType);
    if (!promo) return item.promoUnitPrice ?? null;
    return dbResolvePromoUnitPrice(promo, item.menuItem);
  }
  return item.menuItem.price ?? null;
}

/** Total del carrito con precios de promo aplicados */
export function cartPromoTotal(cart: PromoCartItem[], activePromos: DbPromoLike[]): number {
  return cart.reduce((sum, i) => sum + (resolveCartPromoUnitPrice(i, activePromos) ?? 0) * i.quantity, 0);
}

/**
 * Preview de ahorro: total sin promos vs total con promos.
 * @returns {{ originalTotal, promoTotal, savings }}
 */
export function cartSavings(cart: PromoCartItem[], activePromos: DbPromoLike[]) {
  const originalTotal = cart.reduce((s, i) => s + (i.menuItem.price ?? 0) * i.quantity, 0);
  const promoTotal = cartPromoTotal(cart, activePromos);
  return {
    originalTotal,
    promoTotal,
    savings: Math.max(0, originalTotal - promoTotal),
  };
}

export default {
  resolveCartPromoUnitPrice,
  cartPromoTotal,
  cartSavings,
};
