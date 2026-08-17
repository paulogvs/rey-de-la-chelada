/**
 * filterMenuItems — Buscador de menú (Sprint 1 C, meseros).
 *
 * Funciones puras y testables: match parcial, case-insensitive, sin acentos.
 * Orden por relevancia: prefijo de nombre > contiene nombre > subtítulo/
 * descripción/categoría. Query vacía → devuelve todos (sin reordenar).
 */

/** Normaliza texto para búsqueda: minúsculas + sin acentos + trim. */
export function normalizeSearchText(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

export interface SearchableMenuItem {
  name: string;
  subtitle?: string | null;
  description?: string;
  categoryName?: string;
}

/**
 * Filtra items de menú por query con orden de relevancia:
 *  4 = nombre EMPIEZA con la query
 *  3 = nombre CONTIENE la query
 *  1 = subtitle/description/categoryName contienen la query
 *  0 = sin match (se excluye)
 */
export function filterMenuItems<T extends SearchableMenuItem>(items: T[], query: string): T[] {
  const q = normalizeSearchText(query);
  if (!q) return items;

  const score = (it: T): number => {
    const name = normalizeSearchText(it.name);
    if (name.startsWith(q)) return 4;
    if (name.includes(q)) return 3;
    const haystack = [it.subtitle, it.description, it.categoryName]
      .filter(Boolean)
      .map(field => String(field))
      .join(' ');
    return normalizeSearchText(haystack).includes(q) ? 1 : 0;
  };

  return items.filter(it => score(it) > 0).sort((a, b) => score(b) - score(a));
}

export default filterMenuItems;
