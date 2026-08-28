/**
 * settings.js (routes) — Configuración del restaurante (Admin).
 *
 * GET /api/settings → settings + efectivos (business/tax/paper/printer)
 * PUT /api/settings → upsert de keys conocidas (nit, business_name, …)
 *
 * v14 (2026-08-28): onboarding NIT/IVA/impresora sin tocar código.
 */

import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import {
  getAllSettings,
  updateSettings,
  getEffectiveBusiness,
  getEffectiveTaxConfig,
  getEffectivePaperSize,
} from '../services/settings.js';
import { getEffectivePrinterName } from '../services/printer.js';
import logger from '../utils/logger.js';

const router = Router();

router.get('/', requireAuth, requireRole('admin'), (req, res) => {
  try {
    const settings = getAllSettings();
    res.json({
      success: true,
      settings,
      effective: {
        business: getEffectiveBusiness(),
        tax: getEffectiveTaxConfig(),
        paperSize: getEffectivePaperSize(),
        printerName: getEffectivePrinterName(),
      },
    });
  } catch (err) {
    logger.error('[Settings] GET error:', err.message);
    res.status(500).json({ success: false, error: 'Error al leer configuración', code: 'SETTINGS_GET_ERROR' });
  }
});

router.put('/', requireAuth, requireRole('admin'), (req, res) => {
  try {
    const patch = req.body && typeof req.body === 'object' ? req.body : {};
    const updated = updateSettings(patch);
    res.json({
      success: true,
      settings: updated,
      effective: {
        business: getEffectiveBusiness(),
        tax: getEffectiveTaxConfig(),
        paperSize: getEffectivePaperSize(),
        printerName: getEffectivePrinterName(),
      },
    });
  } catch (err) {
    logger.error('[Settings] PUT error:', err.message);
    res.status(500).json({ success: false, error: 'Error al guardar configuración', code: 'SETTINGS_PUT_ERROR' });
  }
});

export default router;