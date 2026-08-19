/**
 * ═══════════════════════════════════════════════════════════
 *  Promotions Routes — Promos del día laboral (Sprint 2026-08-19)
 *
 *  GET /api/promotions              → Promos activas HOY (día laboral)
 *  GET /api/promotions?business_day=YYYY-MM-DD → Promos de una fecha fija
 *                                                (tests/consumidores)
 *
 *  PÚBLICO (sin JWT): el menú de clientes muestra "promos de hoy" sin
 *  login. La config vive en src/core/config/promotions.js (SSOT
 *  compartido cliente/server) — este route solo la filtra por fecha.
 * ═══════════════════════════════════════════════════════════
 */

import { Router } from 'express';
import { businessDayDateStr } from '../utils/date-utils.js';
import { activePromotionsForDay, businessDayName } from '../../src/core/config/promotions.js';

const router = Router();

// GET /api/promotions — promos activas del día laboral
router.get('/', (req, res) => {
  try {
    // Validación: business_day opcional con formato YYYY-MM-DD (regex simple)
    let businessDay = req.query.business_day || businessDayDateStr();
    if (req.query.business_day && !/^\d{4}-\d{2}-\d{2}$/.test(String(businessDay))) {
      return res.status(400).json({ success: false, error: 'business_day debe ser YYYY-MM-DD', code: 'INVALID_BUSINESS_DAY' });
    }
    const active = activePromotionsForDay(businessDay);
    res.json({
      success: true,
      business_day: businessDay,
      day_name: businessDayName(businessDay),
      promotions: active,
    });
  } catch {
    res.status(500).json({ success: false, error: 'Error al obtener promos', code: 'PROMOTIONS_ERROR' });
  }
});

export default router;