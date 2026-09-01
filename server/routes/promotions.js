/**
 * ═══════════════════════════════════════════════════════════
 *  Promotions Routes — Promos del día laboral (v16 2026-09-01)
 *
 *  GET /api/promotions              → Promos activas HOY (día laboral)
 *  GET /api/promotions?business_day=YYYY-MM-DD → Promos de una fecha fija
 *
 *  PÚBLICO (sin JWT): el menú de clientes muestra "promos de hoy" sin
 *  login. Desde v15 FASE 3 el GET devuelve SOLO las promos data-driven de
 *  la DB (promos-service.activePromosForBusinessDay). Desde v16 el SSOT
 *  (src/core/config/promotions.js) quedó ELIMINADO: la DB es la única
 *  fuente de verdad. Si la tabla `promos` no existe aún (migración sin
 *  correr) → [] (no rompe, no fusiona nada).
 * ═══════════════════════════════════════════════════════════
 */

import { Router } from 'express';
import { businessDayDateStr, businessDayName } from '../utils/date-utils.js';
import { activePromosForBusinessDay } from '../services/promos-service.js';

const router = Router();

/**
 * Promos activas del día laboral — SOLO data-driven (DB). Si la DB aún no
 * tiene la tabla `promos` (migración no corrió) → [] (no rompe).
 */
export function mergedActivePromotions(businessDay) {
  try {
    return activePromosForBusinessDay(businessDay);
  } catch {
    return [];
  }
}

// GET /api/promotions — promos activas del día laboral (DB)
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
