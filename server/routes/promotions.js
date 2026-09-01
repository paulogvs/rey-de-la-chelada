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
 * Promos activas del día laboral — SOLO data-driven (DB).
 *
 * v15 (2026-08-31): el SSOT (src/core/config/promotions.js) ya NO se fusiona.
 * Solo sirvió para sembrar la DB (seedDefaultPromos). La DB es la única fuente
 * de verdad: el Admin crea/activa/desactiva desde el panel (toggle ON/OFF).
 * Si la DB aún no tiene promos sembradas (migración no corrió), se cae al SSOT
 * como fallback temporal para no romper — pero una vez sembradas, la DB manda.
 */
export function mergedActivePromotions(businessDay) {
  let dbActive;
  let hasPromos = false;
  try {
    dbActive = activePromosForBusinessDay(businessDay);
    hasPromos = true; // la tabla promos existe (schema v15 aplicado)
  } catch {
    dbActive = [];
    hasPromos = false;
  }
  // Si la DB tiene la tabla `promos` (migración corrió), la DB es la ÚNICA
  // fuente: devolver solo las activas (si ninguna está activa → []).
  // El fallback al SSOT es SOLO si la tabla no existe aún (primera vez).
  if (hasPromos) return dbActive;
  return activePromotionsForDay(businessDay);
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