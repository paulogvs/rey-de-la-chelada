/**
 * ═══════════════════════════════════════════════════════════
 *  Client Sessions Routes — Sesiones QR server-side
 *
 *  POST /api/client-sessions            → Admin crea sesión QR para mesa (JWT)
 *  GET  /api/client-sessions/:sid/validate?mesa=N → PÚBLICO, valida sesión
 *  DELETE /api/client-sessions/:sid     → Invalida (pago)
 *
 *  FIX: la sesión vivía en memoria del navegador Admin; ahora vive
 *  en SQLite → el cliente (otro dispositivo) puede validarla.
 *
 *  El GET validate es público (sin JWT), igual que client-orders:
 *  "El pedido activo es el permiso".
 * ═══════════════════════════════════════════════════════════
 */

import { Router } from 'express';
import { getDb } from '../db/index.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import {
  createClientSession,
  getOrCreateClientSession,
  validateClientSession,
  invalidateClientSession,
  associateOrderToSession,
} from '../services/client-sessions.js';

const router = Router();

/** Construye la base URL pública (PUBLIC_BASE_URL > Host del request) */
function resolveBaseUrl(req) {
  const publicBase = process.env.PUBLIC_BASE_URL?.replace(/\/+$/, '');
  if (publicBase) return publicBase;
  const host = req.headers.host || `localhost:${process.env.PORT || 3002}`;
  return `http://${host}`;
}

/**
 * POST /api/client-sessions — Crear sesión QR para una mesa (admin).
 * Body: { tableNumber, ttlMinutes? }
 * Construye la URL completa con el host del request (o PUBLIC_BASE_URL).
 */
router.post('/', requireAuth, requireRole('admin'), (req, res) => {
  try {
    const { tableNumber, ttlMinutes } = req.body || {};
    if (!tableNumber) {
      return res.status(400).json({
        success: false,
        code: 'TABLE_REQUIRED',
        error: 'tableNumber es requerido',
      });
    }

    const db = getDb();
    const result = createClientSession(db, tableNumber, ttlMinutes);

    if (!result.success) {
      return res.status(404).json({ success: false, code: result.code, error: result.error });
    }

    // Base URL: env PUBLIC_BASE_URL > Host del request > localhost
    const base = resolveBaseUrl(req);
    const url = `${base}/clientes?mesa=${result.tableNumber}&sid=${result.sessionId}`;

    return res.status(201).json({
      success: true,
      sessionId: result.sessionId,
      tableNumber: result.tableNumber,
      expiresAt: result.expiresAt,
      url,
    });
  } catch (err) {
    console.error('[client-sessions] create error:', err.message);
    return res.status(500).json({ success: false, code: 'SERVER_ERROR', error: 'Error interno' });
  }
});

/**
 * POST /api/client-sessions/table/:mesa — PÚBLICO (clientes PWA).
 *
 * QR ESTÁTICO (Opción A): el QR codifica SOLO `{base}/clientes?mesa=N`
 * (sin sid). Cuando el cliente abre esa URL, llama a este endpoint para
 * crear/obtener la sesión de forma lazy y persistirla en localStorage.
 *
 * Devuelve la URL ESTÁTICA estable (sin sid) + sessionId para que el
 * cliente la asocie localmente.
 */
router.post('/table/:mesa', (req, res) => {
  try {
    const mesa = parseInt(req.params.mesa, 10);
    if (!mesa || Number.isNaN(mesa)) {
      return res.status(400).json({
        success: false,
        code: 'TABLE_REQUIRED',
        error: 'Mesa inválida',
      });
    }

    const db = getDb();
    const result = getOrCreateClientSession(db, mesa);

    if (!result.success) {
      return res.status(404).json({ success: false, code: result.code, error: result.error });
    }

    const base = resolveBaseUrl(req);
    // URL ESTÁTICA: siempre estable, SIN sid → QR único e imprimible una vez.
    const url = `${base}/clientes?mesa=${result.tableNumber}`;

    return res.status(200).json({
      success: true,
      sessionId: result.sessionId,
      tableNumber: result.tableNumber,
      expiresAt: result.expiresAt,
      reused: !!result.reused,
      url,
    });
  } catch (err) {
    console.error('[client-sessions] get-or-create error:', err.message);
    return res.status(500).json({ success: false, code: 'SERVER_ERROR', error: 'Error interno' });
  }
});

/**
 * GET /api/client-sessions/:sid/validate?mesa=N — PÚBLICO (clientes PWA)
 */
router.get('/:sid/validate', (req, res) => {
  try {
    const { sid } = req.params;
    const mesa = parseInt(req.query.mesa, 10);

    if (!sid || !mesa) {
      return res.status(400).json({
        success: false,
        valid: false,
        code: 'PARAMS_REQUIRED',
        error: 'sid y mesa son requeridos',
      });
    }

    const db = getDb();

    // "El pedido activo es el permiso": ¿la mesa tiene pedido activo?
    const activeOrder = db.prepare(`
      SELECT id FROM orders
      WHERE table_number = ? AND status IN ('draft','called','confirmed','preparing','ready','served')
      ORDER BY created_at DESC LIMIT 1
    `).get(mesa);

    const hasActiveOrder = !!activeOrder;
    const result = validateClientSession(db, sid, mesa, hasActiveOrder);

    return res.json({
      success: true,
      valid: result.valid,
      reason: result.reason,
      sessionId: result.sessionId || sid,
      hasActiveOrder,
    });
  } catch (err) {
    console.error('[client-sessions] validate error:', err.message);
    return res.status(500).json({ success: false, valid: false, code: 'SERVER_ERROR', error: 'Error interno' });
  }
});

/**
 * POST /api/client-sessions/:sid/associate — vincular pedido a sesión (público)
 * Se llama al crear un pedido desde el menú digital.
 */
router.post('/:sid/associate', (req, res) => {
  try {
    const { sid } = req.params;
    const { orderId } = req.body || {};

    if (!sid || !orderId) {
      return res.status(400).json({ success: false, code: 'PARAMS_REQUIRED', error: 'sid y orderId requeridos' });
    }

    const db = getDb();
    associateOrderToSession(db, sid, orderId);

    return res.json({ success: true });
  } catch (err) {
    console.error('[client-sessions] associate error:', err.message);
    return res.status(500).json({ success: false, code: 'SERVER_ERROR', error: 'Error interno' });
  }
});

/**
 * DELETE /api/client-sessions/:sid — Invalida (cuando se paga)
 */
router.delete('/:sid', (req, res) => {
  try {
    const db = getDb();
    invalidateClientSession(db, req.params.sid);
    return res.json({ success: true });
  } catch (err) {
    console.error('[client-sessions] delete error:', err.message);
    return res.status(500).json({ success: false, code: 'SERVER_ERROR', error: 'Error interno' });
  }
});

export default router;
