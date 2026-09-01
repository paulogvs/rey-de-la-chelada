/**
 * Promotions Routes — la DB manda (v16 2026-09-01, ESTANDARIZADO).
 *
 * GET /api/promotions (via mergedActivePromotions) devuelve:
 *   - Si la tabla `promos` existe → SOLO las promos DB activas (si ninguna
 *     activa → []). El SSOT quedó ELIMINADO — NO se fusiona nada.
 *   - Si la tabla no existe (crasha activePromosForBusinessDay) → [] (no
 *     rompe; no hay promos que mostrar).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const activeDbMock = vi.hoisted(() => ({ fn: vi.fn() }));

vi.mock('../../server/services/promos-service.js', () => ({
  activePromosForBusinessDay: (...args) => activeDbMock.fn(...args),
}));

vi.mock('../../server/utils/date-utils.js', () => ({
  businessDayDateStr: () => '2026-08-20',
}));

const { mergedActivePromotions } = await import('../../server/routes/promotions.js');

describe('mergedActivePromotions — la DB manda (v16)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('tabla existe + hay activas → SOLO DB (NO fusiona SSOT)', () => {
    activeDbMock.fn.mockReturnValue([
      { id: 'promo-db-1', name: '2x1 Quesadillas', label: '2x1 Quesadillas', description: '', price_total: 2000, price_mode: 'FIXED', price_value: 2000, lines: [{ group_id: 'pizzas', quantity: 2 }] },
    ]);
    const merged = mergedActivePromotions('2026-08-20');
    expect(merged.map(p => p.id)).toEqual(['promo-db-1']); // no aparece '2x1' SSOT
  });

  it('tabla existe + ninguna activa → [] (NUNCA el SSOT)', () => {
    activeDbMock.fn.mockReturnValue([]);
    const merged = mergedActivePromotions('2026-08-20');
    expect(merged).toEqual([]);
  });

  it('tabla NO existe (crasha) → [] sin romper (el SSOT ya no existe)', () => {
    activeDbMock.fn.mockImplementation(() => { throw new Error('no such table: promos'); });
    const merged = mergedActivePromotions('2026-08-20');
    expect(merged).toEqual([]);
  });
});