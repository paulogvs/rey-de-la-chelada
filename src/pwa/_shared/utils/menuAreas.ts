/**
 * menuAreas — Agrupación de categorías por área (Barra / Cocina / Promos).
 *
 * S2-Tabs (2026-08-17): el panel de meseros pasa de una barra plana de
 * categorías a un sistema de 2 niveles (tabs de área → chips de categoría).
 *
 * El `area` vive en `menu_items` (bar|cocina), NO en `menu_categories`
 * (la tabla no tiene columna `area`). Por eso se INFIERE del primer item
 * de cada categoría (más limpio que migrar el schema o tocar el server):
 *   - "Promociones" (nombre, case-insensitive) → tab Promos.
 *   - primer item area='cocina' → tab Cocina.
 *   - el resto → tab Barra.
 *
 * Funciones puras y testables (sin React, sin fetch). Tipos mínimos
 * estructurales para no acoplar al shape completo del API.
 */

export type AreaTab = 'barra' | 'cocina' | 'promos';

/** Mínimo necesario de una categoría. */
export interface CategoryLike {
  id: string;
  name: string;
}

/** Mínimo necesario de un item de menú. */
export interface ItemLike {
  category_id: string;
  area: 'bar' | 'cocina' | null;
}

/** Nombre SSOT de la categoría de promociones (display, no facturable). */
export const PROMOS_CATEGORY_NAME = 'Promociones';

/** ¿Esta categoría es el tab "Promos"? (nombre exacto, sin acentos/case). */
export function isPromosCategory(categoryName: string): boolean {
  return categoryName.trim().toLowerCase() === PROMOS_CATEGORY_NAME.toLowerCase();
}

/**
 * Área (tab) de una categoría. Inferida del primer item de la categoría.
 * Una categoría sin items cae en 'barra' (default razonable: la mayoría
 * de categorías del menú son de barra y todas las activas tienen items).
 */
export function areaForCategory(
  categoryId: string,
  categoryName: string,
  items: ItemLike[],
): AreaTab {
  if (isPromosCategory(categoryName)) return 'promos';
  const item = items.find((i) => i.category_id === categoryId);
  return item && item.area === 'cocina' ? 'cocina' : 'barra';
}

/** Agrupa categorías en un mapa por tab: { barra, cocina, promos }. */
export function groupCategoriesByArea<T extends CategoryLike>(
  categories: T[],
  items: ItemLike[],
): Record<AreaTab, T[]> {
  const result: Record<AreaTab, T[]> = { barra: [], cocina: [], promos: [] };
  for (const cat of categories) {
    result[areaForCategory(cat.id, cat.name, items)].push(cat);
  }
  return result;
}

/** Devuelve solo las categorías del tab indicado (preserva el orden original). */
export function getCategoriesForArea<T extends CategoryLike>(
  categories: T[],
  items: ItemLike[],
  area: AreaTab,
): T[] {
  return categories.filter((c) => areaForCategory(c.id, c.name, items) === area);
}
