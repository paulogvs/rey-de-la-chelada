/**
 * menuApi Tests
 *
 * TDD: Tests for the pure menu-fetching function. No React, no DOM.
 * Verifies:
 *  - fetches categories + items URLs
 *  - parses success: true responses into arrays
 *  - falls back to empty arrays when the response shape is wrong
 *  - surfaces "Menú no disponible" when both are empty
 *  - never throws on network failure or non-2xx
 */

import { describe, it, expect, vi } from 'vitest';
import { fetchMenuFromApi } from '../../src/pwa/clientes/hooks/menuApi';

function ok(body) {
  return {
    ok: true,
    status: 200,
    json: async () => body,
  };
}

function fail(status = 500) {
  return {
    ok: false,
    status,
    json: async () => ({ success: false }),
  };
}

describe('fetchMenuFromApi', () => {
  it('fetches both /api/menu/categories and /api/menu/items', async () => {
    const mock = vi.fn()
      .mockResolvedValueOnce(ok({ success: true, categories: [{ id: 'c1' }] }))
      .mockResolvedValueOnce(ok({ success: true, items: [{ id: 'i1' }] }));

    const result = await fetchMenuFromApi(mock);

    expect(mock).toHaveBeenCalledTimes(2);
    expect(mock).toHaveBeenCalledWith('/api/menu/categories', expect.objectContaining({
      headers: expect.objectContaining({ Accept: 'application/json' }),
    }));
    expect(mock).toHaveBeenCalledWith('/api/menu/items?include_modifiers=true&available=true', expect.any(Object));
    expect(result.categories).toEqual([{ id: 'c1' }]);
    expect(result.items).toEqual([{ id: 'i1' }]);
    expect(result.error).toBeNull();
  });

  it('returns "Menú no disponible" when both lists are empty', async () => {
    const mock = vi.fn()
      .mockResolvedValueOnce(ok({ success: true, categories: [] }))
      .mockResolvedValueOnce(ok({ success: true, items: [] }));

    const result = await fetchMenuFromApi(mock);

    expect(result.categories).toEqual([]);
    expect(result.items).toEqual([]);
    expect(result.error).toBe('Menú no disponible');
  });

  it('returns an error when categories fetch returns 500', async () => {
    const mock = vi.fn()
      .mockResolvedValueOnce(fail(500))
      .mockResolvedValueOnce(ok({ success: true, items: [] }));

    const result = await fetchMenuFromApi(mock);

    expect(result.error).toMatch(/Error al cargar/);
    expect(result.categories).toEqual([]);
  });

  it('returns an error when items fetch returns 500', async () => {
    const mock = vi.fn()
      .mockResolvedValueOnce(ok({ success: true, categories: [] }))
      .mockResolvedValueOnce(fail(500));

    const result = await fetchMenuFromApi(mock);

    expect(result.error).toMatch(/Error al cargar/);
  });

  it('handles network failure (fetch rejects) without throwing', async () => {
    const mock = vi.fn().mockRejectedValue(new Error('Network down'));
    const result = await fetchMenuFromApi(mock);
    expect(result.error).toMatch(/Error al cargar/);
    expect(result.categories).toEqual([]);
    expect(result.items).toEqual([]);
  });

  it('falls back to empty arrays when success is false on either response', async () => {
    const mock = vi.fn()
      .mockResolvedValueOnce(ok({ success: false, categories: null }))
      .mockResolvedValueOnce(ok({ success: true, items: [{ id: 'i1' }] }));

    const result = await fetchMenuFromApi(mock);

    expect(result.categories).toEqual([]);
    expect(result.items).toEqual([{ id: 'i1' }]);
    // items present → no "no disponible" message
    expect(result.error).toBeNull();
  });

  it('preserves item data shape (does not transform)', async () => {
    const richItem = {
      id: 'i1', name: 'La Rey', price: 50.5,
      category_id: 'c1', area: 'cocina', is_active: 1, is_available: 1,
    };
    const mock = vi.fn()
      .mockResolvedValueOnce(ok({ success: true, categories: [] }))
      .mockResolvedValueOnce(ok({ success: true, items: [richItem] }));

    const result = await fetchMenuFromApi(mock);
    expect(result.items[0]).toEqual(richItem);
  });
});
