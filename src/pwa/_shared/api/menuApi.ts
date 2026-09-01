/**
 * Staff API — menu module (pure, injectable fetch)
 *
 * GET /api/menu/categories → categories
 * GET /api/menu/items → items (no modifiers)
 * GET /api/menu/items/:id → item + modifiers
 */

import { apiFetch, type ApiResult } from './apiFetch';

export interface MenuCategory {
  id: string;
  name: string;
  description: string;
  emoji: string;
  sort_order: number;
  is_active: number;
  /** v17: área del grupo (Barra | Cocina) — la DB la guarda en menu_categories.area */
  area?: 'bar' | 'cocina' | null;
}

export interface MenuItem {
  id: string;
  name: string;
  subtitle: string | null;
  description: string;
  price: number | null;
  currency: string;
  iva_percentage: number;
  image_url: string | null;
  is_active: number;
  is_available: number;
  preparation_time: number;
  sort_order: number;
  area: 'bar' | 'cocina' | null;
  category_id: string;
  category_name: string;
  /** Sprint 1 (B): item de precio manual "Consultar precio" (price null + variable=1) */
  price_variable?: number | null;
  /** Sprint 1 (E): precio de promo manual (display items lo tienen, items regulares null) */
  promo_price?: number | null;
}

export interface ModifierOption {
  option_id: string;
  option_name: string;
  option_price: number;
  option_default: number;
}

export interface ModifierGroup {
  id: string;
  name: string;
  type: 'select' | 'multi' | 'toggle';
  required: number;
  min_select: number;
  max_select: number;
  options: ModifierOption[];
}

export interface MenuResult extends ApiResult<{ categories?: MenuCategory[] }> {
  categories: MenuCategory[];
}

export interface ItemsResult extends ApiResult<{ items?: MenuItem[] }> {
  items: MenuItem[];
}

export interface CategoryExtra {
  extra_id: string;
  extra_name: string;
  extra_price: number;
}

export interface ItemDetailResult extends ApiResult<{ item?: MenuItem; modifiers?: unknown[]; category_extras?: CategoryExtra[] }> {
  item: MenuItem | null;
  modifiers: ModifierGroup[];
  category_extras: CategoryExtra[];
}

export interface CreateItemPayload {
  category_id: string;
  name: string;
  description?: string;
  price?: number | null;
  area?: 'bar' | 'cocina';
  preparation_time?: number;
}

/** GET /api/menu/categories — active categories (public) */
export async function fetchMenuCategories(
  fetchImpl: typeof fetch = fetch
): Promise<MenuResult> {
  const result = await apiFetch<{ success: boolean; categories?: MenuCategory[] }>(
    '/api/menu/categories',
    { fetchImpl }
  );
  if (!result.ok || !result.data?.categories) {
    return { ...result, data: null, categories: [] } as MenuResult;
  }
  return { ...result, categories: result.data.categories };
}

/** GET /api/menu/items — active items (public) */
export async function fetchMenuItems(
  fetchImpl: typeof fetch = fetch
): Promise<ItemsResult> {
  const result = await apiFetch<{ success: boolean; items?: MenuItem[] }>(
    '/api/menu/items',
    { fetchImpl }
  );
  if (!result.ok || !result.data?.items) {
    return { ...result, data: null, items: [] } as ItemsResult;
  }
  return { ...result, items: result.data.items };
}

/** GET /api/menu/items/:id — item + modifiers (public) */
export async function fetchMenuItemDetail(
  itemId: string,
  fetchImpl: typeof fetch = fetch
): Promise<ItemDetailResult> {
  const result = await apiFetch<{
    success: boolean;
    item?: MenuItem;
    modifiers?: Array<Record<string, unknown>>;
    category_extras?: CategoryExtra[];
  }>(`/api/menu/items/${itemId}`, { fetchImpl });

  if (!result.ok || !result.data?.item) {
    return { ...result, data: null, item: null, modifiers: [], category_extras: [] } as ItemDetailResult;
  }

  // Group flat modifier rows by group
  const groups = new Map<string, ModifierGroup>();
  for (const row of result.data.modifiers ?? []) {
    const gid = String(row.id ?? '');
    if (!groups.has(gid)) {
      groups.set(gid, {
        id: gid,
        name: String(row.name ?? ''),
        type: (row.type as ModifierGroup['type']) || 'select',
        required: Number(row.required ?? 0),
        min_select: Number(row.min_select ?? 0),
        max_select: Number(row.max_select ?? 1),
        options: [],
      });
    }
    if (row.option_id != null) {
      groups.get(gid)!.options.push({
        option_id: String(row.option_id),
        option_name: String(row.option_name ?? ''),
        option_price: Number(row.option_price ?? 0),
        option_default: Number(row.option_default ?? 0),
      });
    }
  }

  return {
    ...result,
    item: result.data.item,
    modifiers: Array.from(groups.values()),
    category_extras: result.data.category_extras ?? [],
  };
}

/** POST /api/menu/items — create menu item (admin) */
export async function createMenuItem(
  token: string,
  payload: CreateItemPayload,
  fetchImpl: typeof fetch = fetch
): Promise<ApiResult<{ success: boolean; item?: MenuItem }>> {
  return apiFetch<{ success: boolean; item?: MenuItem }>('/api/menu/items', {
    method: 'POST',
    token,
    body: payload,
    fetchImpl,
  });
}

export default { fetchMenuCategories, fetchMenuItems, fetchMenuItemDetail, createMenuItem };
