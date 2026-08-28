/**
 * ═══════════════════════════════════════════════════════════
 *  Orders Routes — Pedidos + KDS Integration
 *
 *  GET    /api/orders               → Listar pedidos (filtrable)
 *  GET    /api/orders/:id           → Pedido específico
 *  POST   /api/orders               → Crear pedido
 *  PUT    /api/orders/:id           → Actualizar pedido
 *  PATCH  /api/orders/:id/status    → Cambiar estado
 *  POST   /api/orders/:id/items     → Agregar item a pedido
 *  DELETE /api/orders/:id/items/:itemId → Quitar item
 *  GET    /api/orders/kds/:module   → KDS view (cocina/bar)
 *
 *  Alineado al SSOT: server/db/schema.js
 *  orders.status:  draft, confirmed, preparing, ready, served, paid, cancelled
 *  order_items.status: pending, preparing, ready, delivered, cancelled
 *  IVA: orders.iva_amount (13% sobre subtotal)
 *  KDS: el módulo (cocina/bar) sale de menu_items.area
 * ═══════════════════════════════════════════════════════════
 */

import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { getDb } from '../db/index.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { logger } from '../utils/logger.js'; // S1/T2: errores de pedidos al log diario
import { broadcastOrderCreated, broadcastOrderStatusChange, broadcastOrderComplete, isOrderFullyReady, isModuleFullyReady, broadcastModuleReady } from '../services/order-broadcaster.js';
import { broadcaster, buildKDSEvent, KDSEventType } from '../services/websocket-broadcaster.js';
import { computeTotals, round2 } from '../../src/core/config/iva.js';
import { resolveModifierAdjustment, resolveItemUnitPrice, resolvePromoUnitPrice, validatePromoContext, categoryNameOf, recalcOrder } from '../services/order-pricing.js';
import { recalcOrderStatus, resolveRound } from '../services/order-status.js';
import { businessDayDateStr } from '../utils/date-utils.js';

const router = Router();

// ============================================================
// Helpers
// ============================================================

/**
 * Día laboral para promos: override `business_day` (YYYY-MM-DD) opcional
 * en el body (tests/e2e con día fijo) o el día laboral real del server.
 */
function promoBusinessDay(body) {
  const override = body && body.business_day;
  if (override && /^\d{4}-\d{2}-\d{2}$/.test(String(override))) return String(override);
  return businessDayDateStr();
}

// Mapeo de estados al schema (se acepta español o canónico)
const ORDER_STATUS_MAP = {
  pendiente: 'confirmed', en_preparacion: 'preparing', listo: 'ready',
  servido: 'served', completado: 'paid', cancelado: 'cancelled',
  draft: 'draft', called: 'called', confirmed: 'confirmed', preparing: 'preparing',
  ready: 'ready', served: 'served', paid: 'paid', cancelled: 'cancelled',
};

const ITEM_STATUS_MAP = {
  pendiente: 'pending', en_preparacion: 'preparing', listo: 'ready',
  servido: 'delivered', cancelado: 'cancelled',
  pending: 'pending', preparing: 'preparing', ready: 'ready',
  delivered: 'delivered', cancelled: 'cancelled',
};

const KDS_MODULES = { cocina: 'cocina', bar: 'bar', kds: 'all' };

/**
 * Recalcula subtotal/iva/total de un pedido.
 *
 * MODELO SSOT (iva.js — precio INCLUYE IVA): el `grossTotal` es la suma de
 * precios de línea (que ya incluyen IVA). Entonces:
 *   - total   = grossTotal (lo que paga el cliente)
 *   - subtotal = total / 1.13 (base, sin IVA)
 *   - iva     = total - subtotal
 *
 * NOTA: resolveModifierAdjustment y recalcOrder viven en
 * server/services/order-pricing.js (FASE 2 — compartidos con sync.js).
 */

/** Helper para armar la respuesta de un pedido con items */
export function buildOrder(db, orderId) {
  const order = db.prepare(`
    SELECT o.*, t.number as table_number, s.display_name as waiter_name_resolved
    FROM orders o
    LEFT JOIN tables t ON o.table_id = t.id
    LEFT JOIN staff s ON o.waiter_id = s.id
    WHERE o.id = ?
  `).get(orderId);

  if (!order) return null;

  order.items = db.prepare(`
    SELECT oi.*, mi.name as item_name, mi.area as kds_module, mc.name as category_name
    FROM order_items oi
    LEFT JOIN menu_items mi ON oi.menu_item_id = mi.id
    LEFT JOIN menu_categories mc ON mi.category_id = mc.id
    WHERE oi.order_id = ?
    ORDER BY oi.created_at ASC
  `).all(orderId);

  order.payments = db.prepare('SELECT * FROM payments WHERE order_id = ?').all(orderId);
  return order;
}

// ============================================================
// GET /api/orders — Listar pedidos
// ============================================================

router.get('/', requireAuth, (req, res) => {
  try {
    const db = getDb();
    const { status, table_id, date_from, date_to, limit, pending } = req.query;

    let sql = `
      SELECT o.*, t.number as table_number, s.display_name as waiter_name_resolved,
             COALESCE((
               SELECT SUM(p.amount) FROM payments p
               WHERE p.order_id = o.id AND p.status = 'completed'
             ), 0) as paid_amount
      FROM orders o
      LEFT JOIN tables t ON o.table_id = t.id
      LEFT JOIN staff s ON o.waiter_id = s.id
      WHERE 1=1
    `;
    const params = [];

    // S2-C: ?pending=1 → pedidos que la caja debe cobrar (activos en el
    // flujo, sin draft ni paid/cancelled). Aditivo — no rompe el resto.
    let statuses = null;
    if (pending === '1') {
      statuses = ['called', 'confirmed', 'preparing', 'ready', 'served'];
    } else if (status) {
      statuses = status.split(',').map(s => ORDER_STATUS_MAP[s.trim()] || s.trim());
    }

    if (statuses) {
      sql += ` AND o.status IN (${statuses.map(() => '?').join(',')})`;
      params.push(...statuses);
    }

    if (table_id) { sql += ' AND o.table_id = ?'; params.push(table_id); }
    if (date_from) { sql += ' AND o.created_at >= ?'; params.push(date_from); }
    if (date_to) { sql += ' AND o.created_at <= ?'; params.push(date_to); }

    sql += ' ORDER BY o.created_at DESC';

    if (limit) {
      sql += ' LIMIT ?';
      params.push(parseInt(limit, 10));
    }

    const orders = db.prepare(sql).all(...params);

    // Attach items to each order
    for (const order of orders) {
      order.items = db.prepare(`
        SELECT oi.*, mi.name as item_name, mi.area as kds_module
        FROM order_items oi
        LEFT JOIN menu_items mi ON oi.menu_item_id = mi.id
        WHERE oi.order_id = ?
        ORDER BY oi.created_at ASC
      `).all(order.id);
    }

    res.json({ success: true, orders, count: orders.length });
  } catch (err) {
    logger.error('[Orders] List error:', err.message);
    res.status(500).json({ success: false, error: 'Error al listar pedidos', code: 'ORDERS_LIST_ERROR' });
  }
});

