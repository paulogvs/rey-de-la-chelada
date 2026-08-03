/**
 * menuApi — Pure functions for fetching menu data from the server.
 *
 * Extracted from useMenu so the network + parsing logic can be
 * unit-tested without React or a DOM.
 *
 * Convention:
 *  - Returns { categories, items, error }
 *  - On network failure OR non-2xx → error populated, arrays empty
 *  - On successful but empty menu → error = 'Menú no disponible'
 *  - Never throws to the caller
 */

const CATEGORIES_URL = '/api/menu/categories';
const ITEMS_URL = '/api/menu/items';

/**
 * @param {typeof fetch} [fetchImpl] — injectable for tests
 * @returns {Promise<{ categories: Array<object>, items: Array<object>, error: string | null }>}
 */
export async function fetchMenuFromApi(fetchImpl = fetch) {
  try {
    const [catRes, itemsRes] = await Promise.all([
      fetchImpl(CATEGORIES_URL, { headers: { Accept: 'application/json' } }),
      fetchImpl(`${ITEMS_URL}?include_modifiers=true&available=true`, { headers: { Accept: 'application/json' } }),
    ]);

    if (!catRes.ok) throw new Error(`Categorías: HTTP ${catRes.status}`);
    if (!itemsRes.ok) throw new Error(`Items: HTTP ${itemsRes.status}`);

    const [catData, itemsData] = await Promise.all([catRes.json(), itemsRes.json()]);

    const categories = (catData.success && Array.isArray(catData.categories))
      ? catData.categories
      : [];
    const items = (itemsData.success && Array.isArray(itemsData.items))
      ? itemsData.items
      : [];

    if (categories.length === 0 && items.length === 0) {
      return { categories, items, error: 'Menú no disponible' };
    }

    return { categories, items, error: null };
  } catch (err) {
    console.error('[menuApi] Fetch error:', err.message);
    return { categories: [], items: [], error: 'Error al cargar el menú' };
  }
}

export { CATEGORIES_URL, ITEMS_URL };
