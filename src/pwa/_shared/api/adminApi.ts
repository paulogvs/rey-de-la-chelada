/**
 * Staff API — admin module (pure, injectable fetch)
 *
 * Covers the Admin PWA surfaces:
 *   - Menu price editing (single + bulk, items + modifier options)
 *   - Staff PIN management
 *   - Tables CRUD (list/create/delete)
 *   - Closings history (corte de caja)
 *
 * Every function returns a normalized ApiResult — never throws.
 */

import { apiFetch, type ApiResult } from './apiFetch';

// ============================================================
// Menu items (admin: include inactive, search)
// ============================================================

export interface AdminMenuItem {
  id: string;
  name: string;
  category_id: string;
  category_name: string;
  price: number | null;
  /** 1 = precio manual ("Consultar") — el mesero define el precio al momento */
  price_variable?: number | null;
  is_active: number;
  is_available: number;
  area: string | null;
}

export interface MenuItemsResult extends ApiResult<{ items?: AdminMenuItem[] }> {
  items: AdminMenuItem[];
}

/** GET /api/menu/items?include_inactive=true[&search=][&category_id=] */
export async function fetchAdminMenuItems(
  token: string,
  opts: { search?: string; categoryId?: string } = {},
  fetchImpl: typeof fetch = fetch
): Promise<MenuItemsResult> {
  const params = new URLSearchParams({ include_inactive: 'true' });
  if (opts.search) params.set('search', opts.search);
  if (opts.categoryId) params.set('category_id', opts.categoryId);

  const result = await apiFetch<{ success: boolean; items?: AdminMenuItem[] }>(
    `/api/menu/items?${params.toString()}`,
    { token, fetchImpl }
  );

  if (!result.ok || !result.data?.items) {
    return { ...result, data: null, items: [] } as MenuItemsResult;
  }
  return { ...result, items: result.data.items };
}

/** PATCH /api/menu/items/:id/price */
export async function updateMenuItemPrice(
  token: string,
  itemId: string,
  price: number,
  fetchImpl: typeof fetch = fetch
): Promise<ApiResult<{ item?: { id: string; price: number } }>> {
  return apiFetch<{ success: boolean; item?: { id: string; price: number } }>(
    `/api/menu/items/${itemId}/price`,
    { method: 'PATCH', token, body: { price }, fetchImpl }
  );
}

export interface ModifierOptionRow {
  id: string;
  name: string;
  price_adjustment: number;
  is_default: number;
  sort_order: number;
  group_id: string;
  group_name: string;
  menu_item_id: string;
  menu_item_name: string;
}

export interface ModifierOptionsResult extends ApiResult<{ options?: ModifierOptionRow[] }> {
  options: ModifierOptionRow[];
}

/** GET /api/menu/modifier-options — all options with item/group context */
export async function fetchModifierOptions(
  token: string,
  fetchImpl: typeof fetch = fetch
): Promise<ModifierOptionsResult> {
  const result = await apiFetch<{ success: boolean; options?: ModifierOptionRow[] }>(
    '/api/menu/modifier-options',
    { token, fetchImpl }
  );

  if (!result.ok || !result.data?.options) {
    return { ...result, data: null, options: [] } as ModifierOptionsResult;
  }
  return { ...result, options: result.data.options };
}

/** PATCH /api/menu/modifier-options/:id/price */
export async function updateModifierOptionPrice(
  token: string,
  optionId: string,
  priceAdjustment: number,
  fetchImpl: typeof fetch = fetch
): Promise<ApiResult<{ option?: { id: string; price_adjustment: number } }>> {
  return apiFetch<{ success: boolean; option?: { id: string; price_adjustment: number } }>(
    `/api/menu/modifier-options/${optionId}/price`,
    { method: 'PATCH', token, body: { priceAdjustment }, fetchImpl }
  );
}

// ============================================================
// Staff (roles + PIN management)
// ============================================================

export interface AdminStaff {
  id: string;
  role: 'admin' | 'mesero' | 'kds';
  display_name: string;
  is_active: number;
  current_shift: string | null;
}

export interface StaffListResult extends ApiResult<{ staff?: AdminStaff[] }> {
  staff: AdminStaff[];
}

