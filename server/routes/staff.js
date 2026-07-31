/**
 * ═══════════════════════════════════════════════════════════
 *  Staff Routes — Gestión de Personal
 *
 *  GET    /api/staff          → Listar personal
 *  GET    /api/staff/:id      → Personal específico
 *  POST   /api/staff          → Crear (admin)
 *  PUT    /api/staff/:id      → Actualizar (admin)
 *  PATCH  /api/staff/:id/active → Activar/desactivar (admin)
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
      SELECT id, username, role, display_name, active, pin_set, created_at, last_login
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
      SELECT id, username, role, display_name, active, pin_set, created_at, last_login
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
// POST /api/staff — Crear personal
// ============================================================

router.post('/', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const { username, password, role, display_name } = req.body;

    if (!username || !password || !role || !display_name) {
      return res.status(400).json({
        success: false,
        error: 'Usuario, contraseña, rol y nombre son requeridos',
        code: 'STAFF_DATA_REQUIRED',
      });
    }

    const validRoles = ['admin', 'mesero', 'cocina', 'bartender', 'caja'];
    if (!validRoles.includes(role)) {
      return res.status(400).json({
        success: false,
        error: `Rol inválido. Use: ${validRoles.join(', ')}`,
        code: 'INVALID_ROLE',
      });
    }

    const db = getDb();

    // Check duplicate username
    const existing = db.prepare('SELECT id FROM staff WHERE username = ?').get(username);
    if (existing) {
      return res.status(409).json({ success: false, error: 'Usuario ya existe', code: 'USERNAME_EXISTS' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const result = db.prepare(
      'INSERT INTO staff (username, password_hash, role, display_name) VALUES (?, ?, ?, ?)'
    ).run(username, passwordHash, role, display_name);

    res.status(201).json({
      success: true,
      staff: {
        id: result.lastInsertRowid,
        username,
        role,
        display_name,
        active: 1,
        pin_set: 0,
      },
    });
  } catch (err) {
    console.error('[Staff] Create error:', err.message);
    res.status(500).json({ success: false, error: 'Error al crear personal', code: 'STAFF_CREATE_ERROR' });
  }
});

// ============================================================
// PUT /api/staff/:id — Actualizar personal
// ============================================================

router.put('/:id', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const { username, password, role, display_name } = req.body;
    const db = getDb();

    const existing = db.prepare('SELECT id FROM staff WHERE id = ?').get(req.params.id);
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Personal no encontrado', code: 'STAFF_NOT_FOUND' });
    }

    const updates = [];
    const params = [];

    if (username) { updates.push('username = ?'); params.push(username); }
    if (password) {
      const hash = await bcrypt.hash(password, 10);
      updates.push('password_hash = ?');
      params.push(hash);
    }
    if (role) { updates.push('role = ?'); params.push(role); }
    if (display_name) { updates.push('display_name = ?'); params.push(display_name); }

    if (updates.length === 0) {
      return res.status(400).json({ success: false, error: 'Nada que actualizar', code: 'NO_UPDATES' });
    }

    params.push(req.params.id);
    db.prepare(`UPDATE staff SET ${updates.join(', ')} WHERE id = ?`).run(...params);

    const updated = db.prepare(
      'SELECT id, username, role, display_name, active, created_at, last_login FROM staff WHERE id = ?'
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
    const { active } = req.body;
    if (active === undefined || typeof active !== 'boolean') {
      return res.status(400).json({ success: false, error: 'Estado activo requerido (boolean)', code: 'ACTIVE_REQUIRED' });
    }

    const db = getDb();
    const existing = db.prepare('SELECT id, role FROM staff WHERE id = ?').get(req.params.id);
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Personal no encontrado', code: 'STAFF_NOT_FOUND' });
    }

    // Prevent self-deactivation
    if (req.user.sub == req.params.id) {
      return res.status(409).json({ success: false, error: 'No puede desactivarse a sí mismo', code: 'SELF_DEACTIVATE' });
    }

    db.prepare('UPDATE staff SET active = ? WHERE id = ?').run(active ? 1 : 0, req.params.id);
    res.json({ success: true, active, message: active ? 'Usuario activado' : 'Usuario desactivado' });
  } catch (err) {
    console.error('[Staff] Toggle active error:', err.message);
    res.status(500).json({ success: false, error: 'Error al cambiar estado', code: 'STAFF_TOGGLE_ERROR' });
  }
});

export default router;
