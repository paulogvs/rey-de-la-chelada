/**
 * ═══════════════════════════════════════════════════════════
 *  ORDER PRICING SERVICE — Precios de línea SSOT (server)
 *
 *  FASE 2 (2.2): el server SIEMPRE recalcula los precios de un pedido
 *  desde menu_items.price + modificadores resueltos por NOMBRE. Los
 *  montos que vengan del cliente (unit_price/subtotal/total) se ignoran:
 *  un cliente comprometido no puede facturar Bs 0.01.
 *
 *  Extraído de server/routes/orders.js (donde vivía resolveModifierAdjustment)
 *  para que sync.js (push offline) recalcule EXACTAMENTE igual que el
 *  POST /api/orders online. SSOT IVA: src/core/config/iva.js.
 * ═══════════════════════════════════════════════════════════
 */

import { computeTotals, round2 } from '../../src/core/config/iva.js';

/**
 * Resolve modifier adjustments for an order item from the DB.
 *
 * The mesero/clientes PWAs send modifiers as optionName (+priceAdjustment).
 * To keep server totals authoritative (SSOT), we look the options up by
 * name within the item's modifier groups and re-derive the adjustment.
 *
 * @param {object} db — better-sqlite3 instance
 * @param {string} menuItemId
 * @param {Array} modifiers — [{ groupName?, optionName, priceAdjustment? }]
 * @returns {{ adjustment: number, summary: Array }}
 */
export function resolveModifierAdjustment(db, menuItemId, modifiers) {
  const raw = Array.isArray(modifiers) ? modifiers : [];
  if (raw.length === 0) return { adjustment: 0, summary: [] };

  const groups = db.prepare(
    'SELECT id FROM modifier_groups WHERE menu_item_id = ?'
  ).all(menuItemId);
  if (groups.length === 0) return { adjustment: 0, summary: [] };

  const placeholders = groups.map(() => '?').join(',');
  const options = db.prepare(
    `SELECT id, name, price_adjustment FROM modifier_options
     WHERE group_id IN (${placeholders})`
  ).all(...groups.map(g => g.id));

  let adjustment = 0;
  const summary = [];
  for (const m of raw) {
    const opt = options.find(o => o.name === m.optionName);
    if (!opt) continue;
    const adj = Number(opt.price_adjustment || 0);
    adjustment += adj;
    summary.push({ groupName: m.groupName || '', optionName: opt.name, priceAdjustment: adj });
  }
  return { adjustment: Math.round(adjustment * 100) / 100, summary };
}

/**
 * Recalcula subtotal/iva/total de un pedido a partir de order_items.
 * (MISMO helper que server/routes/orders.js — SSOT para recalc.)
 *
 * @param {object} db — better-sqlite3
 * @param {string} orderId
 * @returns {{ subtotal: number, iva: number, total: number }}
 */
export function recalcOrder(db, orderId) {
  const sum = db.prepare('SELECT COALESCE(SUM(subtotal), 0) as subtotal FROM order_items WHERE order_id = ?').get(orderId);
  const grossTotal = round2(sum.subtotal || 0);
  const { subtotal, iva, total } = computeTotals(grossTotal);
  db.prepare('UPDATE orders SET subtotal = ?, iva_amount = ?, total = ? WHERE id = ?')
    .run(subtotal, iva, total, orderId);
  return { subtotal, iva, total };
}
