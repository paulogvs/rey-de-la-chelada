/**
 * useMenu — React hook for fetching menu data from the server API.
 *
 * Replaces the in-memory `menuEngine.getCategories() / getItems()`
 * calls in MenuPage with a real HTTP fetch from `/api/menu/*`.
 *
 * Strategy:
 *  - Mount → fetch categories + items in parallel
 *  - Cache result in component state for the session lifetime
 *  - On error → return empty arrays + error message (UI can retry)
 *  - `refresh()` → re-fetch on demand (e.g. after admin edits)
 *
 * The pure API function (`fetchMenuFromApi`) is extracted so it
 * can be unit-tested without a DOM.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { fetchMenuFromApi } from './menuApi';

const EMPTY_MENU = { categories: [], items: [], error: null };

/**
 * @returns {{
 *   categories: Array<object>,
 *   items: Array<object>,
 *   loading: boolean,
 *   error: string | null,
 *   refresh: () => Promise<void>
 * }}
 */
export function useMenu() {
  const [categories, setCategories] = useState([]);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const mountedRef = useRef(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const result = await fetchMenuFromApi();
    if (!mountedRef.current) return;

    setCategories(result.categories);
    setItems(result.items);
    setError(result.error);
    setLoading(false);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    load();
    return () => { mountedRef.current = false; };
  }, [load]);

  return { categories, items, loading, error, refresh: load };
}

export { EMPTY_MENU };
export default useMenu;
