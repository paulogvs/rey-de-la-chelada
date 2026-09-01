/**
 * promosData — helpers puros de las promos data-driven para la UI del mesero
 * (v16 2026-09-01). Modelo A/B de precio + clasificación grupo/item + extra.
 */

import { describe, it, expect } from 'vitest';
import {
  matchesPromoLine,
  isGroupPromo,
  isItemPromo,
  promoGroupIds,
  promoItemIds,
  promoExtraFor,
  resolvePromoUnitPrice,
  normalizePromosForCollapsible,
} from '../../src/pwa/meseros/promosData.js';

const pizza = { id: 'q1', category_id: 'pizzas', price: 5000 };
const michelada = { id: 'm1', category_id: 'micheladas', price: 4000 };

describe('matchesPromoLine — item vs línea de la promo', () => {
  it('matchea por group_id (categoría del item)', () => {
    expect(matchesPromoLine(pizza, { group_id: 'pizzas', quantity: 2 })).toBe(true);
    expect(matchesPromoLine(michelada, { group_id: 'pizzas', quantity: 2 })).toBe(false);
  });

  it('matchea por item_id directo', () => {
    expect(matchesPromoLine(pizza, { item_id: 'q1', quantity: 1 })).toBe(true);
    expect(matchesPromoLine(michelada, { item_id: 'q1', quantity: 1 })).toBe(false);
  });

  it('sin item_id ni group_id → no matchea', () => {
    expect(matchesPromoLine(pizza, { quantity: 1 })).toBe(false);
  });
});

describe('resolvePromoUnitPrice — modelo A/B (display)', () => {
  it('FIXED item único → price_value (1 unidad)', () => {
    const promo = { id: 'p', label: 'Cheladas + limón', price_mode: 'FIXED', price_value: 1500, lines: [{ group_id: 'micheladas', quantity: 1 }] };
    expect(resolvePromoUnitPrice(promo, michelada)).toBe(1500);
  });

  it('FIXED combo (2 líneas) → reparte el total (3000 + 3000)', () => {
    const promo = {
      id: 'p', label: 'Combo', price_mode: 'FIXED', price_value: 6000,
      lines: [{ group_id: 'pizzas', quantity: 1 }, { group_id: 'micheladas', quantity: 1 }],
    };
    expect(resolvePromoUnitPrice(promo, pizza)).toBe(3000);
    expect(resolvePromoUnitPrice(promo, michelada)).toBe(3000);
  });

  it('MENU_PLUS item único → menu.price + ajuste (4000 + 100 = 4100)', () => {
    const promo = { id: 'p', label: 'Menú +1', price_mode: 'MENU_PLUS', price_value: 100, lines: [{ group_id: 'micheladas', quantity: 1 }] };
    expect(resolvePromoUnitPrice(promo, michelada)).toBe(4100);
  });

  it('MENU_PLUS línea única quantity=2 (2x1) → 1ª unidad paga, resto gratis (4000/2 = 2000)', () => {
    const promo = { id: 'p', label: '2x1', price_mode: 'MENU_PLUS', price_value: 0, lines: [{ group_id: 'micheladas', quantity: 2 }] };
    expect(resolvePromoUnitPrice(promo, michelada)).toBe(2000);
  });
});

describe('clasificación grupo vs item', () => {
  it('isGroupPromo / promoGroupIds', () => {
    const promo = { id: 'p', label: 'G', price_mode: 'FIXED', price_value: 1000, lines: [{ group_id: 'micheladas', quantity: 1 }] };
    expect(isGroupPromo(promo)).toBe(true);
    expect(isItemPromo(promo)).toBe(false);
    expect(promoGroupIds(promo)).toEqual(['micheladas']);
    expect(promoItemIds(promo)).toEqual([]);
  });

  it('isItemPromo / promoItemIds', () => {
    const promo = { id: 'p', label: 'I', price_mode: 'FIXED', price_value: 1000, lines: [{ item_id: 'q1', quantity: 1 }] };
    expect(isItemPromo(promo)).toBe(true);
    expect(isGroupPromo(promo)).toBe(false);
    expect(promoItemIds(promo)).toEqual(['q1']);
  });

  it('promoExtraFor devuelve la línea con extra si el item matchea', () => {
    const promo = { id: 'p', label: 'Shot', price_mode: 'MENU_PLUS', price_value: 0, lines: [{ group_id: 'micheladas', quantity: 1, extra_id: 'e1', extra_price: 0 }] };
    expect(promoExtraFor(michelada, promo)?.extra_id).toBe('e1');
  });
});

describe('normalizePromosForCollapsible — forma { id, label, description }', () => {
  it('normaliza promos a la forma de PromosCollapsible', () => {
    const norm = normalizePromosForCollapsible([
      { id: 'promo-db-1', label: '2x1 Quesadillas', description: 'Dos pizzas' },
    ]);
    expect(norm).toEqual([{ id: 'promo-db-1', label: '2x1 Quesadillas', description: 'Dos pizzas' }]);
  });

  it('label ausente → usa el id; description ausente → cadena vacía', () => {
    const norm = normalizePromosForCollapsible([{ id: 'x', label: '', description: undefined }]);
    expect(norm[0].label).toBe('x');
    expect(norm[0].description).toBe('');
  });
});
