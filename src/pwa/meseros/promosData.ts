/**
 * promosData — helpers puros de las promos data-driven para la UI del mesero
 * (v16 2026-09-01).
 *
 * El OrderPanel usa estas funciones para:
 *   - saber si un item del carrito matchea una línea de la promo de la DB
 *   - resolver el precio unitario de DISPLAY (modelo A/B — MISMA regla que el
 *     server order-pricing.js, así el carrito muestra lo que el server facturará)
 *   - clasificar la promo: de grupo (tiene lines con group_id → modal selector)
 *     vs de item (lines con item_id → directo al pedido)
 *   - resolver qué grupos/items de la promo hay que ofrecer en el modal
 */

export interface PromoLineLike {
  item_id?: string | null;
  group_id?: string | null;
  quantity?: number;
  extra_id?: string | null;
  extra_price?: number | null;
}

export interface DbPromoLike {
  id: string;
  name?: string;
  label: string;
  description?: string;
  price_mode?: 'FIXED' | 'MENU_PLUS' | string;
  price_value?: number;
  price_total?: number;
  max_per_order?: number;
  lines?: PromoLineLike[];
}

export interface MenuItemLike {
  id: string;
  category_id: string;
  price?: number | null;
  name?: string;
}

/**
 * ¿El item del carrito matchea una línea de la promo de la DB?
 * Matchea por item_id directo o por group_id (= categoría del item).
 */
export function matchesPromoLine(menuItem: MenuItemLike, line: PromoLineLike): boolean {
  return !!(
    (line.item_id && line.item_id === menuItem.id) ||
    (line.group_id && line.group_id === menuItem.category_id)
  );
}

/** ¿La promo se aplica a GRUPOS (modal selector) o a items específicos? */
export function isGroupPromo(promo: DbPromoLike): boolean {
  return !!(promo.lines || []).some(l => l.group_id && !l.item_id);
}

/** ¿La promo es de un item específico (se aplica directo, sin modal)? */
export function isItemPromo(promo: DbPromoLike): boolean {
  return !!(promo.lines || []).some(l => l.item_id) && !isGroupPromo(promo);
}

/** IDs de grupos (categorías) que la promo cubre (para el modal selector). */
export function promoGroupIds(promo: DbPromoLike): string[] {
  return (promo.lines || [])
    .filter(l => l.group_id && !l.item_id)
    .map(l => l.group_id as string);
}

/** IDs de items específicos que la promo cubre (sin modal). */
export function promoItemIds(promo: DbPromoLike): string[] {
  return (promo.lines || [])
    .filter(l => l.item_id)
    .map(l => l.item_id as string);
}

/**
 * Extra de la línea de la promo que matchea el item (para sub-línea KDS).
 * Devuelve null si la línea no trae extra.
 */
export function promoExtraFor(menuItem: MenuItemLike, promo: DbPromoLike): PromoLineLike | null {
  const line = (promo.lines || []).find(l => matchesPromoLine(menuItem, l));
  return line && line.extra_id ? line : null;
}

/**
 * Precio unitario de DISPLAY de un item bajo la promo (modelo A/B).
 * MISMA regla que el server order-pricing.resolvePromoUnitPrice:
 *   - FIXED     → price_value / totalUnits (split del pack)
 *   - MENU_PLUS → menu.price + price_value; si la línea es única con
 *                 quantity>1 (2x1) → (menú+ajuste)/quantity (1ª paga, resto gratis)
 */
export function resolvePromoUnitPrice(promo: DbPromoLike, menuItem: MenuItemLike): number {
  if (!promo) return 0;
  const lines = promo.lines || [];
  const line = lines.find(l => matchesPromoLine(menuItem, l));
  if (!line) return Number(menuItem.price) || 0; // no matchea → precio del menú

  const totalUnits = Math.max(1, lines.reduce((s, l) => s + (l.quantity || 1), 0));
  const menuPrice = Number(menuItem.price) || 0;
  const value = Number(promo.price_value ?? promo.price_total ?? 0) || 0;

  if (promo.price_mode === 'MENU_PLUS') {
    const base = menuPrice + value;
    if (lines.length === 1 && (lines[0].quantity || 1) > 1) {
      return Math.round(base / (lines[0].quantity || 1));
    }
    return Math.round(base);
  }
  // FIXED
  return Math.round(value / totalUnits);
}

/** Normaliza promos a la forma que espera PromosCollapsible. */
export function normalizePromosForCollapsible(
  promos: DbPromoLike[],
): { id: string; label: string; description: string }[] {
  return (promos || []).map(p => ({
    id: p.id,
    label: p.label || p.id,
    description: p.description || '',
  }));
}

export default {
  matchesPromoLine,
  isGroupPromo,
  isItemPromo,
  promoGroupIds,
  promoItemIds,
  promoExtraFor,
  resolvePromoUnitPrice,
  normalizePromosForCollapsible,
};
