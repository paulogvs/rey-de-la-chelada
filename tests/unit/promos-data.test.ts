/**
 * promosData — helpers puros de las promos data-driven para la UI del mesero
 * (FASE 3 2026-08-31).
 *
 * El OrderPanel usa estas funciones para:
 *   - saber si un item del carrito matchea una línea de la promo DB
 *   - resolver el precio unitario de display (reparto proporcional del
 *     price_total — MISMA regla que el server order-pricing.js)
 *   - normalizar el array del GET /api/promotions a la forma que espera
 *     PromosCollapsible ({ id, label, description })
 */

import { describe, it, expect } from 'vitest';
import {
  matchesPromoLine,
  dbPromoUnitPrice,
  normalizePromosForCollapsible,
} from '../../src/pwa/meseros/promosData.js';

const pizza = { id: 'q1', category_id: 'pizzas' };
const michelada = { id: 'm1', category_id: 'micheladas' };

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

describe('dbPromoUnitPrice — reparto proporcional del price_total', () => {
  it('2x1 (2 unidades del pack) → unit = price_total / 2', () => {
    const promo = { id: 'p', label: '2x1', price_total: 5000, lines: [{ group_id: 'pizzas', quantity: 2 }] };
    expect(dbPromoUnitPrice(promo, pizza)).toBe(2500);
  });

  it('combo 2 líneas (1 unidad c/u) → reparte 50/50', () => {
    const promo = {
      id: 'p', label: 'Combo', price_total: 6000,
      lines: [{ group_id: 'pizzas', quantity: 1 }, { group_id: 'micheladas', quantity: 1 }],
    };
    expect(dbPromoUnitPrice(promo, pizza)).toBe(3000);
    expect(dbPromoUnitPrice(promo, michelada)).toBe(3000);
  });

  it('item único (1 unidad) → unit = price_total', () => {
    const promo = { id: 'p', label: 'Pizza del día', price_total: 3500, lines: [{ item_id: 'q1', quantity: 1 }] };
    expect(dbPromoUnitPrice(promo, pizza)).toBe(3500);
  });

  it('promo sin líneas → no rompe (0)', () => {
    expect(dbPromoUnitPrice({ id: 'p', label: 'x', price_total: 1000, lines: [] }, pizza)).toBe(0);
  });
});

describe('normalizePromosForCollapsible — forma { id, label, description }', () => {
  it('normaliza promos de DB y SSOT a la forma de PromosCollapsible', () => {
    const norm = normalizePromosForCollapsible([
      { id: 'promo-db-1', label: '2x1 Quesadillas', description: 'Dos pizzas' },
      { id: '2x1', label: '2x1', description: '2x1 en Signature' },
    ]);
    expect(norm).toEqual([
      { id: 'promo-db-1', label: '2x1 Quesadillas', description: 'Dos pizzas' },
      { id: '2x1', label: '2x1', description: '2x1 en Signature' },
    ]);
  });

  it('label ausente → usa el id; description ausente → cadena vacía', () => {
    const norm = normalizePromosForCollapsible([{ id: 'x', label: '', description: undefined }]);
    expect(norm[0].label).toBe('x');
    expect(norm[0].description).toBe('');
  });
});