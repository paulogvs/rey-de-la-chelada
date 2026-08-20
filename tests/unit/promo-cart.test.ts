/**
 * Unit — promoCart.ts (src/pwa/meseros/promoCart.ts)
 *
 * Helper PURA del carrito del mesero para promos por día laboral.
 * Espejo cliente de las reglas del server (order-pricing.js): la UI
 * muestra qué promos se pueden aplicar y "preview" el ahorro, pero el
 * server SIEMPRE re-valida (nunca confía en el cliente).
 *
 * Contrato aprobado (2026-08-19):
 *   - 2x1: una Signature gratis por cada Signature pagada (sin promo)
 *   - Primera Visita: máx 1 línea por pedido
 *   - Combo: marca 1 Signature + 1 Cerveza juntas (3000 + 1500 = 4500)
 *   - Barra: Artesanal a 1200 (miércoles)
 *   - shot/escarchado son MODIFIER (informativo) — NO aplican como línea
 */

import { describe, it, expect } from 'vitest';
import {
  canApplyPromo,
  applyPromoToCart,
  clearPromoFromCart,
  resolveCartPromoUnitPrice,
  cartSavings,
} from '../../src/pwa/meseros/promoCart.js';

const sig = (over = {}) => ({
  id: 'sig-1',
  name: 'Isla Dorada',
  category_id: 'cat-sig',
  category_name: 'Micheladas Signature',
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

const item = (menuItem, quantity = 1, promoType = null) => ({ menuItem, quantity, promoType });

describe('canApplyPromo — reglas por promo', () => {
  it('2x1: ok con ≥1 Signature pagada (jueves)', () => {
    expect(canApplyPromo([item(sig())], '2x1', '2026-08-20')).toEqual({ ok: true });
  });

  it('2x1: no ok sin Signature pagada en el carrito', () => {
    const r = canApplyPromo([item(art())], '2x1', '2026-08-20');
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/Signature/i);
  });

  it('2x1: no ok si no es jueves', () => {
    const r = canApplyPromo([item(sig())], '2x1', '2026-08-19');
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('PROMO_NOT_ACTIVE');
  });

  it('barra: ok con ≥1 Artesanal pagada (miércoles)', () => {
    expect(canApplyPromo([item(art())], 'barra', '2026-08-19')).toEqual({ ok: true });
    const r = canApplyPromo([item(sig())], 'barra', '2026-08-19');
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/Artesanal/i);
  });

  it('primera-visita: ok una vez; rechaza si ya hay una en el carrito', () => {
    expect(canApplyPromo([item(sig())], 'primera-visita', '2026-08-20')).toEqual({ ok: true });
    const r = canApplyPromo(
      [item(sig(), 1, 'primera-visita'), item(sig())],
      'primera-visita', '2026-08-20'
    );
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/una vez/i);
  });

  it('combo: requiere Signature Y Cerveza sin promo', () => {
    expect(canApplyPromo([item(sig()), item(art())], 'combo', '2026-08-20')).toEqual({ ok: true });
    const r = canApplyPromo([item(sig())], 'combo', '2026-08-20');
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/Cerveza/i);
  });

  it('shot/escarchado (MODIFIER): no aplican como línea', () => {
    expect(canApplyPromo([item(sig())], 'shot', '2026-08-20').ok).toBe(false);
    expect(canApplyPromo([item(sig())], 'escarchado', '2026-08-20').ok).toBe(false);
  });

  it('promo desconocida → no', () => {
    expect(canApplyPromo([item(sig())], 'falsa', '2026-08-20').ok).toBe(false);
  });
});

describe('applyPromoToCart — marca líneas (inmutable)', () => {
  it('2x1: marca la primera Signature pagada con promoType 2x1', () => {
    const next = applyPromoToCart([item(sig()), item(sig({ id: 'sig-2' }))], '2x1', '2026-08-20');
    expect(next[0].promoType).toBe('2x1');
    expect(next[1].promoType).toBeNull();
    // el carrito original no se muta
    expect(next).not.toBe(applyPromoToCart([item(sig())], '2x1', '2026-08-20'));
  });

  it('barra: marca la primera Artesanal', () => {
    const next = applyPromoToCart([item(art()), item(art({ id: 'art-2' }))], 'barra', '2026-08-19');
    expect(next[0].promoType).toBe('barra');
    expect(next[1].promoType).toBeNull();
  });

  it('combo: marca UNA Signature + UNA Cerveza juntas', () => {
    const next = applyPromoToCart([item(sig()), item(art())], 'combo', '2026-08-20');
    const types = next.map(i => i.promoType).sort();
    expect(types).toEqual(['combo', 'combo']);
  });

  it('no marca nada si la regla falla (carrito intacto)', () => {
    const cart = [item(sig())];
    expect(applyPromoToCart(cart, 'combo', '2026-08-20')).toEqual(cart);
  });
});

describe('clearPromoFromCart — quita promo', () => {
  it('quita solo las líneas del tipo indicado', () => {
    const cart = [item(sig(), 1, '2x1'), item(sig({ id: 'sig-2' })), item(art(), 1, 'combo')];
    const next = clearPromoFromCart(cart, '2x1');
    expect(next[0].promoType).toBeNull();
    expect(next[2].promoType).toBe('combo');
  });
});

describe('resolveCartPromoUnitPrice — espejo del server', () => {
  it('2x1 → 0; barra → 1200; primera visita → 2500; combo → 3000/1500', () => {
    expect(resolveCartPromoUnitPrice(item(sig(), 1, '2x1'), '2026-08-20')).toBe(0);
    expect(resolveCartPromoUnitPrice(item(art(), 1, 'barra'), '2026-08-19')).toBe(1200);
    expect(resolveCartPromoUnitPrice(item(sig(), 1, 'primera-visita'), '2026-08-20')).toBe(2500);
    expect(resolveCartPromoUnitPrice(item(sig(), 1, 'combo'), '2026-08-20')).toBe(3000);
    expect(resolveCartPromoUnitPrice(item(art(), 1, 'combo'), '2026-08-20')).toBe(1500);
  });

  it('sin promo → precio base del item', () => {
    expect(resolveCartPromoUnitPrice(item(sig()), '2026-08-20')).toBe(4000);
    expect(resolveCartPromoUnitPrice(item(art()), '2026-08-19')).toBe(1500);
  });

  it('promoType con día no activo → null (el server rechazaría)', () => {
    expect(resolveCartPromoUnitPrice(item(sig(), 1, '2x1'), '2026-08-19')).toBeNull();
  });
});

describe('cartSavings — preview del ahorro', () => {
  it('2x1: ahorra el precio de la línea gratis', () => {
    const cart = [item(sig()), item(sig({ id: 'sig-2' }), 1, '2x1')];
    const s = cartSavings(cart, '2026-08-20');
    expect(s.originalTotal).toBe(8000);
    expect(s.promoTotal).toBe(4000);
    expect(s.savings).toBe(4000);
  });

  it('combo: 5500 → 4500 (ahorro 1000)', () => {
    const cart = [item(sig(), 1, 'combo'), item(art(), 1, 'combo')];
    const s = cartSavings(cart, '2026-08-20');
    expect(s.originalTotal).toBe(5500);
    expect(s.promoTotal).toBe(4500);
    expect(s.savings).toBe(1000);
  });

  it('sin promos → savings 0', () => {
    const s = cartSavings([item(sig()), item(art())], '2026-08-20');
    expect(s.savings).toBe(0);
    expect(s.originalTotal).toBe(s.promoTotal);
  });
});