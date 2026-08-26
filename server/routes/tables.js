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
// Helpers — resumen del pedido activo por módulo (FASE 4.5)
//
// La alerta de la mesa en el salón ("🍳/🍺 verde = listo, amarillo = en
// proceso, 💰 Por cobrar = served") se DERIVA de los items del pedido
// activo — el server es la fuente de verdad, sin eventos perdidos.
// ============================================================

/**
 * Adjunta a cada mesa `active_order` = { id, status, modules } donde
 * modules es { bar?: 'ready'|'preparing', cocina?: ... }:
 *   - 'ready'     → hay items READY de ese módulo (se puede entregar ya)
 *   - 'preparing' → hay items pending/preparing (en proceso)
 *   - ausente     → sin items activos de ese módulo (no mostrar alerta)
 * Prioridad por módulo: ready > preparing (si hay listos, se entrega ya).
 */
function attachActiveOrderSummary(db, tables) {
  const activeOrders = db.prepare(`
    SELECT o.id as order_id, o.table_id, o.status,
           mi.area as module,
           SUM(CASE WHEN oi.status = 'ready' THEN 1 ELSE 0 END) as ready_count,
           SUM(CASE WHEN oi.status IN ('pending','preparing') THEN 1 ELSE 0 END) as in_progress
    FROM orders o
    JOIN order_items oi ON oi.order_id = o.id
    JOIN menu_items mi ON oi.menu_item_id = mi.id
    WHERE o.status NOT IN ('paid','cancelled')
    GROUP BY o.id, mi.area
  `).all();

  const byTable = new Map();
  for (const row of activeOrders) {
    const mod = row.module === 'bar' ? 'bar' : 'cocina';
    const state = Number(row.ready_count) > 0 ? 'ready'
      : Number(row.in_progress) > 0 ? 'preparing' : null;
    if (!state) continue;
    let entry = byTable.get(row.table_id);
    if (!entry) {
      entry = { id: row.order_id, status: row.status, modules: {} };
      byTable.set(row.table_id, entry);
    }
    entry.modules[mod] = state;
  }

  for (const table of tables) {
    if (!table.current_order_id) {
      table.active_order = null;
      continue;
    }
    let entry = byTable.get(table.id);
    if (!entry) {
      // Pedido sin items activos (p.ej. served — todo entregado): el status
      // real sigue importando → el salón muestra "💰 Por cobrar".
      const ord = db.prepare('SELECT id, status FROM orders WHERE id = ?').get(table.current_order_id);
      entry = { id: table.current_order_id, status: ord?.status ?? null, modules: {} };
    }
    table.active_order = entry;
  }
  return tables;
}

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
    attachActiveOrderSummary(db, tables);
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
    attachActiveOrderSummary(db, [table]);
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
    // 2026-08-25: las mesas ya NO tienen capacidad fija (decisión del dueño).
    // El cliente puede enviarla, pero se ignora (siempre 0).
    const { number, section, position } = req.body;

    if (number === undefined) {
      return res.status(400).json({ success: false, error: 'Número es requerido', code: 'TABLE_DATA_REQUIRED' });
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
    ).run(id, number, 0, 'free', section || 'interior', position ?? 0);

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
