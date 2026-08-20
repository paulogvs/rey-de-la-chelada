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
 *  - manualPrice entero = CENTAVOS ("12,5" del MoneyInput → 1250); decimal legacy
 *    ("10.5") se convierte con toCents (10.5 → 1050)
 */

import { describe, it, expect } from 'vitest';
import { resolveItemUnitPrice } from '../../server/services/order-pricing.js';

// Mock DB mínimo para resolveModifierAdjustment (grupos + opciones por nombre)
function createMockDb() {
  const groups = [{ id: 'g1', menu_item_id: 'm1' }];
  const options = [
    { id: 'o1', group_id: 'g1', name: 'Doble Escarchado', price_adjustment: 500 },
    { id: 'o2', group_id: 'g1', name: 'Shot + Michelada', price_adjustment: 1500 },
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
const withPrice = (over = {}) => ({ id: 'm1', name: 'Test', price: 2000, price_variable: 0, promo_price: null, ...over });
const manual = { id: 'm2', name: 'Negra Ahumada', price: null, price_variable: 1, promo_price: null };
const display = { id: 'm3', name: 'Jueves 2x1', price: null, price_variable: 0, promo_price: null };
const promoItem = { id: 'm4', name: 'IPA', price: 1800, price_variable: 0, promo_price: 1200 };

describe('resolveItemUnitPrice', () => {
  it('price definido → unitPrice = price (sin promo)', () => {
    const r = resolveItemUnitPrice(db, withPrice(), {});
    expect(r.error).toBeNull();
    expect(r.unitPrice).toBe(2000);
    expect(r.promoLabel).toBeNull();
  });

  it('apply_promo con promo_price → unitPrice = promo y promoLabel Promo', () => {
    const r = resolveItemUnitPrice(db, promoItem, { applyPromo: true });
    expect(r.error).toBeNull();
    expect(r.unitPrice).toBe(1200);
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
    const r = resolveItemUnitPrice(db, manual, { manualPrice: 3500 });
    expect(r.error).toBeNull();
    expect(r.unitPrice).toBe(3500);
  });

  it('manualPrice con coma decimal "12,5" → 1250 centavos', () => {
    const r = resolveItemUnitPrice(db, manual, { manualPrice: '12,5' });
    expect(r.error).toBeNull();
    expect(r.unitPrice).toBe(1250);
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
      modifiers: [{ optionName: 'Shot + Michelada' }], // +1500
    });
    expect(r.error).toBeNull();
    expect(r.unitPrice).toBe(3500);
  });

  it('suma modifiers al manualPrice', () => {
    const r = resolveItemUnitPrice(db, manual, {
      manualPrice: 3000,
      modifiers: [{ optionName: 'Doble Escarchado' }], // +500
    });
    expect(r.error).toBeNull();
    expect(r.unitPrice).toBe(3500);
  });

  it('promo gana sobre manual cuando ambos aplican (apply_promo)', () => {
    const item = { ...promoItem, price_variable: 1, price: null, promo_price: 1200 };
    const r = resolveItemUnitPrice(db, item, { applyPromo: true, manualPrice: 5000 });
    expect(r.error).toBeNull();
    expect(r.unitPrice).toBe(1200);
    expect(r.promoLabel).toBe('Promo');
  });

  it('round2 aplica en manual con decimales largos', () => {
    const r = resolveItemUnitPrice(db, manual, { manualPrice: 12.3456 });
    expect(r.unitPrice).toBe(1235);
  });

  it('pizza (price null) con tamaño Familiar → el ajuste ES el precio', () => {
    const pizza = { id: 'm5', name: 'Pizza La Rey', price: null, price_variable: 0, promo_price: null };
    const r = resolveItemUnitPrice(db, pizza, { modifiers: [{ optionName: 'Shot + Michelada' }] }); // +1500
    expect(r.error).toBeNull();
    expect(r.unitPrice).toBe(1500);
  });

  it('pizza (price null) SIN tamaño ni manual → PRICE_REQUIRED_MANUAL (nunca facturar 0)', () => {
    const pizza = { id: 'm5', name: 'Pizza La Rey', price: null, price_variable: 0, promo_price: null };
    const r = resolveItemUnitPrice(db, pizza, {});
    expect(r.error?.code).toBe('PRICE_REQUIRED_MANUAL');
  });

  it('manual explícito gana sobre el ajuste de modifiers', () => {
    // Negra Ahumada: manual 3000 + Doble Escarchado (+500) → 3500
    const r = resolveItemUnitPrice(db, manual, {
      manualPrice: 3000,
      modifiers: [{ optionName: 'Doble Escarchado' }],
    });
    expect(r.error).toBeNull();
    expect(r.unitPrice).toBe(3500);
  });
});
