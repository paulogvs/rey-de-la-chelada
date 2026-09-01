/**
 * Unit — Promos server-side: resolvePromoUnitPrice (modelo A/B, v16)
 * (server/services/order-pricing.js)
 *
 * Contrato (aprobado con el dueño):
 *   - FIXED     → price_value = total del pack (se reparte entre unidades)
 *   - MENU_PLUS → precio de línea = menu_item.price + price_value; línea
 *                 única con quantity>1 (2x1) → 1ª unidad paga, resto gratis.
 *   - El server valida día laboral + item elegible + inyecta el EXTRA de la
 *     línea como sub-línea (promoExtra) para el KDS.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resolvePromoUnitPrice } from '../../server/services/order-pricing.js';

const activeDbMock = vi.hoisted(() => ({ fn: vi.fn() }));

vi.mock('../../server/services/promos-service.js', () => ({
  activePromosForBusinessDay: (...args) => activeDbMock.fn(...args),
  promoLineMatchesItem: (line, menuItem) =>
    !!((line.item_id && line.item_id === menuItem.id) ||
       (line.group_id && line.group_id === menuItem.category_id)),
}));

/** db mock: resuelve nombre de categoría + category_extras por extra_id. */
function mockDb(categoryName, extras = {}) {
  return {
    prepare(sql) {
      if (sql.includes('menu_categories')) {
        return { get() { return { name: categoryName }; } };
      }
      if (sql.includes('category_extras')) {
        const extraId = (sql.match(/id = \?/) || [])[0] ? null : null;
        return { get(id) { return extras[id] || null; } };
      }
      return { get() { return null; } };
    },
  };
}

const MICHELADA_ITEM = { id: 'm1', category_id: 'cat-sig', price: 4000 }; // Isla Dorada
const DAY = '2026-09-05';

describe('resolvePromoUnitPrice — modelo A/B', () => {
  beforeEach(() => vi.clearAllMocks());

  it('FIXED item único → precio = price_value (1 unidad)', () => {
    activeDbMock.fn.mockReturnValue([{
      id: 'p1', name: 'Cheladas + extra limón', label: 'Cheladas + extra limón',
      price_mode: 'FIXED', price_value: 1500, price_total: 1500, lines: [{ group_id: 'cat-sig', quantity: 1 }],
    }]);
    const r = resolvePromoUnitPrice(mockDb('Micheladas Especiales'), MICHELADA_ITEM, 'p1', { businessDay: DAY });
    expect(r.error).toBeNull();
    expect(r.unitPrice).toBe(1500);
    expect(r.promoLabel).toBe('PROMO - Cheladas + extra limón');
  });

  it('FIXED combo (2 líneas) → reparte el total (3000 + 3000)', () => {
    activeDbMock.fn.mockReturnValue([{
      id: 'combo', name: 'Combo', label: 'Combo', price_mode: 'FIXED', price_value: 6000, price_total: 6000,
      lines: [{ group_id: 'cat-sig', quantity: 1 }, { group_id: 'cat-art', quantity: 1 }],
    }]);
    const a = resolvePromoUnitPrice(mockDb('Micheladas Especiales'), MICHELADA_ITEM, 'combo', { businessDay: DAY });
    expect(a.unitPrice).toBe(3000);
    expect(a.unitPrice + a.unitPrice).toBe(6000);
  });

  it('MENU_PLUS item único → menu.price + ajuste (4000 + 100 = 4100)', () => {
    activeDbMock.fn.mockReturnValue([{
      id: 'p2', name: 'Cheladas + extra limón a 1 bs', label: 'Cheladas + extra limón',
      price_mode: 'MENU_PLUS', price_value: 100, price_total: 100, lines: [{ group_id: 'cat-sig', quantity: 1 }],
    }]);
    const r = resolvePromoUnitPrice(mockDb('Micheladas Especiales'), MICHELADA_ITEM, 'p2', { businessDay: DAY });
    expect(r.error).toBeNull();
    expect(r.unitPrice).toBe(4100);
  });

  it('MENU_PLUS línea única quantity=2 (2x1) → 1ª unidad paga, resto gratis (4000/2 = 2000)', () => {
    activeDbMock.fn.mockReturnValue([{
      id: '2x1', name: 'Jueves de Chelada 2x1', label: '2x1',
      price_mode: 'MENU_PLUS', price_value: 0, price_total: 0,
      lines: [{ group_id: 'cat-sig', quantity: 2 }],
    }]);
    const r = resolvePromoUnitPrice(mockDb('Micheladas Especiales'), MICHELADA_ITEM, '2x1', { businessDay: DAY });
    expect(r.error).toBeNull();
    expect(r.unitPrice).toBe(2000); // pack de 2 → paga 1 (4000)
  });

  it('inyecta promoExtra (sub-línea KDS) cuando la línea trae extra_id', () => {
    activeDbMock.fn.mockReturnValue([{
      id: 'shot', name: 'Micheladas + Shot Gratis', label: 'Micheladas + Shot Gratis',
      price_mode: 'MENU_PLUS', price_value: 0, price_total: 0,
      lines: [{ group_id: 'cat-sig', quantity: 1, extra_id: 'extra-shot', extra_price: 0 }],
    }]);
    const r = resolvePromoUnitPrice(mockDb('Micheladas Especiales', { 'extra-shot': { id: 'extra-shot', name: 'Shot', price: 0 } }), MICHELADA_ITEM, 'shot', { businessDay: DAY });
    expect(r.error).toBeNull();
    expect(r.unitPrice).toBe(4000); // menú + ajuste 0
    expect(r.promoExtra).toEqual({ id: 'extra-shot', name: 'Shot', price: 0 });
  });

  it('promo inactiva (no está en activas) → INVALID_PROMO_TYPE', () => {
    activeDbMock.fn.mockReturnValue([]);
    const r = resolvePromoUnitPrice(mockDb('Micheladas Especiales'), MICHELADA_ITEM, 'p1', { businessDay: DAY });
    expect(r.error?.code).toBe('INVALID_PROMO_TYPE');
    expect(r.unitPrice).toBeNull();
  });

  it('item que no matchea ninguna línea → PROMO_ITEM_NOT_ELIGIBLE', () => {
    activeDbMock.fn.mockReturnValue([{
      id: 'p1', name: 'Solo cerveza', label: 'Solo cerveza', price_mode: 'FIXED', price_value: 1200,
      lines: [{ group_id: 'cat-art', quantity: 1 }],
    }]);
    const r = resolvePromoUnitPrice(mockDb('Micheladas Especiales'), MICHELADA_ITEM, 'p1', { businessDay: DAY });
    expect(r.error?.code).toBe('PROMO_ITEM_NOT_ELIGIBLE');
  });
});
