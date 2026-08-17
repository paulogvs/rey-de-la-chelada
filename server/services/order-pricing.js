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
 * Normaliza un manualPrice del cliente (número o string "12,5" con coma
 * decimal del MoneyInput) → número finito, o null si no es válido.
 * @param {*} value
 * @returns {number|null}
 */
function parseManualPrice(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const normalized = String(value).trim().replace(',', '.');
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

/**
 * Resuelve el unit_price de una línea desde la DB (SSOT server-side).
 *
 * Sprint 1 (B/E): soporta precio manual ("Consultar precio", price_variable=1)
 * y promo manual (apply_promo → promo_price). Contrato:
 *
 *   - apply_promo && promo_price != null → unitPrice = promo_price (+mods),
 *     promoLabel = 'Promo' (la promo gana sobre el precio base y el manual)
 *   - apply_promo && promo_price == null → error NO_PROMO_FOR_ITEM
 *   - price != null                       → unitPrice = price (+mods)
 *   - price == null                       → manualPrice OBLIGATORIO > 0
 *     (price_variable=1 "Consultar precio", o promo display no facturable);
 *     si falta → error PRICE_REQUIRED_MANUAL. NUNCA facturar 0.
 *
 * @param {object} db — better-sqlite3
 * @param {object} menuItem — { id, price, price_variable, promo_price }
 * @param {{ manualPrice?: number|string, applyPromo?: boolean, modifiers?: Array }} opts
 * @returns {{ unitPrice: number|null, promoLabel: string|null, error: { code: string, message: string }|null, summary: Array }}
 */
export function resolveItemUnitPrice(db, menuItem, { manualPrice, applyPromo = false, modifiers } = {}) {
  const { adjustment, summary } = resolveModifierAdjustment(db, menuItem.id, modifiers);
  const promo = menuItem.promo_price == null ? null : Number(menuItem.promo_price);

  // 1. Promo manual (solo si el mesero la activó y el item tiene promo_price)
  if (applyPromo) {
    if (promo == null) {
      return {
        unitPrice: null,
        promoLabel: null,
        error: { code: 'NO_PROMO_FOR_ITEM', message: 'Este item no tiene precio promocional' },
        summary,
      };
    }
    return { unitPrice: round2(promo + adjustment), promoLabel: 'Promo', error: null, summary };
  }

  // 2. Precio base definido → precio normal del menú
  if (menuItem.price != null) {
    return { unitPrice: round2(Number(menuItem.price) + adjustment), promoLabel: null, error: null, summary };
  }

  // 3. Sin precio base (manual "Consultar precio", promo display o pizza cuyo
  //    price quedó null): el server NUNCA factura 0.
  //    a. manualPrice explícito del mesero → gana (Bs 0 no válido)
  //    b. sin manual → los modifiers pueden dar el precio (pizza con tamaño
  //       Familiar/XL: el ajuste ES el precio)
  //    c. si nada aporta precio → 400 PRICE_REQUIRED_MANUAL
  const manual = parseManualPrice(manualPrice);
  if (manual != null && manual > 0) {
    return { unitPrice: round2(manual + adjustment), promoLabel: null, error: null, summary };
  }
  if (adjustment > 0) {
    return { unitPrice: round2(adjustment), promoLabel: null, error: null, summary };
  }
  return {
    unitPrice: null,
    promoLabel: null,
    error: { code: 'PRICE_REQUIRED_MANUAL', message: 'Este item requiere un precio manual' },
    summary,
  };
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
