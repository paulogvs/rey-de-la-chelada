/**
 * IVA SSOT — cross-layer consistency test (Phase 4).
 *
 * Garantiza que TODAS las capas calculan el total de un carrito idéntico
 * usando el helper compartido `src/core/config/iva.js`. El modelo autorizado
 * es EXTRACTIVO: los precios INCLUYEN IVA (includedInPrices: true en
 * app.config.ts), por lo que:
 *   - total   = suma de precios (lo que paga el cliente, ya incluye IVA)
 *   - subtotal = total / 1.13 (base sin IVA)
 *   - iva     = total - subtotal
 *
 * TDD: pruebas escritas antes de centralizar las capas en el helper.
 */

import { describe, it, expect } from 'vitest';
import { computeTotals, extractIvaAmount, priceWithoutIva, IVA_RATE } from '../../src/core/config/iva';
import { appConfig } from '../../src/core/config/app.config';

// Carrito de ejemplo: 2x Chelada (20) + 1x Pique (85) → total bruto 125
const CART = [
  { price: 20, qty: 2 },
  { price: 85, qty: 1 },
];

function cartGross(cart) {
  return cart.reduce((sum, i) => sum + i.price * i.qty, 0);
}

describe('computeTotals (SSOT helper)', () => {
  it('extrae base e IVA de un total que ya incluye IVA', () => {
    const totals = computeTotals(125);
    expect(totals.total).toBe(125);        // lo que paga el cliente
    expect(totals.subtotal).toBe(110.62);  // 125 / 1.13
    expect(totals.iva).toBe(14.38);        // 125 - 110.62
  });

  it('extractIvaAmount coincide con computeTotals.iva', () => {
    expect(extractIvaAmount(125)).toBe(computeTotals(125).iva);
  });

  it('priceWithoutIva devuelve la base', () => {
    expect(priceWithoutIva(125)).toBeCloseTo(110.62, 2);
  });

  it('IVA_RATE es 13% (no hardcodeado por los módulos)', () => {
    expect(IVA_RATE).toBe(0.13);
  });
});

describe('Consistencia entre capas (mismo carrito → mismo total)', () => {
  it('el total del carrito es idéntico al de appConfig.calculateIVA', () => {
    const gross = cartGross(CART); // 125
    const helper = computeTotals(gross);
    const viaAppConfig = appConfig.calculateIVA(gross);
    expect(helper.total).toBe(viaAppConfig.total);
    expect(helper.subtotal).toBe(viaAppConfig.base);
    expect(helper.iva).toBe(viaAppConfig.iva);
  });

  it('appConfig.extractIva coincide con el helper', () => {
    const gross = cartGross(CART);
    expect(appConfig.extractIva(gross)).toBe(computeTotals(gross).iva);
    expect(appConfig.priceWithoutIva(gross)).toBe(priceWithoutIva(gross));
  });

  it('el modelo queda EN EXTRACTIVO (includedInPrices: true)', () => {
    // Confirmación: la config autorizada declara que los precios incluyen IVA.
    expect(appConfig.all.taxes.iva.includedInPrices).toBe(true);
  });
});
