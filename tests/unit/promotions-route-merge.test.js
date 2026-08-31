/**
 * Promotions Routes — fusión SSOT + DB (FASE 3 2026-08-31)
 *
 * GET /api/promotions debe devolver las promos ACTIVAS del día laboral
 * fusionando:
 *   - promos data-driven de la DB (promos-service.activePromosForBusinessDay)
 *   - promos fijas del SSOT (src/core/config/promotions.js)
 *
 * La DB gana si comparte id; si la DB falla o está vacía, el SSOT cubre.
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

describe('mergedActivePromotions — fusión SSOT + DB', () => {
  beforeEach(() => vi.clearAllMocks());

  it('jueves: fusiona promos DB activas + promos SSOT del día', () => {
    activeDbMock.fn.mockReturnValue([
      {
        id: 'promo-db-1', name: '2x1 Quesadillas', label: '2x1 Quesadillas',
        description: 'Dos pizzas al precio de una', price_total: 2000,
        lines: [{ group_id: 'pizzas', quantity: 2 }],
      },
    ]);
    const merged = mergedActivePromotions('2026-08-20'); // jueves
    const ids = merged.map(p => p.id);
    expect(ids).toContain('promo-db-1');      // de la DB
    expect(ids).toContain('2x1');             // SSOT jueves
    expect(ids).toContain('combo');           // SSOT jueves
    expect(ids).not.toContain('barra');       // SSOT miércoles
  });

  it('DB vacía → el SSOT cubre el día completo', () => {
    activeDbMock.fn.mockReturnValue([]);
    const merged = mergedActivePromotions('2026-08-20');
    expect(merged.some(p => p.id === '2x1')).toBe(true);
    expect(merged.some(p => p.id === 'primera-visita')).toBe(true);
  });

  it('la DB gana sobre el SSOT si comparten id (sin duplicados)', () => {
    activeDbMock.fn.mockReturnValue([
      { id: '2x1', name: '2x1 NUEVA', label: '2x1 NUEVA', description: 'db', price_total: 3000, lines: [] },
    ]);
    const merged = mergedActivePromotions('2026-08-20');
    expect(merged.filter(p => p.id === '2x1')).toHaveLength(1);
    expect(merged.find(p => p.id === '2x1').label).toBe('2x1 NUEVA');
  });

  it('si la DB falla (sin schema v15) → fallback al SSOT sin romper', () => {
    activeDbMock.fn.mockImplementation(() => { throw new Error('no such table: promos'); });
    const merged = mergedActivePromotions('2026-08-20');
    expect(merged.some(p => p.id === '2x1')).toBe(true);
  });
});