// ============================================================
// GET /api/orders/kds/:module — KDS View (cocina/bar)
// NOTA: debe registrarse ANTES de GET /:id (orden de Express)
// ============================================================

router.get('/kds/:module', requireAuth, requireRole('admin', 'kds'), (req, res) => {
  try {
    const module = req.params.module;
    if (!KDS_MODULES[module]) {
      return res.status(400).json({ success: false, error: 'Módulo KDS inválido. Use: cocina, bar, kds', code: 'INVALID_KDS_MODULE' });
    }

    const db = getDb();
    const moduleFilter = KDS_MODULES[module]; // 'cocina', 'bar', or 'all'

    let sql = `
      SELECT DISTINCT o.id, o.table_id, t.number as table_number, o.status,
             o.notes, o.created_at, o.waiter_id, s.display_name as waiter_name_resolved
      FROM orders o
      JOIN order_items oi ON o.id = oi.order_id
      JOIN menu_items mi ON oi.menu_item_id = mi.id
      LEFT JOIN tables t ON o.table_id = t.id
      LEFT JOIN staff s ON o.waiter_id = s.id
      WHERE o.status IN ('confirmed', 'preparing', 'ready')
    `;
    const params = [];

    if (moduleFilter !== 'all') {
      sql += ' AND mi.area = ?';
      params.push(moduleFilter);
    }

    sql += ` ORDER BY
        CASE o.status
          WHEN 'confirmed' THEN 1
          WHEN 'preparing' THEN 2
          WHEN 'ready' THEN 3
        END,
        o.created_at ASC`;

    const orders = db.prepare(sql).all(...params);

    // Attach KDS items for each order
    for (const order of orders) {
      let itemSql = `
        SELECT oi.id, oi.menu_item_id, mi.name as item_name, oi.quantity,
               oi.unit_price, oi.preparation_notes as item_notes, oi.status as item_status,
               oi.modifiers_json, oi.created_at, oi.round, oi.promo_label, mi.area as kds_module,
               mc.name as category_name
        FROM order_items oi
        JOIN menu_items mi ON oi.menu_item_id = mi.id
        LEFT JOIN menu_categories mc ON mi.category_id = mc.id
        WHERE oi.order_id = ?
      `;
      const itemParams = [order.id];

      if (moduleFilter !== 'all') {
        itemSql += ' AND mi.area = ?';
        itemParams.push(moduleFilter);
      }

      itemSql += ' ORDER BY oi.created_at ASC';
      order.items = db.prepare(itemSql).all(...itemParams);

      // Calculate wait time
      const created = new Date(order.created_at);
      const now = new Date();
      order.wait_minutes = Math.floor((now - created) / 60000);
    }

    res.json({ success: true, module, orders });
  } catch (err) {
    logger.error('[Orders] KDS error:', err.message);
    res.status(500).json({ success: false, error: 'Error al obtener KDS', code: 'KDS_ERROR' });
  }
});

// ============================================================
// GET /api/orders/:id — Pedido específico
// ============================================================

router.get('/:id', requireAuth, (req, res) => {
  try {
    const db = getDb();
    const order = buildOrder(db, req.params.id);

    if (!order) {
      return res.status(404).json({ success: false, error: 'Pedido no encontrado', code: 'ORDER_NOT_FOUND' });
    }

    res.json({ success: true, order });
  } catch (err) {
    logger.error('[Orders] Get error:', err.message);
    res.status(500).json({ success: false, error: 'Error al obtener pedido', code: 'ORDER_GET_ERROR' });
  }
});

// ============================================================
// POST /api/orders — Crear pedido
// ============================================================

