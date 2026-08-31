/**
 * ═══════════════════════════════════════════════════════════
 *  Promotions Routes — Promos del día laboral (Sprint 2026-08-19)
 *
 *  GET /api/promotions              → Promos activas HOY (día laboral)
 *  GET /api/promotions?business_day=YYYY-MM-DD → Promos de una fecha fija
 *                                                (tests/consumidores)
 *
 *  PÚBLICO (sin JWT): el menú de clientes muestra "promos de hoy" sin
 *  login. Desde v15 FASE 3 (2026-08-31) el GET fusiona:
 *    1) promos data-driven de la DB (promos-service.activePromosForBusinessDay)
 *    2) promos fijas del SSOT (src/core/config/promotions.js) como fallback
 *  La DB gana si comparte id; si la DB falla o está vacía, el SSOT cubre.
 * ═══════════════════════════════════════════════════════════
 */

import { Router } from 'express';
import { businessDayDateStr } from '../utils/date-utils.js';
import { activePromotionsForDay, businessDayName } from '../../src/core/config/promotions.js';
import { activePromosForBusinessDay } from '../services/promos-service.js';

const router = Router();

/**
 * Promos activas del día laboral fusionadas: DB (data-driven) + SSOT.
 * La DB gana; el SSOT cubre días/sin DB. Nunca lanza (si la DB no tiene
 * schema v15 aún, cae al SSOT).
 * @param {string} businessDay — 'YYYY-MM-DD' del día laboral
 * @returns {Array<object>}
 */
export function mergedActivePromotions(businessDay) {
  let dbActive;
  try {
    dbActive = activePromosForBusinessDay(businessDay);
  } catch {
    // DB sin schema v15 o error de conexión → fallback al SSOT
    dbActive = [];
  }
  const dbIds = new Set(dbActive.map(p => p.id));
  const ssotActive = activePromotionsForDay(businessDay).filter(p => !dbIds.has(p.id));
  return [...dbActive, ...ssotActive];
}

// GET /api/promotions — promos activas del día laboral (DB + SSOT)
router.get('/', (req, res) => {
  try {
    // Validación: business_day opcional con formato YYYY-MM-DD (regex simple)
    let businessDay = req.query.business_day || businessDayDateStr();
    if (req.query.business_day && !/^\d{4}-\d{2}-\d{2}$/.test(String(businessDay))) {
      return res.status(400).json({ success: false, error: 'business_day debe ser YYYY-MM-DD', code: 'INVALID_BUSINESS_DAY' });
    }
    const merged = mergedActivePromotions(businessDay);
    res.json({
      success: true,
      business_day: businessDay,
      day_name: businessDayName(businessDay),
      promotions: merged,
    });
  } catch {
    res.status(500).json({ success: false, error: 'Error al obtener promos', code: 'PROMOTIONS_ERROR' });
  }
});

export default router;