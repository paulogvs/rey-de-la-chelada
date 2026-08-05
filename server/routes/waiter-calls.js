/**
 * ═══════════════════════════════════════════════════════════
 *  Waiter Calls Routes — Client → Mesero Communication
 *
 *  POST   /api/waiter-calls           → Create call (no auth, uses session_id)
 *  GET    /api/waiter-calls           → List calls (meseros poll)
 *  PATCH  /api/waiter-calls/:id/accept → Accept call (mesero, atomic)
 *  PATCH  /api/waiter-calls/:id/done  → Mark done
 *  DELETE /api/waiter-calls/:id       → Cancel
 *
 *  Alineado al SSOT: server/db/schema.js → waiter_calls
 * ═══════════════════════════════════════════════════════════
 */

import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { getDb } from '../db/index.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const router = Router();

// ============================================================
// POST /api/waiter-calls — Create a call (client, no auth)
// ============================================================
//
// "El QR es el permiso": la llamada solo se crea si la session_id
// existe en client_sessions y pertenece a la mesa del QR. El table_id
// se resuelve desde table_number (el cliente PWA no conoce table_id).
// Esto habilita llamar al mesero SIN pedido activo (FASE 1).
//
// Compatible con table_id directo (E2E/mesero). Si falta, se resuelve.

router.post('/', (req, res) => {
  try {
    const { table_id, table_number, session_id, call_type } = req.body;

    if ((!table_id && !table_number) || !session_id || !call_type) {
      return res.status(400).json({
        success: false,
        error: 'table_id o table_number, session_id y call_type son requeridos',
        code: 'WAITER_CALL_DATA_REQUIRED',
      });
    }

    if (!['call_waiter', 'request_bill'].includes(call_type)) {
      return res.status(400).json({
        success: false,
        error: 'call_type inválido. Use: call_waiter, request_bill',
        code: 'INVALID_CALL_TYPE',
      });
    }

    const db = getDb();

    // Resolver table_id desde table_number si no vino directo
    let resolvedTableId = table_id;
    if (!resolvedTableId && table_number) {
      const table = db.prepare('SELECT id, number FROM tables WHERE number = ?').get(table_number);
      if (!table) {
        return res.status(404).json({
          success: false,
          error: 'Mesa no encontrada',
          code: 'TABLE_NOT_FOUND',
        });
      }
      resolvedTableId = table.id;
    }

    // Validar sesión QR: existe y pertenece a la mesa ("el QR es el permiso")
    const session = db.prepare(
      'SELECT * FROM client_sessions WHERE session_id = ?'
    ).get(session_id);

    if (!session) {
      return res.status(403).json({
        success: false,
        error: 'Sesión QR inválida. Escanea el QR de la mesa.',
        code: 'INVALID_CLIENT_SESSION',
      });
    }
    if (session.table_number !== Number(table_number ?? tableNumberOf(resolvedTableId, db))) {
      return res.status(403).json({
        success: false,
        error: 'La sesión no pertenece a esta mesa',
        code: 'SESSION_TABLE_MISMATCH',
      });
    }

    // Check for existing pending call of same type on this table
    const existing = db.prepare(
      "SELECT id FROM waiter_calls WHERE table_id = ? AND call_type = ? AND status = 'pending'"
    ).get(resolvedTableId, call_type);

    if (existing) {
      return res.status(409).json({
        success: false,
        error: 'Ya existe una llamada pendiente de este tipo',
        code: 'CALL_ALREADY_PENDING',
        callId: existing.id,
      });
    }

    const id = randomUUID();
    db.prepare(`
      INSERT INTO waiter_calls (id, table_id, table_number, session_id, call_type, status)
      VALUES (?, ?, ?, ?, ?, 'pending')
    `).run(id, resolvedTableId, table_number ?? session.table_number, session_id, call_type);

    const call = db.prepare('SELECT * FROM waiter_calls WHERE id = ?').get(id);

    res.status(201).json({ success: true, call });
  } catch (err) {
    console.error('[WaiterCalls] Create error:', err.message);
    res.status(500).json({ success: false, error: 'Error al crear llamada', code: 'WAITER_CALL_CREATE_ERROR' });
  }
});

/** Resuelve el número de mesa desde un table_id (fallback para validación). */
function tableNumberOf(tableId, db) {
  const row = db.prepare('SELECT number FROM tables WHERE id = ?').get(tableId);
  return row?.number;
}

// ============================================================
// GET /api/waiter-calls — List calls (meseros poll)
// ============================================================