/** GET /api/staff — list staff (admin) */
export async function fetchStaff(
  token: string,
  fetchImpl: typeof fetch = fetch
): Promise<StaffListResult> {
  const result = await apiFetch<{ success: boolean; staff?: AdminStaff[] }>('/api/staff', {
    token,
    fetchImpl,
  });

  if (!result.ok || !result.data?.staff) {
    return { ...result, data: null, staff: [] } as StaffListResult;
  }
  return { ...result, staff: result.data.staff };
}

/** PUT /api/staff/:id — update PIN and/or display name (admin) */
export async function updateStaff(
  token: string,
  staffId: string,
  payload: { pin?: string; display_name?: string },
  fetchImpl: typeof fetch = fetch
): Promise<ApiResult<{ staff?: AdminStaff }>> {
  return apiFetch<{ success: boolean; staff?: AdminStaff }>(`/api/staff/${staffId}`, {
    method: 'PUT',
    token,
    body: payload,
    fetchImpl,
  });
}

// ============================================================
// Closings history (corte de caja)
// ============================================================

export interface ClosingRow {
  id: string;
  closing_date: string;
  opened_at: string;
  closed_at: string;
  opened_by_name: string | null;
  closed_by_name: string | null;
  expected_cash: number;
  actual_cash: number;
  cash_difference: number;
  is_reconciled: number;
  notes: string;
  // v13 (2026-08-25): desglose completo del cierre
  opening_cash?: number;
  expenses_cash?: number;
  expenses_qr?: number;
  expected_qr?: number;
  total_general?: number;
  transactions?: number;
}

export interface ClosingsResult extends ApiResult<{ closings?: ClosingRow[] }> {
  closings: ClosingRow[];
}

/** GET /api/payments/closings — history of closed cash closings */
export async function fetchClosings(
  token: string,
  fetchImpl: typeof fetch = fetch
): Promise<ClosingsResult> {
  const result = await apiFetch<{ success: boolean; closings?: ClosingRow[] }>(
    '/api/payments/closings',
    { token, fetchImpl }
  );

  if (!result.ok || !result.data?.closings) {
    return { ...result, data: null, closings: [] } as ClosingsResult;
  }
  return { ...result, closings: result.data.closings };
}

// ============================================================
// Menu CRUD (admin) — items + categories + import-seed
// ============================================================

export interface MenuCategoryRow {
  id: string;
  name: string;
  description: string | null;
  emoji: string | null;
  sort_order: number;
  is_active: number;
  /** v17: área del grupo (Barra | Cocina) — la DB la guarda en menu_categories.area */
  area?: 'bar' | 'cocina' | null;
}

export interface MenuCategoryResult extends ApiResult<{ category?: MenuCategoryRow }> {
  category: MenuCategoryRow | null;
}

export interface MenuItemCreateInput {
  name: string;
  price: number | null;
  category_id: string;
  area?: 'bar' | 'cocina';
  is_available?: boolean;
  sort_order?: number;
  preparation_time?: number;
  subtitle?: string;
  description?: string;
}

export interface MenuItemUpdateInput {
  name?: string;
  price?: number | null;
  category_id?: string;
  area?: 'bar' | 'cocina';
  is_available?: boolean;
  is_active?: boolean;
  sort_order?: number;
  preparation_time?: number;
  subtitle?: string;
  description?: string;
}

export interface MenuCategoryInput {
  name: string;
  emoji?: string;
  description?: string;
  sort_order?: number;
  /** v17: área del grupo (Barra | Cocina) — se hereda a los items del grupo */
  area?: 'bar' | 'cocina';
}

/** POST /api/menu/items — crear item (admin) */
export async function createMenuItem(
  token: string,
  input: MenuItemCreateInput,
  fetchImpl: typeof fetch = fetch
): Promise<ApiResult<{ item?: AdminMenuItem }>> {
  return apiFetch<{ success: boolean; item?: AdminMenuItem }>('/api/menu/items', {
    method: 'POST',
    token,
    fetchImpl,
    body: input,
  });
}

