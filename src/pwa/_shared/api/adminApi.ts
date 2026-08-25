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

export interface BulkPriceResult extends ApiResult<{ updated?: number; failed?: number }> {
  updated: number;
  failed: number;
  errors: Array<{ id: string; reason: string }>;
}

/** POST /api/menu/items/bulk-prices — returns per-item results */
export async function bulkUpdateItemPrices(
  token: string,
  updates: Array<{ id: string; price: number }>,
  fetchImpl: typeof fetch = fetch
): Promise<BulkPriceResult> {
  const result = await apiFetch<{
    success: boolean;
    updated?: number;
    failed?: number;
    errors?: Array<{ id: string; reason: string }>;
  }>('/api/menu/items/bulk-prices', { method: 'POST', token, body: { updates }, fetchImpl });

  if (!result.ok || !result.data) {
    return { ...result, data: null, updated: 0, failed: 0, errors: [] } as BulkPriceResult;
  }
  return {
    ...result,
    updated: result.data.updated ?? 0,
    failed: result.data.failed ?? 0,
    errors: result.data.errors ?? [],
  };
}

// ============================================================
// Modifier options (pizza sizes, etc)
// ============================================================

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

/** POST /api/menu/modifier-options/bulk-prices */
export async function bulkUpdateModifierPrices(
  token: string,
  updates: Array<{ id: string; priceAdjustment: number }>,
  fetchImpl: typeof fetch = fetch
): Promise<BulkPriceResult> {
  const result = await apiFetch<{
    success: boolean;
    updated?: number;
    failed?: number;
    errors?: Array<{ id: string; reason: string }>;
  }>('/api/menu/modifier-options/bulk-prices', {
    method: 'POST',
    token,
    body: { updates },
    fetchImpl,
  });

  if (!result.ok || !result.data) {
    return { ...result, data: null, updated: 0, failed: 0, errors: [] } as BulkPriceResult;
  }
  return {
    ...result,
    updated: result.data.updated ?? 0,
    failed: result.data.failed ?? 0,
    errors: result.data.errors ?? [],
  };
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

export default {
  fetchAdminMenuItems,
  updateMenuItemPrice,
  bulkUpdateItemPrices,
  fetchModifierOptions,
  updateModifierOptionPrice,
  bulkUpdateModifierPrices,
  fetchStaff,
  updateStaff,
  fetchClosings,
};
