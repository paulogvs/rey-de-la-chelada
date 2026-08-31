/**
 * promosData — helpers puros de las promos data-driven para la UI del mesero
 * (v15 FASE 3 2026-08-31).
 *
 * El OrderPanel usa estas funciones para:
 *   - saber si un item del carrito matchea una línea de la promo de la DB
 *   - resolver el precio unitario de DISPLAY (reparto proporcional del
 *     price_total — MISMA regla que el server order-pricing.js, así el
 *     carrito muestra lo que el server facturará)
 *   - normalizar el array del GET /api/promotions a la forma que espera
 *     PromosCollapsible ({ id, label, description })
 */

export interface PromoLineLike {
  item_id?: string | null;
  group_id?: string | null;
  quantity?: number;
}

export interface DbPromoLike {
  id: string;
  label: string;
  description?: string;
  price_total?: number;
  max_per_order?: number;
  lines?: PromoLineLike[];
}

export interface MenuItemLike {
  id: string;
  category_id: string;
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

/**
 * Precio unitario por unidad del item cuando la promo DB matchea: reparto
 * proporcional del price_total entre TODAS las unidades del pack.
 *   - 2x1 (2 unidades)        → price_total / 2  (par = price_total)
 *   - combo 2 líneas (1 c/u)  → price_total / 2  (par = price_total)
 *   - item único (1 unidad)   → price_total
 *
 * `_menuItem` queda reservado: el reparto actual no depende del item (el
 * precio por unidad es price_total / totalUnits), pero la firma mantiene el
 * item por si en el futuro se reparte por línea distinta.
 */
export function dbPromoUnitPrice(promo: DbPromoLike, _menuItem: MenuItemLike): number | null {
  if (!promo.lines || promo.lines.length === 0) return 0;
  const totalUnits = Math.max(1, promo.lines.reduce((s, l) => s + (l.quantity || 1), 0));
  return Math.round((promo.price_total || 0) / totalUnits);
}

/** Normaliza promos (DB + SSOT) a la forma que espera PromosCollapsible. */
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
  dbPromoUnitPrice,
  normalizePromosForCollapsible,
};