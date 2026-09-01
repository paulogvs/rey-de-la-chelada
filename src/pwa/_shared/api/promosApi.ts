/**
 * promosApi — Cliente de promos y extras data-driven (v15 2026-08-29).
 *
 * Promos: modelo único "set de líneas (items/grupos + extras) + precio total".
 * Extras: por grupo del menú (category_extras).
 */

import { apiFetch, type ApiResult } from './apiFetch';

export interface PromoLine {
  item_id?: string | null;
  group_id?: string | null;
  quantity?: number;
  extra_id?: string | null;
  extra_price?: number | null;
}

export interface PromoSchedule {
  day_of_week?: number | null;
  start_date?: string | null;
  end_date?: string | null;
}

export interface Promo {
  id: string;
  name: string;
  label: string;
  description?: string;
  price_total: number;
  price_mode?: 'FIXED' | 'MENU_PLUS' | string;
  price_value?: number;
  max_per_order?: number;
  active: number;
  lines: PromoLine[];
  schedule: PromoSchedule[];
}

export interface Extra {
  id: string;
  category_id: string;
  name: string;
  price: number;
  active: number;
  sort_order?: number;
}

// ── Promos ──────────────────────────────────────────────────────────────

export async function fetchAdminPromos(token: string): Promise<ApiResult<{ promos: Promo[] }>> {
  return apiFetch<{ success: boolean; promos?: Promo[] }>('/api/promotions/admin', { token }) as Promise<ApiResult<{ promos: Promo[] }>>;
}

export async function createAdminPromo(token: string, data: Partial<Promo>): Promise<ApiResult<{ promo: Promo }>> {
  return apiFetch<{ success: boolean; promo?: Promo }>('/api/promotions/admin', { method: 'POST', token, body: data }) as Promise<ApiResult<{ promo: Promo }>>;
}

export async function updateAdminPromo(token: string, id: string, data: Partial<Promo>): Promise<ApiResult<{ promo: Promo }>> {
  return apiFetch<{ success: boolean; promo?: Promo }>(`/api/promotions/admin/${id}`, { method: 'PUT', token, body: data }) as Promise<ApiResult<{ promo: Promo }>>;
}

export async function toggleAdminPromo(token: string, id: string, active: boolean): Promise<ApiResult<{ success: boolean }>> {
  return apiFetch<{ success: boolean }>(`/api/promotions/admin/${id}/toggle`, { method: 'PATCH', token, body: { active } });
}

export async function deleteAdminPromo(token: string, id: string): Promise<ApiResult<{ success: boolean }>> {
  return apiFetch<{ success: boolean }>(`/api/promotions/admin/${id}`, { method: 'DELETE', token });
}

// ── Extras ──────────────────────────────────────────────────────────────

export async function fetchCategoryExtras(token: string, categoryId: string): Promise<ApiResult<{ extras: Extra[] }>> {
  return apiFetch<{ success: boolean; extras?: Extra[] }>(`/api/extras/${categoryId}`, { token }) as Promise<ApiResult<{ extras: Extra[] }>>;
}

export async function createExtra(token: string, categoryId: string, data: Partial<Extra>): Promise<ApiResult<{ extra: Extra }>> {
  return apiFetch<{ success: boolean; extra?: Extra }>(`/api/extras/${categoryId}`, { method: 'POST', token, body: data }) as Promise<ApiResult<{ extra: Extra }>>;
}

export async function updateExtra(token: string, id: string, data: Partial<Extra>): Promise<ApiResult<{ extra: Extra }>> {
  return apiFetch<{ success: boolean; extra?: Extra }>(`/api/extras/${id}`, { method: 'PUT', token, body: data }) as Promise<ApiResult<{ extra: Extra }>>;
}

export async function deleteExtra(token: string, id: string): Promise<ApiResult<{ success: boolean }>> {
  return apiFetch<{ success: boolean }>(`/api/extras/${id}`, { method: 'DELETE', token });
}

export default {
  fetchAdminPromos,
  createAdminPromo,
  updateAdminPromo,
  toggleAdminPromo,
  deleteAdminPromo,
  fetchCategoryExtras,
  createExtra,
  updateExtra,
  deleteExtra,
};