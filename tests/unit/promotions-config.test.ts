/**
 * Unit — Config de Promociones (src/core/config/promotions.js)
 *
 * SSOT de promos del restobar. Días = DÍAS LABORALES (15:00 → 06:00 +1,
 * hora Bolivia). Las funciones son PURAS: reciben el businessDayStr
 * 'YYYY-MM-DD' (ya calculado por server date-utils o cliente local-date)
 * y devuelven qué promos aplican — nunca calculan fechas internamente.
 *
 * Contrato aprobado (2026-08-19):
 *   - 2x1 (Jueves de Chelada): solo día laboral jueves
 *   - Miércoles de Barra: solo miércoles
 *   - Combo / Primera Visita / Shot / Escarchado: mié, jue, dom
 */

import { describe, it, expect } from 'vitest';
import {
  PROMOTIONS,
  businessDayName,
  activePromotionsForDay,
  isPromotionActiveForDay,
  promoById,
  promoUnitPrice,
} from '../../src/core/config/promotions.js';

describe('promotions config — businessDayName', () => {
  it('mapea una fecha laboral a su día en español', () => {
    expect(businessDayName('2026-08-17')).toBe('lunes');
    expect(businessDayName('2026-08-18')).toBe('martes');
    expect(businessDayName('2026-08-19')).toBe('miercoles');
    expect(businessDayName('2026-08-20')).toBe('jueves');
    expect(businessDayName('2026-08-21')).toBe('viernes');
    expect(businessDayName('2026-08-22')).toBe('sabado');
    expect(businessDayName('2026-08-23')).toBe('domingo');
  });
});

describe('promotions config — activePromotionsForDay', () => {
  it('jueves activa el 2x1 + combo + primera visita + shot + escarchado (NO barra)', () => {
    const active = activePromotionsForDay('2026-08-20').map(p => p.id);
    expect(active).toContain('2x1');
    expect(active).toContain('combo');
    expect(active).toContain('primera-visita');
    expect(active).toContain('shot');
    expect(active).toContain('escarchado');
    expect(active).not.toContain('barra');
  });

  it('miércoles activa barra + combo + primera visita + shot + escarchado (NO 2x1)', () => {
    const active = activePromotionsForDay('2026-08-19').map(p => p.id);
    expect(active).toContain('barra');
    expect(active).toContain('combo');
    expect(active).toContain('primera-visita');
    expect(active).not.toContain('2x1');
  });

  it('lunes no activa NINGUNA promo', () => {
    expect(activePromotionsForDay('2026-08-17')).toHaveLength(0);
  });

  it('domingo activa combo + primera visita + shot + escarchado', () => {
    const active = activePromotionsForDay('2026-08-23').map(p => p.id);
    expect(active).toContain('combo');
    expect(active).toContain('primera-visita');
    expect(active).not.toContain('2x1');
    expect(active).not.toContain('barra');
  });
});

describe('promotions config — isPromotionActiveForDay', () => {
  it('2x1 activo solo jueves', () => {
    expect(isPromotionActiveForDay('2x1', '2026-08-20')).toBe(true);
    expect(isPromotionActiveForDay('2x1', '2026-08-19')).toBe(false);
    expect(isPromotionActiveForDay('2x1', '2026-08-23')).toBe(false);
  });

  it('barra activa solo miércoles', () => {
    expect(isPromotionActiveForDay('barra', '2026-08-19')).toBe(true);
    expect(isPromotionActiveForDay('barra', '2026-08-20')).toBe(false);
  });
});

describe('promotions config — promoById y promoUnitPrice', () => {
  it('promoById devuelve la definición (o undefined)', () => {
    expect(promoById('2x1')?.name).toBe('Jueves de Chelada 2x1');
    expect(promoById('nope')).toBeUndefined();
  });

  it('PRICE_OVERRIDE: barra → 1200, primera visita → 2500', () => {
    expect(promoUnitPrice(promoById('barra'), 'Cerveza Artesanal')).toBe(1200);
     expect(promoUnitPrice(promoById('primera-visita'), 'Micheladas Especiales')).toBe(2500);
  });

  it('BOGO (2x1): unidad gratis (0)', () => {
     expect(promoUnitPrice(promoById('2x1'), 'Micheladas Especiales')).toBe(0);
  });

  it('COMBO: reparto fijo Signature 3000 + Cerveza 1500 = 4500', () => {
     expect(promoUnitPrice(promoById('combo'), 'Micheladas Especiales')).toBe(3000);
    expect(promoUnitPrice(promoById('combo'), 'Cerveza Artesanal')).toBe(1500);
  });

  it('MODIFIER (shot/escarchado) no tienen precio de línea', () => {
    expect(promoUnitPrice(promoById('shot'), null)).toBeNull();
    expect(promoUnitPrice(promoById('escarchado'), null)).toBeNull();
  });
});
