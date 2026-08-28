/**
 * print.js — Endpoints de impresión térmica (server-side).
 *
 * v1 (2026-08-28): impresión REAL por Caja (y Admin para pruebas).
 * El cliente ya NO simula con console.log — llama a estos endpoints.
 *
 * POST /api/print/ticket  { orderId, paymentId? }  → imprime ticket del pedido
 * POST /api/print/test                             → ticket de prueba (Admin)
 */

import { Router } from 'express';
import { getDb } from '../db/index.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { buildOrder } from './orders.js';
import { buildTicketEscp, buildTestTicketEscp } from '../services/ticket-escp.js';
import { printRaw } from '../services/printer.js';
import {
  getEffectiveBusiness,
  getEffectiveTaxConfig,
  getEffectivePaperSize,
} from '../services/settings.js';
import logger from '../utils/logger.js';

const router = Router();

/**
 * Mapea el shape de buildOrder() (DB) al shape del generador de ticket.
 */
function toTicketOrder(order) {
  return {
    id: order.id,
    table_number: order.table_number ?? null,
    created_at: order.created_at,
    waiter_name: order.waiter_name || order.waiter_name_resolved || '',
    subtotal: order.subtotal,
    iva_amount: order.iva_amount,
    discount: order.discount,
    total: order.total,
    payment_method: order.payment_method,
    items: (order.items || []).map((i) => ({
      menu_item_name: i.menu_item_name || i.item_name || 'Item',
      quantity: i.quantity,
      unit_price: i.unit_price,
      subtotal: i.subtotal,
      modifiers_json: i.modifiers_json || '[]',
      promo_label: i.promo_label || null,
    })),
  };
}

function toPayment(payments, paymentId) {
  const list = Array.isArray(payments) ? payments : [];
  const p = paymentId ? list.find((x) => x.id === paymentId) : list[list.length - 1];
  if (!p) return null;
  return { id: p.id, method: p.method || '', reference: p.reference || '' };
}

// POST /api/print/ticket — imprimir ticket de un pedido (Caja)
router.post('/ticket', requireAuth, requireRole('admin', 'caja'), async (req, res) => {
  try {
    const { orderId, paymentId } = req.body || {};
    if (!orderId) {
      return res.status(400).json({ success: false, error: 'orderId requerido', code: 'ORDER_ID_REQUIRED' });
    }

    const db = getDb();
    const order = buildOrder(db, orderId);
    if (!order) {
      return res.status(404).json({ success: false, error: 'Pedido no encontrado', code: 'ORDER_NOT_FOUND' });
    }

    const payment = toPayment(order.payments, paymentId);
    const business = getEffectiveBusiness();
    const taxConfig = getEffectiveTaxConfig();
    const paperSize = getEffectivePaperSize();

    const bytes = buildTicketEscp({
      business,
      taxConfig,
      invoicing: { enabled: true },
      paperSize,
      order: toTicketOrder(order),
      payment,
    });

    const result = await printRaw(bytes);
    if (!result.ok) {
      return res.status(500).json({ success: false, error: result.message, code: 'PRINT_FAILED' });
    }
    res.json({ success: true, message: result.message, orderId, bytes: bytes.length });
  } catch (err) {
    logger.error('[Print] Ticket error:', err.message);
    res.status(500).json({ success: false, error: 'Error al imprimir ticket', code: 'PRINT_ERROR' });
  }
});

// POST /api/print/test — ticket de prueba (Admin, para configurar impresora)
router.post('/test', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const business = getEffectiveBusiness();
    const paperSize = getEffectivePaperSize();
    const bytes = buildTestTicketEscp({ business, paperSize });

    const result = await printRaw(bytes);
    if (!result.ok) {
      return res.status(500).json({ success: false, error: result.message, code: 'PRINT_FAILED' });
    }
    res.json({ success: true, message: result.message, bytes: bytes.length });
  } catch (err) {
    logger.error('[Print] Test error:', err.message);
    res.status(500).json({ success: false, error: 'Error al imprimir ticket de prueba', code: 'PRINT_ERROR' });
  }
});

export default router;