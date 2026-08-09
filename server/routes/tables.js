/**
 * ═══════════════════════════════════════════════════════════
 *  Tables Routes — Gestión de Mesas
 *
 *  GET    /api/tables          → Listar todas las mesas
 *  GET    /api/tables/:id      → Mesa específica
 *  POST   /api/tables          → Crear mesa (admin)
 *  PUT    /api/tables/:id      → Actualizar mesa
 *  DELETE /api/tables/:id      → Eliminar mesa (admin)
 *
 *  Alineado al SSOT: server/db/schema.js → tables
 *  status CHECK: free, occupied, ordered, serving, payment, closed
 *  (se aceptan alias en español: disponible/ocupada/en_pedido/sirviendo/pago/cerrada)
 * ═══════════════════════════════════════════════════════════
 */

import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { getDb } from '../db/index.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const router = Router();

const TABLE_STATUS_MAP = {
  // Schema (canónico)
  free: 'free',
  occupied: 'occupied',
  ordered: 'ordered',
  serving: 'serving',
  payment: 'payment',
  closed: 'closed',
  // Alias español
  disponible: 'free',
  ocupada: 'occupied',
  en_pedido: 'ordered',
  sirviendo: 'serving',
  pago: 'payment',
  cerrada: 'closed',
};

// ============================================================
// GET /api/tables — Listar todas las mesas
// ============================================================

router.get('/', requireAuth, (req, res) => {
  try {
    const db = getDb();
    const tables = db.prepare(`
      SELECT id, number, capacity, status, current_order_id, assigned_waiter_id, section, position, notes
      FROM tables ORDER BY number ASC
    `).all();
    res.json({
      success: true,
      tables,
      // P2-3: capacidad declarada = nº real de mesas (SSOT capacity.totalTables=10).
      capacity: { totalTables: tables.length },
    });
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
    const { number, capacity, section, position } = req.body;

    if (number === undefined || capacity === undefined) {
      return res.status(400).json({ success: false, error: 'Número y capacidad son requeridos', code: 'TABLE_DATA_REQUIRED' });
    }

    const db = getDb();

    // Check duplicate number
    const existing = db.prepare('SELECT id FROM tables WHERE number = ?').get(number);
    if (existing) {
      return res.status(409).json({ success: false, error: `La mesa ${number} ya existe`, code: 'TABLE_EXISTS' });
    }

    const id = randomUUID();
    db.prepare(
      'INSERT INTO tables (id, number, capacity, status, section, position) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(id, number, capacity, 'free', section || 'interior', position ?? 0);

    const table = db.prepare('SELECT * FROM tables WHERE id = ?').get(id);
    res.status(201).json({ success: true, table });
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
    const { capacity, status, section, assigned_waiter_id } = req.body;
    const db = getDb();

    const existing = db.prepare('SELECT id FROM tables WHERE id = ?').get(req.params.id);
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Mesa no encontrada', code: 'TABLE_NOT_FOUND' });
    }

    // Only admin can change capacity
    if (capacity !== undefined && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, error: 'Solo admin puede cambiar capacidad', code: 'FORBIDDEN_CAPACITY' });
    }

    const updates = [];
    const params = [];

    if (capacity !== undefined) { updates.push('capacity = ?'); params.push(capacity); }
    if (status) {
      const canonical = TABLE_STATUS_MAP[status];
      if (!canonical) {
        return res.status(400).json({
          success: false,
          error: `Estado inválido. Use: ${Object.keys(TABLE_STATUS_MAP).join(', ')}`,
          code: 'INVALID_STATUS',
        });
      }
      updates.push('status = ?');
      params.push(canonical);
    }
    if (section !== undefined) { updates.push('section = ?'); params.push(section); }
    if (assigned_waiter_id !== undefined) { updates.push('assigned_waiter_id = ?'); params.push(assigned_waiter_id); }

    if (updates.length === 0) {
      return res.status(400).json({ success: false, error: 'Nada que actualizar', code: 'NO_UPDATES' });
    }

    updates.push("updated_at = datetime('now')");
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
    const activeOrder = db.prepare(
      "SELECT id FROM orders WHERE table_id = ? AND status NOT IN ('paid','cancelled')"
    ).get(req.params.id);
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
