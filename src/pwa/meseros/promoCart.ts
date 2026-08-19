/**
 * ═══════════════════════════════════════════════════════════
 *  promoCart — helper PURA del carrito del mesero (promos por día laboral)
 *
 *  Sprint Promos 2026-08-19. Espejo CLIENTE de las reglas del server
 *  (server/services/order-pricing.js): la UI usa esto para saber qué
 *  promos se pueden aplicar, marcar líneas y previsualizar el ahorro.
 *  El server SIEMPRE re-valida al facturar (nunca confía en el cliente).
 *
 *  Importa la config SSOT (promotions.js) — misma fuente de verdad que
 *  el server. Funciones 100% puras (testeables sin React).
 * ═══════════════════════════════════════════════════════════
 */

import {
  PROMOTIONS_BY_ID,
  isPromotionActiveForDay,
  promoUnitPrice,
  SIGNATURE_CATEGORY,
  ARTESANAL_CATEGORY,
} from '../../core/config/promotions.js';

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
}

/** Items de la categoría objetivo que AÚN no tienen promo */
function eligibleOf(cart: PromoCartItem[], categoryName: string) {
  return cart.filter(i => !i.promoType && i.menuItem.category_name === categoryName);
}

/** Unidades (pagadas sin promo) de una categoría en el carrito */
function paidUnits(cart: PromoCartItem[], categoryName: string) {
  return eligibleOf(cart, categoryName).reduce((s, i) => s + i.quantity, 0);
}

/** Unidades ya marcadas con un tipo de promo */
function promoUnits(cart: PromoCartItem[], promoType: string) {
  return cart.filter(i => i.promoType === promoType).reduce((s, i) => s + i.quantity, 0);
}

/**
 * ¿Se puede aplicar la promo `promoId` al carrito HOY?
 * @returns {ok:true} | {ok:false, reason:string} — reason = código del server
 *          (PROMO_NOT_ACTIVE) o texto legible para el toast de la UI.
 */
export function canApplyPromo(cart: PromoCartItem[], promoId: string, businessDay: string): { ok: boolean; reason?: string } {
  const promo = PROMOTIONS_BY_ID[promoId];
  if (!promo) return { ok: false, reason: 'Promo desconocida' };
  if (promo.promoType === 'MODIFIER') {
    return { ok: false, reason: `${promo.name} es un adicional del item (se agrega al abrir la bebida)` };
  }
  if (!isPromotionActiveForDay(promoId, businessDay)) {
    return { ok: false, reason: 'PROMO_NOT_ACTIVE' };
  }
  switch (promo.promoType) {
    case 'BOGO': {
      const paid = paidUnits(cart, promo.categoryName);
      if (paid < 1) return { ok: false, reason: 'Agrega al menos una Michelada Signature pagada al carrito' };
      if (promoUnits(cart, promoId) >= paid) return { ok: false, reason: 'Cada Signature gratis necesita su pareja pagada' };
      return { ok: true };
    }
    case 'PRICE_OVERRIDE': {
      if (promo.oncePerOrder && promoUnits(cart, promoId) >= 1) {
        return { ok: false, reason: `${promo.name} solo se aplica una vez por pedido` };
      }
      const paid = paidUnits(cart, promo.categoryName);
      if (paid < 1) return { ok: false, reason: `Agrega ${promo.categoryName} al carrito para aplicar ${promo.label}` };
      return { ok: true };
    }
    case 'COMBO': {
      const sig = paidUnits(cart, SIGNATURE_CATEGORY);
      const art = paidUnits(cart, ARTESANAL_CATEGORY);
      if (sig < 1 || art < 1) return { ok: false, reason: 'El combo necesita 1 Michelada Signature + 1 Cerveza Artesanal en el carrito' };
      return { ok: true };
    }
    default:
      return { ok: false, reason: 'Promo no aplicable como línea' };
  }
}

/**
 * Aplica la promo marcando la(s) línea(s) correspondiente(s).
 * Devuelve un NUEVO array (inmutable). Si la regla falla → carrito intacto.
 * Genérica: preserva el tipo exacto del carrito del llamador.
 */
export function applyPromoToCart<T extends PromoCartItem>(cart: T[], promoId: string, businessDay: string): T[] {
  if (!canApplyPromo(cart, promoId, businessDay).ok) return cart;
  const promo = PROMOTIONS_BY_ID[promoId];

  if (promo.promoType === 'COMBO') {
    const next = [...cart];
    let sigMarked = false;
    let artMarked = false;
    return next.map(i => {
      if (!i.promoType && i.menuItem.category_name === SIGNATURE_CATEGORY && !sigMarked) {
        sigMarked = true;
        return { ...i, promoType: promoId };
      }
      if (!i.promoType && i.menuItem.category_name === ARTESANAL_CATEGORY && !artMarked) {
        artMarked = true;
        return { ...i, promoType: promoId };
      }
      return i;
    });
  }

  // BOGO / PRICE_OVERRIDE: marca la PRIMERA línea elegible sin promo
  // (una por click — para 2x1 el mesero marca un par a la vez)
  const target = promo.categoryName;
  let marked = false;
  return cart.map(i => {
    if (!marked && !i.promoType && i.menuItem.category_name === target) {
      marked = true;
      return { ...i, promoType: promoId };
    }
    return i;
  });
}

/** Quita la promo del carrito (solo líneas de ese tipo) — inmutable */
export function clearPromoFromCart<T extends PromoCartItem>(cart: T[], promoId: string): T[] {
  return cart.map(i => (i.promoType === promoId ? { ...i, promoType: null } : i));
}

/**
 * Precio unitario resuelto de una línea del carrito (espejo del server):
 *   - con promoType → precio de la promo (0 2x1, 12 barra, 25 pv, 30/15 combo)
 *   - sin promoType → precio base del item
 *   - promoType con día no activo → null (el server rechazaría la línea)
 */
export function resolveCartPromoUnitPrice(item: PromoCartItem, businessDay: string): number | null {
  if (item.promoType) {
    const promo = PROMOTIONS_BY_ID[item.promoType];
    if (!promo) return null;
    if (!isPromotionActiveForDay(item.promoType, businessDay)) return null;
    return promoUnitPrice(promo, item.menuItem.category_name ?? null);
  }
  return item.menuItem.price ?? null;
}

/** Total del carrito con precios de promo aplicados */
export function cartPromoTotal(cart: PromoCartItem[], businessDay: string): number {
  return cart.reduce((sum, i) => sum + (resolveCartPromoUnitPrice(i, businessDay) ?? 0) * i.quantity, 0);
}

/**
 * Preview de ahorro: total sin promos vs total con promos.
 * @returns {{ originalTotal, promoTotal, savings }}
 */
export function cartSavings(cart: PromoCartItem[], businessDay: string) {
  const originalTotal = cart.reduce((s, i) => s + (i.menuItem.price ?? 0) * i.quantity, 0);
  const promoTotal = cartPromoTotal(cart, businessDay);
  return {
    originalTotal,
    promoTotal,
    savings: Math.max(0, originalTotal - promoTotal),
  };
}

/** Índices del carrito que tienen cada promo (para badges en el cart) */
export function promoIndexByType(cart: PromoCartItem[]): Record<string, number[]> {
  const idx: Record<string, number[]> = {};
  cart.forEach((i, n) => {
    if (i.promoType) {
      (idx[i.promoType] ||= []).push(n);
    }
  });
  return idx;
}

export default {
  canApplyPromo,
  applyPromoToCart,
  clearPromoFromCart,
  resolveCartPromoUnitPrice,
  cartPromoTotal,
  cartSavings,
  promoIndexByType,
};