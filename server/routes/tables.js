/**
 * ═══════════════════════════════════════════════════════════
 *  Tables Routes — Gestión de Mesas
 *
 *  GET    /api/tables          → Listar todas las mesas
 *  GET    /api/tables/:id      → Mesa específica
 *  PUT    /api/tables/:id      → Actualizar mesa
 *  POST   /api/tables          → Crear mesa (admin)
 *  DELETE /api/tables/:id      → Eliminar mesa (admin)
 * ═══════════════════════════════════════════════════════════
 */

import { Router } from 'express';
import { getDb } from '../db/index.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const router = Router();

// ============================================================
// GET /api/tables — Listar todas las mesas
// ============================================================

router.get('/', requireAuth, (req, res) => {
  try {
    const db = getDb();
    const tables = db.prepare('SELECT id, number, capacity, status, qr_token, section FROM tables ORDER BY number ASC').all();
    res.json({ success: true, tables });
  } catch (err) {
    console.error('[Tables] List error:', err.message);
    res.status(500).json({ success: false, error: 'Error al listar mesas', code: 'TABLES_LIST_ERROR' });
  }
});

// ============================================================
// GET /api/tables/:id — Mesa específica
// ============================================================

router.get('/:id', requireAuth, (req, res) => {
  try {
    const db = getDb();
    const table = db.prepare('SELECT * FROM tables WHERE id = ?').get(req.params.id);
    if (!table) {
      return res.status(404).json({ success: false, error: 'Mesa no encontrada', code: 'TABLE_NOT_FOUND' });
    }
    res.json({ success: true, table });
  } catch (err) {
    console.error('[Tables] Get error:', err.message);
    res.status(500).json({ success: false, error: 'Error al obtener mesa', code: 'TABLE_GET_ERROR' });
  }
});

// ============================================================
// POST /api/tables — Crear mesa (admin)
// ============================================================

router.post('/', requireAuth, requireRole('admin'), (req, res) => {
  try {
    const { number, capacity, section } = req.body;

    if (!number || capacity === undefined) {
      return res.status(400).json({ success: false, error: 'Número y capacidad son requeridos', code: 'TABLE_DATA_REQUIRED' });
    }

    const db = getDb();

    // Check duplicate number
    const existing = db.prepare('SELECT id FROM tables WHERE number = ?').get(number);
    if (existing) {
      return res.status(409).json({ success: false, error: `La mesa ${number} ya existe`, code: 'TABLE_EXISTS' });
    }

    const result = db.prepare(
      'INSERT INTO tables (number, capacity, status, section) VALUES (?, ?, ?, ?)'
    ).run(number, capacity, 'disponible', section || 'general');

    res.status(201).json({
      success: true,
      table: {
        id: result.lastInsertRowid,
        number,
        capacity,
        status: 'disponible',
        section: section || 'general',
      },
    });
  } catch (err) {
    console.error('[Tables] Create error:', err.message);
    res.status(500).json({ success: false, error: 'Error al crear mesa', code: 'TABLE_CREATE_ERROR' });
  }
});

// ============================================================
// PUT /api/tables/:id — Actualizar mesa
// ============================================================

router.put('/:id', requireAuth, requireRole('admin', 'mesero'), (req, res) => {
  try {
    const { capacity, status, section } = req.body;
    const db = getDb();

    const existing = db.prepare('SELECT id FROM tables WHERE id = ?').get(req.params.id);
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Mesa no encontrada', code: 'TABLE_NOT_FOUND' });
    }

    const validStatuses = ['disponible', 'ocupada', 'reservada', 'limpieza', 'mantenimiento'];
    if (status && !validStatuses.includes(status)) {
      return res.status(400).json({ success: false, error: `Estado inválido. Use: ${validStatuses.join(', ')}`, code: 'INVALID_STATUS' });
    }

    // Only admin can change capacity
    if (capacity !== undefined && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, error: 'Solo admin puede cambiar capacidad', code: 'FORBIDDEN_CAPACITY' });
    }

    const updates = [];
    const params = [];

    if (capacity !== undefined) { updates.push('capacity = ?'); params.push(capacity); }
    if (status) { updates.push('status = ?'); params.push(status); }
    if (section !== undefined) { updates.push('section = ?'); params.push(section); }

    if (updates.length === 0) {
      return res.status(400).json({ success: false, error: 'Nada que actualizar', code: 'NO_UPDATES' });
    }

    params.push(req.params.id);
    db.prepare(`UPDATE tables SET ${updates.join(', ')} WHERE id = ?`).run(...params);

    const updated = db.prepare('SELECT * FROM tables WHERE id = ?').get(req.params.id);
    res.json({ success: true, table: updated });
  } catch (err) {
    console.error('[Tables] Update error:', err.message);
    res.status(500).json({ success: false, error: 'Error al actualizar mesa', code: 'TABLE_UPDATE_ERROR' });
  }
});

// ============================================================
// DELETE /api/tables/:id — Eliminar mesa (admin only)
// ============================================================

router.delete('/:id', requireAuth, requireRole('admin'), (req, res) => {
  try {
    const db = getDb();
    const existing = db.prepare('SELECT id FROM tables WHERE id = ?').get(req.params.id);
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Mesa no encontrada', code: 'TABLE_NOT_FOUND' });
    }

    // Check if table has active orders
    const activeOrder = db.prepare('SELECT id FROM orders WHERE table_id = ? AND status NOT IN (?, ?)').get(req.params.id, 'completado', 'cancelado');
    if (activeOrder) {
      return res.status(409).json({ success: false, error: 'No se puede eliminar: la mesa tiene pedidos activos', code: 'TABLE_HAS_ACTIVE_ORDERS' });
    }

    db.prepare('DELETE FROM tables WHERE id = ?').run(req.params.id);
    res.json({ success: true, message: 'Mesa eliminada' });
  } catch (err) {
    console.error('[Tables] Delete error:', err.message);
    res.status(500).json({ success: false, error: 'Error al eliminar mesa', code: 'TABLE_DELETE_ERROR' });
  }
});

export default router;