/** PUT /api/menu/items/:id — actualizar item (admin) */
export async function updateMenuItem(
  token: string,
  id: string,
  input: MenuItemUpdateInput,
  fetchImpl: typeof fetch = fetch
): Promise<ApiResult<{ item?: AdminMenuItem }>> {
  return apiFetch<{ success: boolean; item?: AdminMenuItem }>(`/api/menu/items/${id}`, {
    method: 'PUT',
    token,
    fetchImpl,
    body: input,
  });
}

/** PATCH /api/menu/items/:id/toggle — activar/desactivar item */
export async function toggleMenuItem(
  token: string,
  id: string,
  fetchImpl: typeof fetch = fetch
): Promise<ApiResult<{ is_active?: boolean }>> {
  return apiFetch<{ success: boolean; is_active?: boolean }>(`/api/menu/items/${id}/toggle`, {
    method: 'PATCH',
    token,
    fetchImpl,
  });
}

/** DELETE /api/menu/items/:id — borrar item (solo sin pedidos) */
export async function deleteMenuItem(
  token: string,
  id: string,
  fetchImpl: typeof fetch = fetch
): Promise<ApiResult<{ deleted?: boolean }>> {
  return apiFetch<{ success: boolean; deleted?: boolean }>(`/api/menu/items/${id}`, {
    method: 'DELETE',
    token,
    fetchImpl,
  });
}

/** POST /api/menu/categories — crear categoría (admin) */
export async function createMenuCategory(
  token: string,
  input: MenuCategoryInput,
  fetchImpl: typeof fetch = fetch
): Promise<MenuCategoryResult> {
  const result = await apiFetch<{ success: boolean; category?: MenuCategoryRow }>('/api/menu/categories', {
    method: 'POST',
    token,
    fetchImpl,
    body: input,
  });
  return { ...result, category: result.data?.category ?? null };
}

/** PUT /api/menu/categories/:id — actualizar categoría (admin) */
export async function updateMenuCategory(
  token: string,
  id: string,
  input: Partial<MenuCategoryInput> & { is_active?: boolean },
  fetchImpl: typeof fetch = fetch
): Promise<MenuCategoryResult> {
  const result = await apiFetch<{ success: boolean; category?: MenuCategoryRow }>(`/api/menu/categories/${id}`, {
    method: 'PUT',
    token,
    fetchImpl,
    body: input,
  });
  return { ...result, category: result.data?.category ?? null };
}

/** DELETE /api/menu/categories/:id — borrar categoría (solo vacía) */
export async function deleteMenuCategory(
  token: string,
  id: string,
  fetchImpl: typeof fetch = fetch
): Promise<ApiResult<{ deleted?: boolean }>> {
  return apiFetch<{ success: boolean; deleted?: boolean }>(`/api/menu/categories/${id}`, {
    method: 'DELETE',
    token,
    fetchImpl,
  });
}

/** GET /api/menu/categories — listar categorías (incl. inactivas para admin) */
export async function fetchMenuCategoriesAdmin(
  token: string,
  fetchImpl: typeof fetch = fetch
): Promise<ApiResult<{ categories?: MenuCategoryRow[] }>> {
  return apiFetch<{ success: boolean; categories?: MenuCategoryRow[] }>(
    '/api/menu/categories?include_inactive=true',
    { token, fetchImpl }
  );
}

/** POST /api/menu/import-seed — importar items/categorías NUEVOS del seed (no pisa existentes) */
export async function importSeedItems(
  token: string,
  fetchImpl: typeof fetch = fetch
): Promise<ApiResult<{ createdItems?: string[]; createdCategories?: string[]; message?: string }>> {
  return apiFetch<{ success: boolean; message?: string; createdItems?: string[]; createdCategories?: string[] }>(
    '/api/menu/import-seed',
    { method: 'POST', token, fetchImpl }
  );
}

export default {
  fetchAdminMenuItems,
  updateMenuItemPrice,
  fetchModifierOptions,
  updateModifierOptionPrice,
  fetchStaff,
  updateStaff,
  fetchClosings,
  createMenuItem,
  updateMenuItem,
  toggleMenuItem,
  deleteMenuItem,
  createMenuCategory,
  updateMenuCategory,
  deleteMenuCategory,
  fetchMenuCategoriesAdmin,
  importSeedItems,
};
