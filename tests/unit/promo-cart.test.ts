/**
 * Unit — promoCart.ts (src/pwa/meseros/promoCart.ts)
 *
 * Helper PURA del carrito del mesero para promos data-driven (v16).
 * Resuelve el precio unitario de DISPLAY (modelo A/B) y el ahorro. El
 * server SIEMPRE re-valida al facturar (nunca confía en el cliente).
 */

import { describe, it, expect } from 'vitest';
import {
  resolveCartPromoUnitPrice,
  cartPromoTotal,
  cartSavings,
} from '../../src/pwa/meseros/promoCart.js';

const sig = (over = {}) => ({
  id: 'sig-1',
  name: 'Isla Dorada',
  category_id: 'cat-sig',
  category_name: 'Micheladas Especiales',
  price: 4000,
  ...over,
});

const art = (over = {}) => ({
  id: 'art-1',
  name: 'Negra',
  category_id: 'cat-art',
  category_name: 'Cerveza Artesanal',
  price: 1500,
  ...over,
});

const item = (menuItem, quantity = 1, promoType = null, promoUnitPrice = undefined) => ({
  menuItem, quantity, promoType, promoUnitPrice,
});

describe('resolveCartPromoUnitPrice — modelo A/B (display)', () => {
  const promos = [
    { id: 'promo-fixed', label: 'Cheladas + limón', price_mode: 'FIXED', price_value: 1500, lines: [{ group_id: 'cat-sig', quantity: 1 }] },
    { id: 'promo-menu', label: 'Menú +1', price_mode: 'MENU_PLUS', price_value: 100, lines: [{ group_id: 'cat-sig', quantity: 1 }] },
    { id: 'promo-2x1', label: '2x1', price_mode: 'MENU_PLUS', price_value: 0, lines: [{ group_id: 'cat-sig', quantity: 2 }] },
  ];

  it('FIXED → price_value; MENU_PLUS → menu + ajuste; 2x1 → menú/2', () => {
    expect(resolveCartPromoUnitPrice(item(sig(), 1, 'promo-fixed'), promos)).toBe(1500);
    expect(resolveCartPromoUnitPrice(item(sig(), 1, 'promo-menu'), promos)).toBe(4100);
    expect(resolveCartPromoUnitPrice(item(sig(), 1, 'promo-2x1'), promos)).toBe(2000);
  });

  it('sin promo → precio base del item', () => {
    expect(resolveCartPromoUnitPrice(item(sig()), promos)).toBe(4000);
  });

  it('promo no encontrada en activas → usa promoUnitPrice guardado | null', () => {
    expect(resolveCartPromoUnitPrice(item(sig(), 1, 'nope', 500), promos)).toBe(500);
    expect(resolveCartPromoUnitPrice(item(sig(), 1, 'nope'), promos)).toBeNull();
  });
});

describe('cartSavings — preview del ahorro', () => {
  const promos = [
    { id: 'promo-fixed', label: 'Cheladas + limón', price_mode: 'FIXED', price_value: 1500, lines: [{ group_id: 'cat-sig', quantity: 1 }] },
  ];

  it('aplica la promo → ahorro = precio base - promo', () => {
    const cart = [item(sig()), item(sig({ id: 'sig-2' }), 1, 'promo-fixed')];
    const s = cartSavings(cart, promos);
    expect(s.originalTotal).toBe(8000);
    expect(s.promoTotal).toBe(5500); // 4000 (sin promo) + 1500 (promo)
    expect(s.savings).toBe(2500);
  });

  it('sin promos → savings 0', () => {
    const s = cartSavings([item(sig()), item(art())], promos);
    expect(s.savings).toBe(0);
    expect(s.originalTotal).toBe(s.promoTotal);
  });
});
