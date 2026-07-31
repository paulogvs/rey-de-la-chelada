/**
 * ═══════════════════════════════════════════════════════════
 *  Staff Routes — Gestión de Personal (v2)
 *
 *  GET    /api/staff          → Listar personal
 *  GET    /api/staff/:id      → Personal específico
 *  PUT    /api/staff/:id      → Actualizar PIN/display_name (admin)
 *  PATCH  /api/staff/:id/active → Activar/desactivar (admin)
 *
 *  v2: No create/delete. 3 fixed roles (admin, mesero, kds).
 *  Admin can update PIN per role.
 *  Alineado al SSOT: server/db/schema.js → staff
 * ═══════════════════════════════════════════════════════════
 */

import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { getDb } from '../db/index.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const router = Router();

// ============================================================
// GET /api/staff — Listar personal
// ============================================================

router.get('/', requireAuth, requireRole('admin'), (req, res) => {
  try {
    const db = getDb();
    const staff = db.prepare(`
      SELECT id, role, display_name, is_active, current_shift, created_at, last_login_at
      FROM staff ORDER BY role, display_name
    `).all();

    res.json({ success: true, staff });
  } catch (err) {
    console.error('[Staff] List error:', err.message);
    res.status(500).json({ success: false, error: 'Error al listar personal', code: 'STAFF_LIST_ERROR' });
  }
});

// ============================================================
// GET /api/staff/:id
// ============================================================

router.get('/:id', requireAuth, requireRole('admin'), (req, res) => {
  try {
    const db = getDb();
    const member = db.prepare(`
      SELECT id, role, display_name, is_active, current_shift, created_at, last_login_at
      FROM staff WHERE id = ?
    `).get(req.params.id);

    if (!member) {
      return res.status(404).json({ success: false, error: 'Personal no encontrado', code: 'STAFF_NOT_FOUND' });
    }

    res.json({ success: true, staff: member });
  } catch (err) {
    console.error('[Staff] Get error:', err.message);
    res.status(500).json({ success: false, error: 'Error al obtener personal', code: 'STAFF_GET_ERROR' });
  }
});

// ============================================================
// PUT /api/staff/:id — Update PIN or display_name (admin)
// ============================================================

router.put('/:id', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const { pin, display_name, current_shift } = req.body;
    const db = getDb();

    const existing = db.prepare('SELECT id, role FROM staff WHERE id = ?').get(req.params.id);
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Personal no encontrado', code: 'STAFF_NOT_FOUND' });
    }

    const updates = [];
    const params = [];

    if (pin) {
      const hash = await bcrypt.hash(String(pin), 10);
      updates.push('pin_hash = ?');
      params.push(hash);
    }
    if (display_name) { updates.push('display_name = ?'); params.push(display_name); }
    if (current_shift !== undefined) { updates.push('current_shift = ?'); params.push(current_shift); }

    if (updates.length === 0) {
      return res.status(400).json({ success: false, error: 'Nada que actualizar', code: 'NO_UPDATES' });
    }

    updates.push("updated_at = datetime('now')");
    params.push(req.params.id);
    db.prepare(`UPDATE staff SET ${updates.join(', ')} WHERE id = ?`).run(...params);

    const updated = db.prepare(
      'SELECT id, role, display_name, is_active, current_shift, created_at, last_login_at FROM staff WHERE id = ?'
    ).get(req.params.id);

    res.json({ success: true, staff: updated });
  } catch (err) {
    console.error('[Staff] Update error:', err.message);
    res.status(500).json({ success: false, error: 'Error al actualizar personal', code: 'STAFF_UPDATE_ERROR' });
  }
});

// ============================================================
// PATCH /api/staff/:id/active — Activar/desactivar
// ============================================================

router.patch('/:id/active', requireAuth, requireRole('admin'), (req, res) => {
  try {
    const { is_active } = req.body;
    if (is_active === undefined || typeof is_active !== 'boolean') {
      return res.status(400).json({ success: false, error: 'Estado activo requerido (boolean)', code: 'ACTIVE_REQUIRED' });
    }

    const db = getDb();
    const existing = db.prepare('SELECT id, role FROM staff WHERE id = ?').get(req.params.id);
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Personal no encontrado', code: 'STAFF_NOT_FOUND' });
    }

    if (req.user.sub == req.params.id && !is_active) {
      return res.status(409).json({ success: false, error: 'No puede desactivarse a sí mismo', code: 'SELF_DEACTIVATE' });
    }

    db.prepare('UPDATE staff SET is_active = ? WHERE id = ?').run(is_active ? 1 : 0, req.params.id);
    res.json({ success: true, is_active, message: is_active ? 'Usuario activado' : 'Usuario desactivado' });
  } catch (err) {
    console.error('[Staff] Toggle active error:', err.message);
    res.status(500).json({ success: false, error: 'Error al cambiar estado', code: 'STAFF_TOGGLE_ERROR' });
  }
});

export default router;
