/**
 * Promos data-driven (DB) server-side — FASE 3 (2026-08-31)
 *
 * resolvePromoUnitPrice / validatePromoContext deben reconocer un promoType
 * que sea el id de una promo creada en el panel Admin (tabla promos):
 *   - item elegible: el menu_item matchea una línea de la promo
 *     (item_id directo o group_id = categoría del item)
 *   - precio: reparto proporcional del price_total entre TODAS las unidades
 *     del pack (unitPrice = price_total / totalUnits) — el pack completo
 *     siempre suma price_total (2x1, combos, packs).
 *   - contexto: max_per_order (packs por pedido) + líneas del pack presentes.
 *
 * El flujo SSOT (promos fijas por día laboral) NO cambia.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resolvePromoUnitPrice, validatePromoContext } from '../../server/services/order-pricing.js';

const activeDbMock = vi.hoisted(() => ({ fn: vi.fn() }));

vi.mock('../../server/services/promos-service.js', () => ({
  activePromosForBusinessDay: (...args) => activeDbMock.fn(...args),
  promoLineMatchesItem: (line, menuItem) =>
    !!((line.item_id && line.item_id === menuItem.id) ||
       (line.group_id && line.group_id === menuItem.category_id)),
}));

const DB_PROMO_2x1 = {
  id: 'promo-abc',
  name: '2x1 Quesadillas',
  label: '2x1 Quesadillas',
  description: 'Dos pizzas al precio de una',
  price_mode: 'FIXED',
  price_value: 5000,
  price_total: 5000,
  max_per_order: 1,
  lines: [{ item_id: null, group_id: 'pizzas', quantity: 2 }],
};

const DB_PROMO_COMBO = {
  id: 'promo-combo',
  name: 'Combo Pizza + Michelada',
  label: 'Combo',
  description: 'Una pizza + una michelada',
  price_mode: 'FIXED',
  price_value: 6000,
  price_total: 6000,
  max_per_order: 1,
  lines: [{ group_id: 'pizzas', quantity: 1 }, { group_id: 'micheladas', quantity: 1 }],
};

function mockDb(categoryName) {
  return {
    prepare() {
      return { get() { return { name: categoryName }; } };
    },
  };
}

const PIZZA_ITEM = { id: 'q1', category_id: 'pizzas' };
const MICHELADA_ITEM = { id: 'm1', category_id: 'micheladas' };
const DAY = '2026-09-05'; // sábado

describe('resolvePromoUnitPrice — promos data-driven (DB)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('reconoce un promoType de la DB activa y factura el reparto por unidad (2x1 → 2500)', () => {
    activeDbMock.fn.mockReturnValue([DB_PROMO_2x1]);
    const r = resolvePromoUnitPrice(mockDb('Pizzas'), PIZZA_ITEM, 'promo-abc', { businessDay: DAY });
    expect(r.error).toBeNull();
    expect(r.unitPrice).toBe(2500); // 5000 / 2 unidades del pack
    expect(r.promoLabel).toBe('PROMO - 2x1 Quesadillas');
  });

  it('combo con 2 líneas: reparte el price_total entre ambas (3000 + 3000)', () => {
    activeDbMock.fn.mockReturnValue([DB_PROMO_COMBO]);
    const a = resolvePromoUnitPrice(mockDb('Pizzas'), PIZZA_ITEM, 'promo-combo', { businessDay: DAY });
    const b = resolvePromoUnitPrice(mockDb('Micheladas Especiales'), MICHELADA_ITEM, 'promo-combo', { businessDay: DAY });
    expect(a.error).toBeNull();
    expect(b.error).toBeNull();
    expect(a.unitPrice).toBe(3000);
    expect(b.unitPrice).toBe(3000);
    expect(a.unitPrice + b.unitPrice).toBe(6000);
  });

  it('promo de DB inactiva el día (no está en activas) → INVALID_PROMO_TYPE', () => {
    activeDbMock.fn.mockReturnValue([]);
    const r = resolvePromoUnitPrice(mockDb('Pizzas'), PIZZA_ITEM, 'promo-abc', { businessDay: DAY });
    expect(r.error?.code).toBe('INVALID_PROMO_TYPE');
    expect(r.unitPrice).toBeNull();
  });

  it('item que no matchea ninguna línea de la promo → PROMO_ITEM_NOT_ELIGIBLE', () => {
    activeDbMock.fn.mockReturnValue([DB_PROMO_2x1]);
    const r = resolvePromoUnitPrice(mockDb('Micheladas Especiales'), MICHELADA_ITEM, 'promo-abc', { businessDay: DAY });
    expect(r.error?.code).toBe('PROMO_ITEM_NOT_ELIGIBLE');
  });

  it('línea por item_id directo también matchea', () => {
    activeDbMock.fn.mockReturnValue([{
      id: 'promo-item', name: 'Pizza del día', label: 'Pizza del día',
      price_mode: 'FIXED', price_value: 3500, price_total: 3500, max_per_order: 1,
      lines: [{ item_id: 'q1', quantity: 1 }],
    }]);
    const r = resolvePromoUnitPrice(mockDb('Pizzas'), PIZZA_ITEM, 'promo-item', { businessDay: DAY });
    expect(r.error).toBeNull();
    expect(r.unitPrice).toBe(3500);
  });
});

describe('validatePromoContext — promos data-driven (DB)', () => {
  beforeEach(() => vi.clearAllMocks());

  const line = (categoryId, promoType = null, quantity = 1, itemId = null) =>
    ({ categoryName: 'Pizzas', categoryId, promoType, quantity, itemId });

  it('respeta max_per_order: 1 pack (2 unidades promo) ok, 3 unidades → violation', () => {
    activeDbMock.fn.mockReturnValue([DB_PROMO_2x1]);
    const ok = validatePromoContext(
      [line('pizzas'), line('pizzas', 'promo-abc', 2)],
      'promo-abc', DAY
    );
    expect(ok.valid).toBe(true);

    const bad = validatePromoContext(
      [line('pizzas'), line('pizzas', 'promo-abc', 3)],
      'promo-abc', DAY
    );
    expect(bad.valid).toBe(false);
    expect(bad.code).toBe('PROMO_CONTEXT_VIOLATION');
  });

  it('líneas del pack presentes: falta una unidad del pack → violation', () => {
    activeDbMock.fn.mockReturnValue([DB_PROMO_2x1]);
    const r = validatePromoContext(
      [line('pizzas', 'promo-abc', 1)], // solo 1 unidad del pack (necesita 2)
      'promo-abc', DAY
    );
    expect(r.valid).toBe(false);
    expect(r.code).toBe('PROMO_CONTEXT_VIOLATION');
  });

  it('sin businessDay o promo desconocida → no opina (el route rechaza antes)', () => {
    activeDbMock.fn.mockReturnValue([DB_PROMO_2x1]);
    expect(validatePromoContext([line('pizzas', 'promo-abc', 2)], 'promo-abc', DAY).valid).toBe(true);
    activeDbMock.fn.mockReturnValue([]);
    expect(validatePromoContext([line('pizzas', 'promo-abc', 2)], 'promo-abc', DAY).valid).toBe(true);
  });
});