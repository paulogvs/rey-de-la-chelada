/**
 * ═══════════════════════════════════════════════════════════
 *  Client Orders Routes — Público (clientes PWA)
 *
 *  POST /api/client-orders            → Crear pedido público (sin JWT)
 *  GET  /api/client-orders/:id        → Estado del pedido (tracking)
 *
 *  "El pedido activo es el permiso": table_number + session_id
 *  son el permiso. NO auth requerida — es un endpoint público.
 *
 *  Delegado al servicio client-orders.js (unit-tested, TDD).
 * ═══════════════════════════════════════════════════════════
 */

import { Router } from 'express';
import { getDb } from '../db/index.js';
import { createPublicOrder, getPublicOrderStatus } from '../services/client-orders.js';
import { broadcastOrderCreated } from '../services/order-broadcaster.js';

const router = Router();

// POST /api/client-orders — Crear pedido desde el menú digital
router.post('/', (req, res) => {
  try {
    const db = getDb();
    const result = createPublicOrder(db, req.body);

    if (!result.success) {
      // 2.6 (A7): mesa ya tiene pedido activo de OTRO session_id → 409
      const statusCode = result.code === 'TABLE_HAS_ACTIVE_ORDER' ? 409 : 400;
      return res.status(statusCode).json({ success: false, code: result.code, error: result.error });
    }

    // Notify cocina/bar in real time — status real 'called' (el mesero
    // aún debe confirmar; KDS lo filtra hasta 'confirmed').
    try {
      broadcastOrderCreated(result.order);
    } catch {
      // Broadcasting must never break order creation
    }

    return res.status(201).json({
      success: true,
      orderId: result.order.id,
      status: result.order.status,
      total: result.order.total,
    });
  } catch (err) {
    console.error('[client-orders] error creating order:', err);
    return res.status(500).json({ success: false, code: 'SERVER_ERROR', error: 'Error interno' });
  }
});

// GET /api/client-orders/:id — Tracking público del pedido
router.get('/:id', (req, res) => {
  try {
    const db = getDb();
    const result = getPublicOrderStatus(db, req.params.id);

    if (!result.success) {
      return res.status(404).json({ success: false, code: result.code, error: result.error });
    }

    return res.json({ success: true, order: result });
  } catch (err) {
    console.error('[client-orders] error reading order:', err);
    return res.status(500).json({ success: false, code: 'SERVER_ERROR', error: 'Error interno' });
  }
});

export default router;