router.get('/', requireAuth, requireRole('admin', 'mesero'), (req, res) => {
  try {
    const { status, call_type } = req.query;
    const db = getDb();

    let sql = 'SELECT * FROM waiter_calls WHERE 1=1';
    const params = [];

    if (status) {
      const statuses = status.split(',').map(s => s.trim());
      sql += ` AND status IN (${statuses.map(() => '?').join(',')})`;
      params.push(...statuses);
    }

    if (call_type) {
      sql += ' AND call_type = ?';
      params.push(call_type);
    }

    sql += ' ORDER BY created_at ASC';

    const calls = db.prepare(sql).all(...params);

    res.json({ success: true, calls, count: calls.length });
  } catch (err) {
    console.error('[WaiterCalls] List error:', err.message);
    res.status(500).json({ success: false, error: 'Error al listar llamadas', code: 'WAITER_CALLS_LIST_ERROR' });
  }
});

// ============================================================
// PATCH /api/waiter-calls/:id/accept — Accept call (atomic)
// ============================================================

router.patch('/:id/accept', requireAuth, requireRole('admin', 'mesero'), (req, res) => {
  try {
    const db = getDb();
    const now = new Date().toISOString();

    // Atomic: only accept if still pending
    const result = db.prepare(
      "UPDATE waiter_calls SET status = 'accepted', accepted_by = ?, accepted_at = ? WHERE id = ? AND status = 'pending'"
    ).run(req.user.sub, now, req.params.id);

    if (result.changes === 0) {
      const existing = db.prepare('SELECT id, status FROM waiter_calls WHERE id = ?').get(req.params.id);
      if (!existing) {
        return res.status(404).json({ success: false, error: 'Llamada no encontrada', code: 'CALL_NOT_FOUND' });
      }
      return res.status(409).json({
        success: false,
        error: 'La llamada ya fue aceptada o cancelada',
        code: 'CALL_NOT_PENDING',
        currentStatus: existing.status,
      });
    }

    const call = db.prepare('SELECT * FROM waiter_calls WHERE id = ?').get(req.params.id);
    res.json({ success: true, call });
  } catch (err) {
    console.error('[WaiterCalls] Accept error:', err.message);
    res.status(500).json({ success: false, error: 'Error al aceptar llamada', code: 'WAITER_CALL_ACCEPT_ERROR' });
  }
});

// ============================================================
// PATCH /api/waiter-calls/:id/done — Mark done
// ============================================================

router.patch('/:id/done', requireAuth, requireRole('admin', 'mesero'), (req, res) => {
  try {
    const db = getDb();
    const result = db.prepare(
      "UPDATE waiter_calls SET status = 'done' WHERE id = ? AND status IN ('pending','accepted')"
    ).run(req.params.id);

    if (result.changes === 0) {
      const existing = db.prepare('SELECT id, status FROM waiter_calls WHERE id = ?').get(req.params.id);
      if (!existing) {
        return res.status(404).json({ success: false, error: 'Llamada no encontrada', code: 'CALL_NOT_FOUND' });
      }
      return res.status(409).json({
        success: false,
        error: 'La llamada ya está completada o cancelada',
        code: 'CALL_ALREADY_DONE',
      });
    }

    res.json({ success: true, message: 'Llamada completada' });
  } catch (err) {
    console.error('[WaiterCalls] Done error:', err.message);
    res.status(500).json({ success: false, error: 'Error al completar llamada', code: 'WAITER_CALL_DONE_ERROR' });
  }
});

// ============================================================
// DELETE /api/waiter-calls/:id — Cancel
// ============================================================

router.delete('/:id', (req, res) => {
  try {
    const db = getDb();
    const result = db.prepare(
      "UPDATE waiter_calls SET status = 'cancelled' WHERE id = ? AND status IN ('pending','accepted')"
    ).run(req.params.id);

    if (result.changes === 0) {
      const existing = db.prepare('SELECT id, status FROM waiter_calls WHERE id = ?').get(req.params.id);
      if (!existing) {
        return res.status(404).json({ success: false, error: 'Llamada no encontrada', code: 'CALL_NOT_FOUND' });
      }
      return res.status(409).json({
        success: false,
        error: 'La llamada ya está cancelada o completada',
        code: 'CALL_ALREADY_CANCELLED',
      });
    }

    res.json({ success: true, message: 'Llamada cancelada' });
  } catch (err) {
    console.error('[WaiterCalls] Cancel error:', err.message);
    res.status(500).json({ success: false, error: 'Error al cancelar llamada', code: 'WAITER_CALL_CANCEL_ERROR' });
  }
});

export default router;
