/**
 * Unit — Promos server-side: resolvePromoUnitPrice + validatePromoContext
 * (server/services/order-pricing.js)
 *
 * Contrato:
 *   - La línea con `promo_type` se factura con el precio de la promo
 *     (0 para 2x1, 12 barra, 25 primera visita, 30/15 combo), NUNCA con
 *     precio del cliente. El server valida día laboral + categoría +
 *     reglas de contexto (par 2x1, una vez primera visita, par combo).
 */

import { describe, it, expect } from 'vitest';
import { resolvePromoUnitPrice, validatePromoContext } from '../../server/services/order-pricing.js';

/** db mock: solo resuelve el nombre de categoría por id */
function mockDb(categoryName) {
  return {
    prepare() {
      return {
        get() { return { name: categoryName }; },
      };
    },
  };
}

/** menuItem mínimo: categoría Signature */
const SIGNATURE_ITEM = { id: 'sig-1', category_id: 'cat-sig' };
const ARTESANAL_ITEM = { id: 'art-1', category_id: 'cat-art' };

describe('resolvePromoUnitPrice — precios de línea', () => {
  it('2x1 (jueves) + Signature → unit 0 (gratis), label 2x1', () => {
    const r = resolvePromoUnitPrice(mockDb('Micheladas Signature'), SIGNATURE_ITEM, '2x1', { businessDay: '2026-08-20' });
    expect(r.error).toBeNull();
    expect(r.unitPrice).toBe(0);
    expect(r.promoLabel).toBe('2x1');
  });

  it('barra (miércoles) + Artesanal → unit 12', () => {
    const r = resolvePromoUnitPrice(mockDb('Cerveza Artesanal'), ARTESANAL_ITEM, 'barra', { businessDay: '2026-08-19' });
    expect(r.error).toBeNull();
    expect(r.unitPrice).toBe(12);
    expect(r.promoLabel).toBe('Miércoles de Barra');
  });

  it('primera-visita (mié/jue/dom) + Signature → unit 25', () => {
    const r = resolvePromoUnitPrice(mockDb('Micheladas Signature'), SIGNATURE_ITEM, 'primera-visita', { businessDay: '2026-08-20' });
    expect(r.error).toBeNull();
    expect(r.unitPrice).toBe(25);
    expect(r.promoLabel).toBe('Primera Visita');
  });

  it('combo: Signature → 30, Cerveza → 15 (suma 45)', () => {
    const a = resolvePromoUnitPrice(mockDb('Micheladas Signature'), SIGNATURE_ITEM, 'combo', { businessDay: '2026-08-20' });
    const b = resolvePromoUnitPrice(mockDb('Cerveza Artesanal'), ARTESANAL_ITEM, 'combo', { businessDay: '2026-08-20' });
    expect(a.unitPrice).toBe(30);
    expect(b.unitPrice).toBe(15);
    expect(a.unitPrice + b.unitPrice).toBe(45);
  });

  it('día no activo → error PROMO_NOT_ACTIVE (2x1 un miércoles)', () => {
    const r = resolvePromoUnitPrice(mockDb('Micheladas Signature'), SIGNATURE_ITEM, '2x1', { businessDay: '2026-08-19' });
    expect(r.error?.code).toBe('PROMO_NOT_ACTIVE');
    expect(r.unitPrice).toBeNull();
  });

  it('categoría no elegible → error PROMO_ITEM_NOT_ELIGIBLE (barra sobre Signature)', () => {
    const r = resolvePromoUnitPrice(mockDb('Micheladas Signature'), SIGNATURE_ITEM, 'barra', { businessDay: '2026-08-19' });
    expect(r.error?.code).toBe('PROMO_ITEM_NOT_ELIGIBLE');
  });

  it('promo desconocida → error INVALID_PROMO_TYPE', () => {
    const r = resolvePromoUnitPrice(mockDb('Micheladas Signature'), SIGNATURE_ITEM, 'falsa', { businessDay: '2026-08-20' });
    expect(r.error?.code).toBe('INVALID_PROMO_TYPE');
  });

  it('MODIFIER como línea → error PROMO_NOT_A_LINE (shot/escarchado son informativos)', () => {
    const r = resolvePromoUnitPrice(mockDb('Micheladas Signature'), SIGNATURE_ITEM, 'shot', { businessDay: '2026-08-20' });
    expect(r.error?.code).toBe('PROMO_NOT_A_LINE');
  });
});

describe('validatePromoContext — reglas de contexto', () => {
  const line = (categoryName, promoType = null, quantity = 1) => ({ categoryName, promoType, quantity });

  it('2x1: requiere al menos una Signature pagada por cada línea promo', () => {
    const ok = validatePromoContext([line('Micheladas Signature'), line('Micheladas Signature', '2x1')], '2x1', '2026-08-20');
    expect(ok.valid).toBe(true);

    const bad = validatePromoContext([line('Cerveza Artesanal'), line('Micheladas Signature', '2x1')], '2x1', '2026-08-20');
    expect(bad.valid).toBe(false);
    expect(bad.code).toBe('PROMO_CONTEXT_VIOLATION');
  });

  it('primera-visita: máximo 1 línea por pedido', () => {
    const ok = validatePromoContext([line('Micheladas Signature'), line('Micheladas Signature', 'primera-visita')], 'primera-visita', '2026-08-20');
    expect(ok.valid).toBe(true);

    const bad = validatePromoContext(
      [line('Micheladas Signature'), line('Micheladas Signature', 'primera-visita'), line('Micheladas Signature', 'primera-visita')],
      'primera-visita', '2026-08-20'
    );
    expect(bad.valid).toBe(false);
  });

  it('combo: requiere el par Signature + Cerveza marcado combo', () => {
    const ok = validatePromoContext(
      [line('Micheladas Signature', 'combo'), line('Cerveza Artesanal', 'combo')],
      'combo', '2026-08-20'
    );
    expect(ok.valid).toBe(true);

    const bad = validatePromoContext([line('Micheladas Signature', 'combo')], 'combo', '2026-08-20');
    expect(bad.valid).toBe(false);
  });

  it('promo sin reglas de contexto siempre válida (barra)', () => {
    const ok = validatePromoContext([line('Cerveza Artesanal')], 'barra', '2026-08-19');
    expect(ok.valid).toBe(true);
  });
});