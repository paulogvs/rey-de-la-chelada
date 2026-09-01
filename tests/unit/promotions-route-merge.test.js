/**
 * Promotions Routes — la DB manda (v15 2026-08-31, ESTANDARIZADO).
 *
 * GET /api/promotions (via mergedActivePromotions) devuelve:
 *   - Si la tabla `promos` existe → SOLO las promos DB activas (si ninguna
 *     activa → []). El SSOT NO se fusiona.
 *   - Si la tabla no existe (crasha activePromosForBusinessDay) → fallback
 *     al SSOT para no romper (primera vez).
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

describe('mergedActivePromotions — la DB manda (v15)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('tabla existe + hay activas → SOLO DB (NO fusiona SSOT)', () => {
    activeDbMock.fn.mockReturnValue([
      { id: 'promo-db-1', name: '2x1 Quesadillas', label: '2x1 Quesadillas', description: '', price_total: 2000, lines: [{ group_id: 'pizzas', quantity: 2 }] },
    ]);
    const merged = mergedActivePromotions('2026-08-20');
    expect(merged.map(p => p.id)).toEqual(['promo-db-1']); // no aparece '2x1' SSOT
  });

  it('tabla existe + ninguna activa → [] (NUNCA el SSOT)', () => {
    activeDbMock.fn.mockReturnValue([]);
    const merged = mergedActivePromotions('2026-08-20');
    expect(merged).toEqual([]);
  });

  it('tabla NO existe (crasha) → fallback al SSOT sin romper', () => {
    activeDbMock.fn.mockImplementation(() => { throw new Error('no such table: promos'); });
    const merged = mergedActivePromotions('2026-08-20');
    expect(merged.some(p => p.id === '2x1')).toBe(true);
    expect(merged.some(p => p.id === 'primera-visita')).toBe(true);
  });
});