/**
 * Staff API — admin module (pure, injectable fetch)
 *
 * TDD: tests written before implementation.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  fetchAdminMenuItems,
  updateMenuItemPrice,
  fetchModifierOptions,
  updateModifierOptionPrice,
  fetchStaff,
  updateStaff,
  fetchClosings,
  type ModifierOptionRow,
} from '../../src/pwa/_shared/api/adminApi';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('fetchAdminMenuItems', () => {
  it('fetches with include_inactive and returns items', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      success: true,
      items: [{ id: 'i1', name: 'Chelada', category_id: 'c1', category_name: 'Cervezas', price: null, is_active: 1, is_available: 1, area: 'bar' }],
    }));
    const result = await fetchAdminMenuItems('tok', {}, fetchMock as unknown as typeof fetch);
    expect(result.ok).toBe(true);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].price).toBeNull();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('include_inactive=true');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok');
  });

  it('adds search + category query params', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ success: true, items: [] }));
    await fetchAdminMenuItems('tok', { search: 'chela', categoryId: 'c1' }, fetchMock as unknown as typeof fetch);
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toContain('search=chela');
    expect(url).toContain('category_id=c1');
  });

  it('returns empty list on failure', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ success: false }, 500));
    const result = await fetchAdminMenuItems('tok', {}, fetchMock as unknown as typeof fetch);
    expect(result.ok).toBe(false);
    expect(result.items).toEqual([]);
  });
});

describe('updateMenuItemPrice', () => {
  it('PATCHes the price with auth header', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ success: true, item: { id: 'i1', price: 25 } }));
    const result = await updateMenuItemPrice('tok', 'i1', 25, fetchMock as unknown as typeof fetch);
    expect(result.ok).toBe(true);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body as string)).toEqual({ price: 25 });
  });
});

describe('modifier options', () => {
  const option: ModifierOptionRow = {
    id: 'mo1', name: 'Familiar', price_adjustment: 0, is_default: 0, sort_order: 1,
    group_id: 'g1', group_name: 'Tamaño', menu_item_id: 'mi1', menu_item_name: 'Hawaiana',
  };

  it('fetchModifierOptions returns options', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ success: true, options: [option] }));
    const result = await fetchModifierOptions('tok', fetchMock as unknown as typeof fetch);
    expect(result.ok).toBe(true);
    expect(result.options).toHaveLength(1);
    expect(result.options[0].menu_item_name).toBe('Hawaiana');
  });

  it('updateModifierOptionPrice sends priceAdjustment', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ success: true, option: { id: 'mo1', price_adjustment: 35 } }));
    const result = await updateModifierOptionPrice('tok', 'mo1', 35, fetchMock as unknown as typeof fetch);
    expect(result.ok).toBe(true);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ priceAdjustment: 35 });
  });
});

describe('staff', () => {
  it('fetchStaff returns staff rows', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      success: true,
      staff: [{ id: 's1', role: 'admin', display_name: 'Admin', is_active: 1, current_shift: null }],
    }));
    const result = await fetchStaff('tok', fetchMock as unknown as typeof fetch);
    expect(result.ok).toBe(true);
    expect(result.staff).toHaveLength(1);
    expect(result.staff[0].role).toBe('admin');
  });

  it('updateStaff sends pin', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ success: true, staff: { id: 's1', role: 'mesero', display_name: 'M', is_active: 1, current_shift: null } }));
    const result = await updateStaff('tok', 's1', { pin: '9999' }, fetchMock as unknown as typeof fetch);
    expect(result.ok).toBe(true);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body as string)).toEqual({ pin: '9999' });
  });
});

describe('fetchClosings', () => {
  it('returns closing history rows', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      success: true,
      closings: [{ id: 'c1', closing_date: '2026-08-01', opened_at: 'x', closed_at: 'y', opened_by_name: 'A', closed_by_name: 'B', expected_cash: 100, actual_cash: 95, cash_difference: -5, is_reconciled: 0, notes: '' }],
    }));
    const result = await fetchClosings('tok', fetchMock as unknown as typeof fetch);
    expect(result.ok).toBe(true);
    expect(result.closings).toHaveLength(1);
    expect(result.closings[0].cash_difference).toBe(-5);
  });
});
