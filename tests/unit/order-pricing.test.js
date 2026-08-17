/**
 * Order Pricing — resolveItemUnitPrice (Sprint 1, Sección B + E)
 *
 * SSOT de precios server-side: el server SIEMPRE calcula el unit_price
 * de una línea desde la DB, nunca del cliente:
 *
 *  - price definido           → unitPrice = price (+ modifiers)
 *  - price + apply_promo      → unitPrice = promo_price, promoLabel='Promo'
 *                               (si no hay promo_price → NO_PROMO_FOR_ITEM)
 *  - price NULL + price_variable=1 ("Consultar precio") → manualPrice OBLIGATORIO
 *                               (>0); si falta → PRICE_REQUIRED_MANUAL
 *  - price NULL sin variable  → también manualPrice obligatorio (nunca facturar 0)
 *  - manualPrice acepta "12,5" (coma decimal del MoneyInput) y número
 */

import { describe, it, expect } from 'vitest';
import { resolveItemUnitPrice } from '../../server/services/order-pricing.js';

// Mock DB mínimo para resolveModifierAdjustment (grupos + opciones por nombre)
function createMockDb() {
  const groups = [{ id: 'g1', menu_item_id: 'm1' }];
  const options = [
    { id: 'o1', group_id: 'g1', name: 'Doble Escarchado', price_adjustment: 5 },
    { id: 'o2', group_id: 'g1', name: 'Shot + Michelada', price_adjustment: 15 },
  ];
  return {
    prepare: (sql) => ({
      all: (...params) => {
        if (sql.includes('FROM modifier_groups')) {
          return groups.filter(g => g.menu_item_id === params[0] || true);
        }
        if (sql.includes('FROM modifier_options')) {
          const ids = params.includes('g1') ? ['g1'] : [];
          return options.filter(o => ids.includes(o.group_id));
        }
        return [];
      },
    }),
  };
}

const db = createMockDb();

// Helpers
const withPrice = (over = {}) => ({ id: 'm1', name: 'Test', price: 20, price_variable: 0, promo_price: null, ...over });
const manual = { id: 'm2', name: 'Negra Ahumada', price: null, price_variable: 1, promo_price: null };
const display = { id: 'm3', name: 'Jueves 2x1', price: null, price_variable: 0, promo_price: null };
const promoItem = { id: 'm4', name: 'IPA', price: 18, price_variable: 0, promo_price: 12 };

describe('resolveItemUnitPrice', () => {
  it('price definido → unitPrice = price (sin promo)', () => {
    const r = resolveItemUnitPrice(db, withPrice(), {});
    expect(r.error).toBeNull();
    expect(r.unitPrice).toBe(20);
    expect(r.promoLabel).toBeNull();
  });

  it('apply_promo con promo_price → unitPrice = promo y promoLabel Promo', () => {
    const r = resolveItemUnitPrice(db, promoItem, { applyPromo: true });
    expect(r.error).toBeNull();
    expect(r.unitPrice).toBe(12);
    expect(r.promoLabel).toBe('Promo');
  });

  it('apply_promo sin promo_price → 400 NO_PROMO_FOR_ITEM', () => {
    const r = resolveItemUnitPrice(db, withPrice(), { applyPromo: true });
    expect(r.error?.code).toBe('NO_PROMO_FOR_ITEM');
    expect(r.unitPrice).toBeNull();
  });

  it('price NULL + price_variable=1 sin manualPrice → PRICE_REQUIRED_MANUAL', () => {
    const r = resolveItemUnitPrice(db, manual, {});
    expect(r.error?.code).toBe('PRICE_REQUIRED_MANUAL');
    expect(r.unitPrice).toBeNull();
  });

  it('price NULL + price_variable=1 con manualPrice → unitPrice = manual', () => {
    const r = resolveItemUnitPrice(db, manual, { manualPrice: 35 });
    expect(r.error).toBeNull();
    expect(r.unitPrice).toBe(35);
  });

  it('manualPrice con coma decimal "12,5" → 12.5', () => {
    const r = resolveItemUnitPrice(db, manual, { manualPrice: '12,5' });
    expect(r.error).toBeNull();
    expect(r.unitPrice).toBe(12.5);
  });

  it('manualPrice <= 0 o no numérico → PRICE_REQUIRED_MANUAL', () => {
    expect(resolveItemUnitPrice(db, manual, { manualPrice: 0 }).error?.code).toBe('PRICE_REQUIRED_MANUAL');
    expect(resolveItemUnitPrice(db, manual, { manualPrice: -3 }).error?.code).toBe('PRICE_REQUIRED_MANUAL');
    expect(resolveItemUnitPrice(db, manual, { manualPrice: 'abc' }).error?.code).toBe('PRICE_REQUIRED_MANUAL');
  });

  it('price NULL sin price_variable (promo display) → PRICE_REQUIRED_MANUAL (nunca facturar 0)', () => {
    const r = resolveItemUnitPrice(db, display, {});
    expect(r.error?.code).toBe('PRICE_REQUIRED_MANUAL');
  });

  it('suma modifiers al unitPrice base', () => {
    const r = resolveItemUnitPrice(db, withPrice(), {
      modifiers: [{ optionName: 'Shot + Michelada' }], // +15
    });
    expect(r.error).toBeNull();
    expect(r.unitPrice).toBe(35);
  });

  it('suma modifiers al manualPrice', () => {
    const r = resolveItemUnitPrice(db, manual, {
      manualPrice: 30,
      modifiers: [{ optionName: 'Doble Escarchado' }], // +5
    });
    expect(r.error).toBeNull();
    expect(r.unitPrice).toBe(35);
  });

  it('promo gana sobre manual cuando ambos aplican (apply_promo)', () => {
    const item = { ...promoItem, price_variable: 1, price: null, promo_price: 12 };
    const r = resolveItemUnitPrice(db, item, { applyPromo: true, manualPrice: 50 });
    expect(r.error).toBeNull();
    expect(r.unitPrice).toBe(12);
    expect(r.promoLabel).toBe('Promo');
  });

  it('round2 aplica en manual con decimales largos', () => {
    const r = resolveItemUnitPrice(db, manual, { manualPrice: 12.3456 });
    expect(r.unitPrice).toBe(12.35);
  });

  it('pizza (price null) con tamaño Familiar → el ajuste ES el precio', () => {
    const pizza = { id: 'm5', name: 'Pizza La Rey', price: null, price_variable: 0, promo_price: null };
    const r = resolveItemUnitPrice(db, pizza, { modifiers: [{ optionName: 'Shot + Michelada' }] }); // +15
    expect(r.error).toBeNull();
    expect(r.unitPrice).toBe(15);
  });

  it('pizza (price null) SIN tamaño ni manual → PRICE_REQUIRED_MANUAL (nunca facturar 0)', () => {
    const pizza = { id: 'm5', name: 'Pizza La Rey', price: null, price_variable: 0, promo_price: null };
    const r = resolveItemUnitPrice(db, pizza, {});
    expect(r.error?.code).toBe('PRICE_REQUIRED_MANUAL');
  });

  it('manual explícito gana sobre el ajuste de modifiers', () => {
    // Negra Ahumada: manual 30 + Doble Escarchado (+5) → 35
    const r = resolveItemUnitPrice(db, manual, {
      manualPrice: 30,
      modifiers: [{ optionName: 'Doble Escarchado' }],
    });
    expect(r.error).toBeNull();
    expect(r.unitPrice).toBe(35);
  });
});
