/**
 * promos-admin.js — CRUD de promos (Admin, v15 2026-08-29).
 *
 * GET    /api/promotions/admin        → todas las promos (para el panel)
 * POST   /api/promotions/admin        → crear
 * PUT    /api/promotions/admin/:id    → actualizar
 * PATCH  /api/promotions/admin/:id/toggle → activar/desactivar
 * DELETE /api/promotions/admin/:id    → eliminar
 *
 * GET /api/promotions (público) sigue devolviendo las ACTIVAS del día
 * (ahora desde DB, fusionadas con el SSOT como fallback inicial).
 */

import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import {
  listPromos,
  createPromo,
  updatePromo,
  setPromoActive,
  deletePromo,
  activePromosForBusinessDay,
} from '../services/promos-service.js';
import { broadcastMenuChanged } from '../services/order-broadcaster.js';
import logger from '../utils/logger.js';

const router = Router();

router.get('/admin', requireAuth, requireRole('admin'), (req, res) => {
  try {
    res.json({ success: true, promos: listPromos() });
  } catch (err) {
    logger.error('[Promos] List error:', err.message);
    res.status(500).json({ success: false, error: 'Error al listar promos', code: 'PROMOS_LIST_ERROR' });
  }
});

router.post('/admin', requireAuth, requireRole('admin'), (req, res) => {
  try {
    const promo = createPromo(req.body || {}, req.user.sub);
    broadcastMenuChanged();
    res.status(201).json({ success: true, promo });
  } catch (err) {
    logger.error('[Promos] Create error:', err.message);
    res.status(500).json({ success: false, error: 'Error al crear promo', code: 'PROMOS_CREATE_ERROR' });
  }
});

router.put('/admin/:id', requireAuth, requireRole('admin'), (req, res) => {
  try {
    const promo = updatePromo(req.params.id, req.body || {});
    if (!promo) return res.status(404).json({ success: false, error: 'Promo no encontrada', code: 'PROMO_NOT_FOUND' });
    broadcastMenuChanged();
    res.json({ success: true, promo });
  } catch (err) {
    logger.error('[Promos] Update error:', err.message);
    res.status(500).json({ success: false, error: 'Error al actualizar promo', code: 'PROMOS_UPDATE_ERROR' });
  }
});

router.patch('/admin/:id/toggle', requireAuth, requireRole('admin'), (req, res) => {
  try {
    setPromoActive(req.params.id, req.body?.active !== false);
    broadcastMenuChanged();
    res.json({ success: true });
  } catch (err) {
    logger.error('[Promos] Toggle error:', err.message);
    res.status(500).json({ success: false, error: 'Error al cambiar estado', code: 'PROMOS_TOGGLE_ERROR' });
  }
});

router.delete('/admin/:id', requireAuth, requireRole('admin'), (req, res) => {
  try {
    deletePromo(req.params.id);
    broadcastMenuChanged();
    res.json({ success: true });
  } catch (err) {
    logger.error('[Promos] Delete error:', err.message);
    res.status(500).json({ success: false, error: 'Error al eliminar promo', code: 'PROMOS_DELETE_ERROR' });
  }
});

// GET /api/promotions (público, ya montado en promotions.js — aquí solo
// exponemos el helper por si un route externo quiere la fusión activa del día).
export { activePromosForBusinessDay };

export default router;