router.post('/', requireAuth, requireRole('admin', 'mesero'), (req, res) => {
  try {
    const { table_id, items, notes, guest_count, local_id } = req.body;

    if (!table_id) {
      return res.status(400).json({ success: false, error: 'Mesa requerida', code: 'TABLE_REQUIRED' });
    }

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, error: 'Al menos un item requerido', code: 'ITEMS_REQUIRED' });
    }

    const db = getDb();

    // Verify table exists
    const table = db.prepare('SELECT id, number, status FROM tables WHERE id = ?').get(table_id);
    if (!table) {
      return res.status(404).json({ success: false, error: 'Mesa no encontrada', code: 'TABLE_NOT_FOUND' });
    }

    // P1-1 (2026-08-11): UN SOLO PEDIDO ACTIVO POR MESA — el mesero
    // (POST /api/orders) y sync (create_order) deben respetar el mismo
    // contrato que el path público client-orders. Antes el mesero podía
    // abrir un 2º pedido en una mesa ya ocupada → 2 pedidos cobrables.
    const activeOrder = db.prepare(
      "SELECT id FROM orders WHERE table_id = ? AND status NOT IN ('paid','cancelled')"
    ).get(table_id);
    if (activeOrder) {
      return res.status(409).json({
        success: false,
        error: 'La mesa ya tiene un pedido activo — edítalo con PUT /api/orders/:id',
        code: 'TABLE_HAS_ACTIVE_ORDER',
        activeOrderId: activeOrder.id,
      });
    }

    // Calculate totals
    let subtotal = 0;
    const orderItems = [];

    for (const item of items) {
      // Validación de cantidad (FASE 2): 0 o negativa → rechazo explícito
      const quantity = item.quantity ?? 1;
      if (!Number.isFinite(quantity) || quantity < 1) {
        return res.status(400).json({
          success: false,
          error: 'Cantidad inválida (debe ser ≥ 1)',
          code: 'INVALID_QUANTITY',
        });
      }

      const menuItem = db.prepare(
        'SELECT id, name, price, price_variable, promo_price, category_id, area FROM menu_items WHERE id = ? AND is_active = 1'
      ).get(item.menu_item_id);
      if (!menuItem) {
        return res.status(400).json({ success: false, error: `Item inválido: ${item.menu_item_id}`, code: 'INVALID_MENU_ITEM' });
      }

      // Sprint 1 (B/E): precio manual "Consultar precio" + promo manual.
      // SSOT: el server resuelve unit_price (nunca acepta precios del cliente).
      // Sprint Promos (2026-08-19): si la línea trae `promo_type`, se factura
      // con el precio de la PROMO (0 2x1, 12 barra, 25 primera visita, 30/15
      // combo) — validado contra la config SSOT + día laboral activo.
      const businessDay = promoBusinessDay(req.body);
      let pricing;
      if (item.promo_type) {
        pricing = resolvePromoUnitPrice(db, menuItem, item.promo_type, { businessDay });
      } else {
        pricing = resolveItemUnitPrice(db, menuItem, {
          manualPrice: item.manual_price,
          applyPromo: item.apply_promo === true,
          modifiers: item.modifiers,
        });
      }
      if (pricing.error) {
        return res.status(400).json({
          success: false,
          error: pricing.error.message,
          code: pricing.error.code,
          menu_item_id: item.menu_item_id,
        });
      }
      const { summary } = resolveModifierAdjustment(db, menuItem.id, item.modifiers);
      const unitPrice = pricing.unitPrice;
      const itemSubtotal = round2(unitPrice * quantity);

      subtotal += itemSubtotal;

      orderItems.push({
        id: item.id || randomUUID(),
        menu_item_id: menuItem.id,
        menu_item_name: menuItem.name,
        quantity,
        unit_price: unitPrice,
        subtotal: itemSubtotal,
        promo_label: pricing.promoLabel,
        promo_type: item.promo_type || null,
        promo_category: categoryNameOf(db, menuItem),
        modifiers_json: summary.length > 0 ? JSON.stringify(summary) : null,
        preparation_notes: item.notes || '',
        status: 'pending',
        kds_module: item.kds_module || menuItem.area || 'cocina',
      });
    }

    // Sprint Promos: validar reglas de contexto por tipo de promo (par 2x1,
    // una vez primera visita, par combo) sobre el pedido completo.
    const promoTypes = [...new Set(orderItems.map(oi => oi.promo_type).filter(Boolean))];
    for (const promoType of promoTypes) {
      const ctx = validatePromoContext(
        orderItems.map(oi => ({ categoryName: oi.promo_category, promoType: oi.promo_type, quantity: oi.quantity })),
        promoType,
        promoBusinessDay(req.body)
      );
      if (!ctx.valid) {
        return res.status(400).json({ success: false, error: ctx.message, code: ctx.code });
      }
    }

    // Modelo SSOT EXTRACTIVO (precio INCLUYE IVA): `subtotal` acumulado es
    // la suma de precios (gross). total = gross, subtotal(base) = gross/1.13.
    const { subtotal: baseSubtotal, iva, total } = computeTotals(subtotal);
    const orderId = randomUUID();

    // FASE 4A: el mesero crea la orden en UNA llamada → status 'confirmed'
    // directo (adiós draft→called→confirm). El broadcast new_order al KDS
    // se emite aquí (status real). Los items nuevos van a la RONDA 1.
    db.prepare(`
      INSERT INTO orders (id, table_id, table_number, waiter_id, waiter_name, status,
                          subtotal, iva_amount, discount, discount_reason, total,
                          notes, guest_count, local_id, is_paid)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, '', ?, ?, ?, ?, 0)
    `).run(
      orderId, table_id, table.number, req.user.sub,
      req.user.displayName || req.user.username,
      'confirmed', baseSubtotal, iva, total,
      notes || '', guest_count || 1, local_id || orderId
    );

    const insertItem = db.prepare(`
      INSERT INTO order_items (id, order_id, menu_item_id, menu_item_name, quantity,
                               unit_price, modifiers_json, subtotal, status, round, preparation_notes, promo_label, promo_type)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const oi of orderItems) {
      insertItem.run(oi.id, orderId, oi.menu_item_id, oi.menu_item_name, oi.quantity,
                     oi.unit_price, oi.modifiers_json, oi.subtotal, oi.status, 1, oi.preparation_notes,
                     oi.promo_label, oi.promo_type);
    }

    // Mark table as ordered (pedido confirmado en cocina/bar)
    db.prepare("UPDATE tables SET status = 'ordered', current_order_id = ? WHERE id = ?").run(orderId, table_id);

    const order = buildOrder(db, orderId);
    // FASE 4A: broadcast inmediato — el KDS ve la orden nueva al instante
    broadcastOrderCreated(order);
    res.status(201).json({ success: true, order });
  } catch (err) {
    logger.error('[Orders] Create error:', err.message);
    res.status(500).json({ success: false, error: 'Error al crear pedido', code: 'ORDER_CREATE_ERROR' });
  }
});

// ============================================================
// PUT /api/orders/:id — Actualizar pedido (items, notes) INCREMENTAL
//
// FASE 2 (2.5): ANTES hacía DELETE + INSERT de TODOS los items → lost
// update si otro agente (KDS cancelando items, otro mesero) tocaba el
// pedido a la vez. Ahora es INCREMENTAL:
//
//   { notes?, items: [{ id?, menu_item_id, quantity, modifiers? }], remove_item_ids?: [] }
//
//   - item con `id` existente            → UPDATE (cantidad/modifiers)
//   - item sin `id` (o id no pertenece)  → INSERT (nuevo)
//   - remove_item_ids                    → DELETE solo esos
//   - items NO mencionados               → se CONSERVAN
//   - el server RECALCULA subtotal/iva/total (SSOT iva.js)
//
// Retrocompat: si el cliente manda la lista completa sin ids, los items se
// insertan como nuevos y NO se elimina nada (la eliminación solo es
// explícita vía remove_item_ids).
// ============================================================

router.put('/:id', requireAuth, requireRole('admin', 'mesero'), (req, res) => {
  try {
    const { notes, items, remove_item_ids } = req.body;
    const db = getDb();

    const existing = db.prepare('SELECT id, status FROM orders WHERE id = ?').get(req.params.id);
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Pedido no encontrado', code: 'ORDER_NOT_FOUND' });
    }

    if (['paid', 'cancelled'].includes(existing.status)) {
      return res.status(409).json({ success: false, error: 'Pedido ya completado o cancelado', code: 'ORDER_CLOSED' });
    }

    // Update notes
    if (notes !== undefined) {
      db.prepare("UPDATE orders SET notes = ? WHERE id = ?").run(notes, req.params.id);
    }

    const itemsChanged =
      (Array.isArray(items) && items.length > 0) ||
      (Array.isArray(remove_item_ids) && remove_item_ids.length > 0);

    if (itemsChanged) {
      // P2-3 (2026-08-11): validar TODA la entrada ANTES de la transacción.
      // ANTES, qty inválida (<1) hacía `continue` silencioso → el cliente
      // creía que cambió la cantidad cuando no se tocó nada. Ahora → 400.
      if (Array.isArray(items) && items.length > 0) {
        for (const item of items) {
          const quantity = item.quantity ?? 1;
          if (!Number.isFinite(quantity) || quantity < 1) {
            return res.status(400).json({
              success: false,
              error: `Cantidad inválida (debe ser ≥ 1): ${item.id || item.menu_item_id || 'item sin id'}`,
              code: 'INVALID_QUANTITY',
            });
          }
          const menuItem = db.prepare(
            'SELECT id, name, price, price_variable, promo_price FROM menu_items WHERE id = ? AND is_active = 1'
          ).get(item.menu_item_id);
          if (!menuItem) {
            return res.status(400).json({
              success: false,
              error: `Item inválido: ${item.menu_item_id}`,
              code: 'INVALID_MENU_ITEM',
            });
          }
          // Sprint 1 (B/E): validar pricing (manual/promo) ANTES de la transacción
          // Sprint Promos: si la línea trae `promo_type` se valida contra la
          // config SSOT + día laboral activo (nunca acepta precios del cliente).
          const businessDay = promoBusinessDay(req.body);
          const pricing = item.promo_type
            ? resolvePromoUnitPrice(db, menuItem, item.promo_type, { businessDay })
            : resolveItemUnitPrice(db, menuItem, {
                manualPrice: item.manual_price,
                applyPromo: item.apply_promo === true,
                modifiers: item.modifiers,
              });
          if (pricing.error) {
            return res.status(400).json({
              success: false,
              error: pricing.error.message,
              code: pricing.error.code,
              menu_item_id: item.menu_item_id,
            });
          }
          item._promoCategory = item.promo_type ? pricing.promoCategory : null;
        }
      }

      const runUpdate = db.transaction(() => {
        const currentIds = db.prepare('SELECT id FROM order_items WHERE order_id = ?')
          .all(req.params.id).map(r => r.id);
        const currentIdSet = new Set(currentIds);

        // 1) Eliminación SOLO explícita
        if (Array.isArray(remove_item_ids) && remove_item_ids.length > 0) {
          const placeholders = remove_item_ids.map(() => '?').join(',');
          db.prepare(`DELETE FROM order_items WHERE order_id = ? AND id IN (${placeholders})`)
            .run(req.params.id, ...remove_item_ids);
        }

        // 2) Upsert incremental por item
        if (Array.isArray(items) && items.length > 0) {
          const getMenuItem = db.prepare(
            'SELECT id, name, price, price_variable, promo_price FROM menu_items WHERE id = ? AND is_active = 1'
          );
          const updateItem = db.prepare(`
            UPDATE order_items
            SET quantity = ?, unit_price = ?, modifiers_json = ?, subtotal = ?,
                preparation_notes = ?, promo_label = ?, promo_type = ?
            WHERE id = ? AND order_id = ?
          `);
          const insertItem = db.prepare(`
            INSERT INTO order_items (id, order_id, menu_item_id, menu_item_name, quantity,
                                     unit_price, modifiers_json, subtotal, status, round, preparation_notes, promo_label, promo_type)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)
          `);

          // FASE 4B: los items NUEVOS de esta tanda van a la MISMA ronda.
          // resolveRound se calcula UNA vez (antes de insertar) para que los
          // nuevos de la misma petición compartan ronda: si la orden aún tiene
          // trabajo sin procesar → misma ronda; si todo ya se procesó → ronda
          // nueva (max+1) → el KDS la ve como tarjeta separada prioritaria.
          let newItemsRound = null;
          let insertedNew = false;

          for (const item of items) {
            const menuItem = getMenuItem.get(item.menu_item_id);
            if (!menuItem) continue;

            const quantity = item.quantity ?? 1;
            if (!Number.isFinite(quantity) || quantity < 1) continue;

            // Sprint 1 (B/E): pricing server-side (manual + promo) — ya validado
            // arriba en la pre-validación; aquí se recalcula para persistir.
            const businessDay = promoBusinessDay(req.body);
            const pricing = item.promo_type
              ? resolvePromoUnitPrice(db, menuItem, item.promo_type, { businessDay })
              : resolveItemUnitPrice(db, menuItem, {
                  manualPrice: item.manual_price,
                  applyPromo: item.apply_promo === true,
                  modifiers: item.modifiers,
                });
            if (pricing.error) continue; // defensivo — la pre-validación ya lo rechazó

            const { summary } = resolveModifierAdjustment(db, menuItem.id, item.modifiers);
            const unitPrice = pricing.unitPrice;
            const itemSubtotal = round2(unitPrice * quantity);
            const modifiersJson = summary.length > 0 ? JSON.stringify(summary) : null;
            const notesField = item.notes || '';
            const promoTypeField = item.promo_type || null;

            if (item.id && currentIdSet.has(item.id)) {
              updateItem.run(quantity, unitPrice, modifiersJson, itemSubtotal, notesField,
                             pricing.promoLabel, promoTypeField, item.id, req.params.id);
            } else {
              // sin id, o id que no pertenece a este pedido → nuevo
              if (newItemsRound === null) newItemsRound = resolveRound(db, req.params.id);
              insertItem.run(item.id || randomUUID(), req.params.id, menuItem.id, menuItem.name,
                             quantity, unitPrice, modifiersJson, itemSubtotal, newItemsRound, notesField,
                             pricing.promoLabel, promoTypeField);
              insertedNew = true;
            }
          }

          // Sprint Promos: validar reglas de contexto (par 2x1, una vez
          // primera visita, par combo) contra el estado REAL post-cambios.
          // Si falla → throw → rollback de la transacción completa.
          const promoLines = db.prepare(`
            SELECT oi.promo_type, oi.quantity, mc.name as categoryName
            FROM order_items oi
            LEFT JOIN menu_items mi ON oi.menu_item_id = mi.id
            LEFT JOIN menu_categories mc ON mi.category_id = mc.id
            WHERE oi.order_id = ?
          `).all(req.params.id);
          const promoTypes = [...new Set(promoLines.map(l => l.promo_type).filter(Boolean))];
          for (const promoType of promoTypes) {
            const ctx = validatePromoContext(
              promoLines.map(l => ({ categoryName: l.categoryName, promoType: l.promo_type, quantity: l.quantity })),
              promoType,
              promoBusinessDay(req.body)
            );
            if (!ctx.valid) {
              const err = new Error(ctx.message);
              err.code = ctx.code;
              throw err;
            }
          }
          return { insertedNew };
        }
        return { insertedNew: false };
      });
      const { insertedNew } = runUpdate();

      // 3) Recalcular siempre que cambió algo (SSOT)
      recalcOrder(db, req.params.id);
      // FASE 4B: estados derivados — si la orden estaba served/ready y se
      // agregó una ronda nueva, vuelve a 'confirmed' (el KDS la ve de nuevo).
      const derived = recalcOrderStatus(db, req.params.id);
      // FASE 4B: broadcast — ronda nueva → new_order al KDS (tarjeta
      // separada); solo updates/removes → status_change.
      const updated = buildOrder(db, req.params.id);
      if (insertedNew) {
        broadcastOrderCreated(updated);
      } else {
        broadcastOrderStatusChange(updated, existing.status);
      }
      res.json({ success: true, order: updated, status: derived });
    } else {
      const updated = buildOrder(db, req.params.id);
      broadcastOrderStatusChange(updated, existing.status);
      res.json({ success: true, order: updated });
    }
  } catch (err) {
    if (err?.code === 'PROMO_CONTEXT_VIOLATION') {
      return res.status(400).json({ success: false, error: err.message, code: err.code });
    }
    logger.error('[Orders] Update error:', err.message);
    res.status(500).json({ success: false, error: 'Error al actualizar pedido', code: 'ORDER_UPDATE_ERROR' });
  }
});

// ============================================================
// PATCH /api/orders/:id/submit — draft → called (client sends to mesero)
// ============================================================

router.patch('/:id/submit', requireAuth, (req, res) => {
  try {
    const db = getDb();
    const existing = db.prepare('SELECT id, status, table_id FROM orders WHERE id = ?').get(req.params.id);
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Pedido no encontrado', code: 'ORDER_NOT_FOUND' });
    }

    if (existing.status !== 'draft') {
      return res.status(409).json({
        success: false,
        error: `Solo se pueden enviar pedidos en borrador. Estado actual: ${existing.status}`,
        code: 'ORDER_NOT_DRAFT',
        current: existing.status,
      });
    }

    db.prepare("UPDATE orders SET status = 'called', updated_at = datetime('now') WHERE id = ?")
      .run(req.params.id);

    res.json({ success: true, status: 'called', message: 'Pedido enviado al mesero' });
  } catch (err) {
    logger.error('[Orders] Submit error:', err.message);
    res.status(500).json({ success: false, error: 'Error al enviar pedido', code: 'ORDER_SUBMIT_ERROR' });
  }
});

// ============================================================
// PATCH /api/orders/:id/confirm — called → confirmed (mesero action)
// ============================================================

router.patch('/:id/confirm', requireAuth, requireRole('admin', 'mesero'), (req, res) => {
  try {
    const db = getDb();
    const existing = db.prepare('SELECT id, status, table_id, table_number FROM orders WHERE id = ?').get(req.params.id);
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Pedido no encontrado', code: 'ORDER_NOT_FOUND' });
    }

    if (existing.status !== 'called') {
      return res.status(409).json({
        success: false,
        error: `Solo se pueden confirmar pedidos llamados. Estado actual: ${existing.status}`,
        code: 'ORDER_NOT_CALLED',
        current: existing.status,
      });
    }

    // Assign confirming mesero (client-created orders start with placeholder)
    const waiterId = req.user?.sub || existing.waiter_id;
    const waiterName = req.user?.displayName || 'Mesero';
    db.prepare(
      "UPDATE orders SET status = 'confirmed', waiter_id = ?, waiter_name = ?, updated_at = datetime('now') WHERE id = ?"
    ).run(waiterId, waiterName, req.params.id);

    // Mark table as ordered
    db.prepare("UPDATE tables SET status = 'ordered' WHERE id = ?").run(existing.table_id);

    // Broadcast new_order to KDS (cocina + bar) — status real 'confirmed'
    const order = buildOrder(db, req.params.id);
    broadcastOrderCreated(order);

    res.json({ success: true, status: 'confirmed', message: 'Pedido confirmado' });
  } catch (err) {
    logger.error('[Orders] Confirm error:', err.message);
    res.status(500).json({ success: false, error: 'Error al confirmar pedido', code: 'ORDER_CONFIRM_ERROR' });
  }
});

// ============================================================
// PATCH /api/orders/:id/status — Cambiar estado del pedido
// ============================================================

// B1 (2026-08-13): solo admin/mesero cambian el estado global del pedido.
// kds (cocina/barra) y caja cobran por sus rutas propias (items/:id/status
// y POST /api/payments) — no pueden tocar el flujo global de la orden.
router.patch('/:id/status', requireAuth, requireRole('admin', 'mesero'), (req, res) => {
  try {
    const { status } = req.body;

    const canonical = ORDER_STATUS_MAP[status];
    if (!canonical) {
      return res.status(400).json({
        success: false,
        error: `Estado inválido. Use: ${Object.keys(ORDER_STATUS_MAP).join(', ')}`,
        code: 'INVALID_STATUS',
      });
    }

    const db = getDb();
    const existing = db.prepare('SELECT id, status, table_id FROM orders WHERE id = ?').get(req.params.id);
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Pedido no encontrado', code: 'ORDER_NOT_FOUND' });
    }

    // Enforce status flow (forward only; cancel any time)
    const flow = ['draft', 'called', 'confirmed', 'preparing', 'ready', 'served', 'paid'];
    const currentIdx = flow.indexOf(existing.status);
    const nextIdx = flow.indexOf(canonical);

    if (canonical !== 'cancelled' && nextIdx < currentIdx) {
      return res.status(409).json({
        success: false,
        error: 'No se puede retroceder el estado del pedido',
        code: 'STATUS_FLOW_ERROR',
        current: existing.status,
        requested: canonical,
      });
    }

    const now = new Date().toISOString();
    db.prepare("UPDATE orders SET status = ?, synced_at = ?, updated_at = datetime('now') WHERE id = ?")
      .run(canonical, now, req.params.id);

    // C3 (Fase 1 — caja cuadre al centavo): INVARIANTE — un pedido SOLO
    // puede pasar a 'paid' si hay pago COMPLETO registrado (completed).
    // El flujo normal: POST /api/payments marca paid automáticamente cuando
    // SUM(amount) >= total; este PATCH a 'paid' solo es válido si ya
    // existe ese pago. Sin él → 409 (nunca is_paid=1 sin pago).
    if (canonical === 'paid') {
      const orderTotal = db.prepare('SELECT total FROM orders WHERE id = ?').get(req.params.id);
      const paidSum = db.prepare(`
        SELECT COALESCE(SUM(amount), 0) as total FROM payments
        WHERE order_id = ? AND status = 'completed'
      `).get(req.params.id);
      if ((paidSum?.total || 0) < (orderTotal?.total || 0)) { // v11: centavos exactos
        return res.status(409).json({
          success: false,
          error: 'No se puede marcar como pagado: falta registrar el pago completo',
          code: 'PAYMENT_REQUIRED',
        });
      }
      db.prepare("UPDATE orders SET is_paid = 1, paid_at = COALESCE(paid_at, datetime('now')) WHERE id = ?")
        .run(req.params.id);
    }

    // If paid or cancelled, free the table (if no other active orders)
    if (canonical === 'paid' || canonical === 'cancelled') {
      const activeOrders = db.prepare(
        "SELECT id FROM orders WHERE table_id = ? AND status NOT IN ('paid','cancelled') AND id != ?"
      ).get(existing.table_id, req.params.id);

      if (!activeOrders) {
        db.prepare("UPDATE tables SET status = 'free', current_order_id = NULL WHERE id = ?")
          .run(existing.table_id);
      }
    }

    // Broadcast status_change to KDS so cocina + bar re-render.
    // If the new state is "ready" and all items are ready, also notify meseros.
    const orderForWs = buildOrder(db, req.params.id);
    broadcastOrderStatusChange(orderForWs, existing.status);

    res.json({ success: true, status: canonical, message: `Pedido ${canonical}` });
  } catch (err) {
    logger.error('[Orders] Status error:', err.message);
    res.status(500).json({ success: false, error: 'Error al cambiar estado', code: 'ORDER_STATUS_ERROR' });
  }
});

// ============================================================
// POST /api/orders/:id/items — Agregar item a pedido existente
// ============================================================

router.post('/:id/items', requireAuth, requireRole('admin', 'mesero'), (req, res) => {
  try {
    const { menu_item_id, quantity, notes, modifiers } = req.body;
    const promoType = req.body.promo_type || null;

    if (!menu_item_id) {
      return res.status(400).json({ success: false, error: 'Item requerido', code: 'ITEM_REQUIRED' });
    }

    const db = getDb();
    const order = db.prepare('SELECT id, status FROM orders WHERE id = ?').get(req.params.id);
    if (!order) {
      return res.status(404).json({ success: false, error: 'Pedido no encontrado', code: 'ORDER_NOT_FOUND' });
    }

    if (['paid', 'cancelled'].includes(order.status)) {
      return res.status(409).json({ success: false, error: 'Pedido cerrado', code: 'ORDER_CLOSED' });
    }

    const menuItem = db.prepare('SELECT id, name, price, price_variable, promo_price FROM menu_items WHERE id = ? AND is_active = 1').get(menu_item_id);
    if (!menuItem) {
      return res.status(404).json({ success: false, error: 'Item de menú no encontrado', code: 'MENU_ITEM_NOT_FOUND' });
    }

    const qty = quantity ?? 1;
    if (!Number.isFinite(qty) || qty < 1) {
      return res.status(400).json({
        success: false,
        error: 'Cantidad inválida (debe ser ≥ 1)',
        code: 'INVALID_QUANTITY',
      });
    }

    // Sprint 1 (B/E): pricing server-side (manual + promo)
    // Sprint Promos: si viene `promo_type` se factura con el precio de la
    // promo (validado contra la config SSOT + día laboral activo).
    const businessDay = promoBusinessDay(req.body);
    const pricing = promoType
      ? resolvePromoUnitPrice(db, menuItem, promoType, { businessDay })
      : resolveItemUnitPrice(db, menuItem, {
          manualPrice: req.body.manual_price,
          applyPromo: req.body.apply_promo === true,
          modifiers,
        });
    if (pricing.error) {
      return res.status(400).json({
        success: false,
        error: pricing.error.message,
        code: pricing.error.code,
        menu_item_id,
      });
    }
    const unitPrice = pricing.unitPrice;
    const itemSubtotal = round2(unitPrice * qty);

    // Sprint Promos: validar contexto (par 2x1, una vez primera visita,
    // par combo) contra el estado REAL del pedido + el item nuevo.
    if (promoType) {
      const promoLines = db.prepare(`
        SELECT oi.promo_type, oi.quantity, mc.name as categoryName
        FROM order_items oi
        LEFT JOIN menu_items mi ON oi.menu_item_id = mi.id
        LEFT JOIN menu_categories mc ON mi.category_id = mc.id
        WHERE oi.order_id = ?
      `).all(req.params.id);
      promoLines.push({ promo_type: promoType, quantity: qty, categoryName: pricing.promoCategory });
      const ctx = validatePromoContext(
        promoLines.map(l => ({ categoryName: l.categoryName, promoType: l.promo_type, quantity: l.quantity })),
        promoType,
        businessDay
      );
      if (!ctx.valid) {
        return res.status(400).json({ success: false, error: ctx.message, code: ctx.code });
      }
    }

    // FASE 4B: ronda — misma si hay trabajo sin procesar, nueva si todo se procesó
    const round = resolveRound(db, req.params.id);
    db.prepare(`
      INSERT INTO order_items (id, order_id, menu_item_id, menu_item_name, quantity,
                               unit_price, modifiers_json, subtotal, status, round, preparation_notes, promo_label, promo_type)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)
    `).run(randomUUID(), req.params.id, menuItem.id, menuItem.name, qty, unitPrice,
           modifiers ? JSON.stringify(modifiers) : null, itemSubtotal, round, notes || '',
           pricing.promoLabel, promoType);

    recalcOrder(db, req.params.id);
    // FASE 4B: estados derivados (reactiva a 'confirmed' si estaba served/ready)
    const derived = recalcOrderStatus(db, req.params.id);

    // FASE 4B: broadcast new_order → el KDS ve la ronda nueva al instante
    const updated = buildOrder(db, req.params.id);
    broadcastOrderCreated(updated);

    res.status(201).json({ success: true, message: 'Item agregado al pedido', status: derived });
  } catch (err) {
    logger.error('[Orders] Add item error:', err.message);
    res.status(500).json({ success: false, error: 'Error al agregar item', code: 'ORDER_ADD_ITEM_ERROR' });
  }
});

// ============================================================
// PATCH /api/orders/:id/items/:itemId/status — Persistir estado de item KDS
//
// FASE 2 (circuito cerrado): el KDS marcaba items solo en memoria del
// cliente; este endpoint persiste order_items.status y emite broadcast
// para que meseros/otros KDS vean el cambio en tiempo real.
//   body: { status: pending|preparing|ready|delivered|cancelled }
// Roles: kds o admin (el bartender/cocinero marca sus items).
// ============================================================

router.patch('/:id/items/:itemId/status', requireAuth, requireRole('admin', 'kds'), (req, res) => {
  try {
    const { status } = req.body;
    const canonical = ITEM_STATUS_MAP[status];
    if (!canonical) {
      return res.status(400).json({
        success: false,
        error: `Estado de item inválido. Use: ${Object.keys(ITEM_STATUS_MAP).join(', ')}`,
        code: 'INVALID_ITEM_STATUS',
      });
    }

    const db = getDb();
    const item = db.prepare('SELECT id, order_id FROM order_items WHERE id = ? AND order_id = ?')
      .get(req.params.itemId, req.params.id);
    if (!item) {
      return res.status(404).json({ success: false, error: 'Item no encontrado en el pedido', code: 'ORDER_ITEM_NOT_FOUND' });
    }

    // Persistir estado del item
    db.prepare("UPDATE order_items SET status = ? WHERE id = ?")
      .run(canonical, req.params.itemId);

    // P0-FIX (2026-08-11 flujo mixto): aviso PARCIAL por módulo. Cuando el
    // bartender marca SU item (bar), y ese módulo completa TODOS sus items,
    // el mesero recibe "barra lista" — SIN cerrar el pedido de cocina. El
    // circuito se cierra (order_complete) solo cuando TODOS los módulos
    // terminaron (isOrderFullyReady más abajo). ANTES, un item de un módulo
    // con status no-ready ('delivered') pisaba el status del pedido en el
    // engine del otro módulo → el pedido desaparecía del KDS como cerrado.
    const moduleSnapshot = buildOrder(db, req.params.id);
    const changedItem = moduleSnapshot.items.find((i) => i.id === req.params.itemId);
    const changedModule = changedItem?.kds_module || 'cocina';
    if (isModuleFullyReady(moduleSnapshot, changedModule)) {
      broadcastModuleReady(moduleSnapshot, changedModule);
    }

    // FASE 4B: estados derivados — el status global se computa SOLO de los
    // items (pending→confirmed, preparing→preparing, ready→ready, todos
    // terminales→served). Reemplaza la lógica manual served/ready anterior.
    recalcOrderStatus(db, req.params.id);

    // Broadcast real-time: item_ready cuando queda listo, status_change en el resto
    const orderForWs = buildOrder(db, req.params.id);
    const itemPayload = orderForWs.items.find(i => i.id === req.params.itemId) || { id: req.params.itemId };

    if (canonical === 'ready') {
      broadcaster.broadcastKDS(buildKDSEvent(KDSEventType.ITEM_READY, {
        orderId: req.params.id,
        tableNumber: orderForWs.table_number,
        itemId: req.params.itemId,
        status: 'ready',
        items: [itemPayload],
      }));

      // S2-A: si este era el último item en quedar listo, el pedido está
      // completo para servir → avisar al mesero (order_complete). El KDS
      // marca item a item y NUNCA llama PATCH /:id/status 'ready', así que
      // este es el único punto donde el pedido real emite order_complete.
      if (isOrderFullyReady(orderForWs)) {
        broadcastOrderComplete(orderForWs);
      }
    } else {
      broadcaster.broadcastKDS(buildKDSEvent(KDSEventType.STATUS_CHANGE, {
        orderId: req.params.id,
        tableNumber: orderForWs.table_number,
        itemId: req.params.itemId,
        status: canonical,
        items: [itemPayload],
      }));
    }

    res.json({ success: true, itemId: req.params.itemId, status: canonical });
  } catch (err) {
    logger.error('[Orders] Item status error:', err.message);
    res.status(500).json({ success: false, error: 'Error al cambiar estado del item', code: 'ORDER_ITEM_STATUS_ERROR' });
  }
});

// ============================================================
// PATCH /api/orders/:id/kds-status — FASE 4C: flujo KDS 2 CLICKS
//
// La tarjeta KDS (cocina/bar) es el PEDIDO COMPLETO de UN módulo+ronda.
// El cocinero/bartender NO toca items individuales — solo 2 botones:
//
//   Click 1 — "▶ Iniciar"    → { status: 'preparing' } → TODOS los items
//            pending de (order, module, round) pasan a 'preparing'.
//   Click 2 — "✓ Listo"      → { status: 'ready' } → TODOS los items
//            pending/preparing de (order, module, round) pasan a 'ready'
//            → llama al mesero (module_ready) y cierra el ciclo.
//
// body: { status: 'preparing' | 'ready', module?: 'bar'|'cocina', round?: number }
//   - module: obligatorio en la práctica (el KDS sabe qué módulo es);
//     si falta → aplica a TODOS los módulos (defensivo).
//   - round: la tarjeta que el KDS está procesando; si falta → la ronda
//     MÁS ALTA con items activos (defensivo).
// Roles: kds o admin.
// ============================================================

router.patch('/:id/kds-status', requireAuth, requireRole('admin', 'kds'), (req, res) => {
  try {
    const { status, module, round } = req.body || {};
    const canonical = status === 'preparing' ? 'preparing' : status === 'ready' ? 'ready' : null;
    if (!canonical) {
      return res.status(400).json({
        success: false,
        error: "Estado inválido. Use: 'preparing' o 'ready'",
        code: 'INVALID_KDS_STATUS',
      });
    }

    const db = getDb();
    const order = db.prepare('SELECT id, status FROM orders WHERE id = ?').get(req.params.id);
    if (!order) {
      return res.status(404).json({ success: false, error: 'Pedido no encontrado', code: 'ORDER_NOT_FOUND' });
    }
    if (['paid', 'cancelled'].includes(order.status)) {
      return res.status(409).json({ success: false, error: 'Pedido cerrado', code: 'ORDER_CLOSED' });
    }

    // Resolver la ronda objetivo: la pasada o la más alta con items activos
    const moduleFilter = module && ['bar', 'cocina'].includes(module)
      ? `AND mi.area = ?` : '';
    const moduleParams = moduleFilter ? [module] : [];

    let targetRound = round;
    if (!targetRound) {
      const active = db.prepare(`
        SELECT COALESCE(MAX(oi.round), 1) as r
        FROM order_items oi
        LEFT JOIN menu_items mi ON oi.menu_item_id = mi.id
        WHERE oi.order_id = ? AND oi.status IN ('pending','preparing')
          ${moduleFilter}
      `).get(req.params.id, ...moduleParams);
      targetRound = Number(active?.r || 1);
    }

    // Items objetivo de la tarjeta (módulo + ronda)
    const roundFilter = 'AND oi.round = ?';
    const where = `WHERE oi.order_id = ? ${moduleFilter} ${roundFilter}`;
    const params = [req.params.id, ...moduleParams, targetRound];

    // Transición forward-only por estado objetivo
    const fromStatuses = canonical === 'preparing' ? ['pending'] : ['pending', 'preparing'];
    const placeholders = fromStatuses.map(() => '?').join(',');
    const targets = db.prepare(`
      SELECT oi.id FROM order_items oi
      LEFT JOIN menu_items mi ON oi.menu_item_id = mi.id
      ${where} AND oi.status IN (${placeholders})
    `).all(...params, ...fromStatuses);

    if (targets.length === 0) {
      return res.status(409).json({
        success: false,
        error: `No hay items en estado procesable para '${canonical}' en esa tarjeta`,
        code: 'NO_PROCESSABLE_ITEMS',
      });
    }

    const ids = targets.map(t => t.id);
    const idPlaceholders = ids.map(() => '?').join(',');
    db.prepare(`UPDATE order_items SET status = ? WHERE id IN (${idPlaceholders})`)
      .run(canonical, ...ids);

    // FASE 4B: estados derivados — el status global se computa de los items
    const derived = recalcOrderStatus(db, req.params.id);

    // Broadcasts real-time
    const orderForWs = buildOrder(db, req.params.id);
    const moduleForBroadcast = module && ['bar', 'cocina'].includes(module) ? module : null;

    broadcaster.broadcastKDS(buildKDSEvent(KDSEventType.STATUS_CHANGE, {
      orderId: req.params.id,
      tableNumber: orderForWs.table_number,
      status: derived,
      module: moduleForBroadcast,
      round: targetRound,
      items: orderForWs.items.filter(i =>
        i.round === targetRound && (!moduleForBroadcast || (i.kds_module || 'cocina') === moduleForBroadcast)
      ),
    }));

    if (canonical === 'ready') {
      // "✓ Listo" → llamar al mesero: aviso por módulo + order_complete si todo listo
      if (moduleForBroadcast && isModuleFullyReady(orderForWs, moduleForBroadcast)) {
        broadcastModuleReady(orderForWs, moduleForBroadcast);
      }
      if (isOrderFullyReady(orderForWs)) {
        broadcastOrderComplete(orderForWs);
      }
    }

    res.json({ success: true, status: derived, round: targetRound, itemsUpdated: ids.length });
  } catch (err) {
    logger.error('[Orders] KDS status error:', err.message);
    res.status(500).json({ success: false, error: 'Error al procesar tarjeta KDS', code: 'ORDER_KDS_STATUS_ERROR' });
  }
});

// ============================================================
// DELETE /api/orders/:id/items/:itemId — Quitar item
// ============================================================

router.delete('/:id/items/:itemId', requireAuth, requireRole('admin', 'mesero'), (req, res) => {
  try {
    const db = getDb();
    const orderItem = db.prepare('SELECT id, order_id FROM order_items WHERE id = ? AND order_id = ?').get(req.params.itemId, req.params.id);
    if (!orderItem) {
      return res.status(404).json({ success: false, error: 'Item no encontrado en el pedido', code: 'ORDER_ITEM_NOT_FOUND' });
    }

    db.prepare('DELETE FROM order_items WHERE id = ?').run(req.params.itemId);
    recalcOrder(db, req.params.id);
    // FASE 4B: estados derivados (al quitar items el status se recalcula)
    recalcOrderStatus(db, req.params.id);
    const updated = buildOrder(db, req.params.id);
    broadcastOrderStatusChange(updated, updated.status);

    res.json({ success: true, message: 'Item eliminado del pedido' });
  } catch (err) {
    logger.error('[Orders] Remove item error:', err.message);
    res.status(500).json({ success: false, error: 'Error al eliminar item', code: 'ORDER_REMOVE_ITEM_ERROR' });
  }
});

// ============================================================
// PATCH /api/orders/:id/deliver — mesero entrega items listos
//
// S2-B (Gap 4): el mesero NO podía marcar entregado (PATCH items/status
// es admin|kds → 403). Esta ruta dedicada (admin|mesero):
//   1. Exige que el pedido NO esté cerrado (paid/cancelled/served).
//   2. Exige al menos un item en 'ready' (no se entrega lo que no está).
//   3. Marca los items 'ready' → 'delivered'.
//      FASE 4C: filtro opcional { module?, round? } → entrega SOLO la
//      ronda de ese módulo (botón "Pedido Entregado" por ronda). Sin
//      filtro → entrega TODOS los ready (retrocompat).
//   4. FASE 4B: estados derivados → si no quedan items activos → 'served'
//      (lista para cobro); el KDS deja de mostrar la tarjeta.
//   5. Broadcast status_change (KDS + caja) para refrescar pantallas.
// ============================================================

router.patch('/:id/deliver', requireAuth, requireRole('admin', 'mesero'), (req, res) => {
  try {
    const { module, round } = req.body || {};
    const db = getDb();
    const existing = db.prepare('SELECT id, status, table_id FROM orders WHERE id = ?').get(req.params.id);
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Pedido no encontrado', code: 'ORDER_NOT_FOUND' });
    }

    if (['paid', 'cancelled', 'served'].includes(existing.status)) {
      return res.status(409).json({
        success: false,
        error: `El pedido ya fue servido o cerrado (estado: ${existing.status})`,
        code: 'ORDER_CLOSED',
        current: existing.status,
      });
    }

    // Filtro de items a entregar: { module, round } o TODOS los ready.
    // SQLite NO permite JOIN con alias en UPDATE → subquery para el módulo.
    const moduleWhere = module ? 'AND menu_item_id IN (SELECT id FROM menu_items WHERE area = ?)' : '';
    const moduleParams = module ? [module] : [];
    const roundWhere = round ? 'AND round = ?' : '';
    const roundParams = round ? [round] : [];

    const readyCount = db.prepare(`
      SELECT COUNT(*) as n FROM order_items oi
      LEFT JOIN menu_items mi ON oi.menu_item_id = mi.id
      WHERE oi.order_id = ? AND oi.status = 'ready'
        ${moduleWhere} ${roundWhere}
    `).get(req.params.id, ...moduleParams, ...roundParams);
    if (Number(readyCount.n) === 0) {
      return res.status(409).json({
        success: false,
        error: 'No hay items listos para entregar en esa ronda/módulo',
        code: 'NO_READY_ITEMS',
      });
    }

    // Marcar los items listos (filtrados) como entregados
    db.prepare(`
      UPDATE order_items SET status = 'delivered'
      WHERE order_id = ? AND status = 'ready'
        ${moduleWhere} ${roundWhere}
    `).run(req.params.id, ...moduleParams, ...roundParams);

    // FASE 4B: estados derivados — 'served' si no quedan items activos
    const derived = recalcOrderStatus(db, req.params.id);

    const orderForWs = buildOrder(db, req.params.id);
    broadcastOrderStatusChange(orderForWs, existing.status);

    res.json({ success: true, status: derived, message: 'Pedido marcado como entregado' });
  } catch (err) {
    logger.error('[Orders] Deliver error:', err.message);
    res.status(500).json({ success: false, error: 'Error al marcar pedido entregado', code: 'ORDER_DELIVER_ERROR' });
  }
});

export default router;
