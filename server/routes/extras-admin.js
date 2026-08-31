/**
 * extras-admin.js — Extras por grupo del menú (Admin, v15 2026-08-29).
 *
 * GET    /api/extras/:categoryId     → extras de un grupo (admin)
 * POST   /api/extras/:categoryId     → crear extra en el grupo
 * PUT    /api/extras/:id             → actualizar
 * DELETE /api/extras/:id             → eliminar
 *
 * El mesero los consume vía GET /api/menu/items/:id (se exponen como
 * modifier_group "Extras" dentro del detalle del item).
 */

import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { listExtras, createExtra, updateExtra, deleteExtra } from '../services/extras-service.js';
import { broadcastMenuChanged } from '../services/order-broadcaster.js';
import logger from '../utils/logger.js';

const router = Router();

router.get('/:categoryId', requireAuth, requireRole('admin'), (req, res) => {
  try {
    res.json({ success: true, extras: listExtras(req.params.categoryId) });
  } catch (err) {
    logger.error('[Extras] List error:', err.message);
    res.status(500).json({ success: false, error: 'Error al listar extras', code: 'EXTRAS_LIST_ERROR' });
  }
});

router.post('/:categoryId', requireAuth, requireRole('admin'), (req, res) => {
  try {
    const extra = createExtra(req.params.categoryId, req.body || {});
    broadcastMenuChanged();
    res.status(201).json({ success: true, extra });
  } catch (err) {
    logger.error('[Extras] Create error:', err.message);
    res.status(500).json({ success: false, error: 'Error al crear extra', code: 'EXTRAS_CREATE_ERROR' });
  }
});

router.put('/:id', requireAuth, requireRole('admin'), (req, res) => {
  try {
    const extra = updateExtra(req.params.id, req.body || {});
    if (!extra) return res.status(404).json({ success: false, error: 'Extra no encontrado', code: 'EXTRA_NOT_FOUND' });
    broadcastMenuChanged();
    res.json({ success: true, extra });
  } catch (err) {
    logger.error('[Extras] Update error:', err.message);
    res.status(500).json({ success: false, error: 'Error al actualizar extra', code: 'EXTRAS_UPDATE_ERROR' });
  }
});

router.delete('/:id', requireAuth, requireRole('admin'), (req, res) => {
  try {
    deleteExtra(req.params.id);
    broadcastMenuChanged();
    res.json({ success: true });
  } catch (err) {
    logger.error('[Extras] Delete error:', err.message);
    res.status(500).json({ success: false, error: 'Error al eliminar extra', code: 'EXTRAS_DELETE_ERROR' });
  }
});

export default router;