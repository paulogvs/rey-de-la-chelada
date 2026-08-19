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
import {
  promoById,
  promoUnitPrice,
  isPromotionActiveForDay,
  SIGNATURE_CATEGORY,
  ARTESANAL_CATEGORY,
} from '../../src/core/config/promotions.js';

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

/**
 * Nombre de la categoría de un menu_item (para resolver promos por
 * categoría — SSOT por nombre, igual que load-menu.js).
 * @param {object} db — better-sqlite3
 * @param {object} menuItem — { category_id }
 * @returns {string|null}
 */
export function categoryNameOf(db, menuItem) {
  const row = db.prepare('SELECT name FROM menu_categories WHERE id = ?').get(menuItem.category_id);
  return row ? row.name : null;
}

/**
 * Resuelve el unit_price de una línea con PROMO (Sprint Promos 2026-08-19).
 *
 * Contrato (aprobado con el dueño):
 *   - La línea con `promo_type` se factura con el precio de la promo
 *     (2x1 → 0, Miércoles de Barra → 12, Primera Visita → 25,
 *     Combo → 30 Signature / 15 Cerveza). NUNCA acepta precios del cliente.
 *   - Valida: tipo conocido → día laboral activo → categoría elegible.
 *   - Las reglas de CONTEXTO (par 2x1, una vez primera visita, par combo)
 *     las valida validatePromoContext() en el route (necesitan el pedido).
 *
 * @param {object} db — better-sqlite3
 * @param {object} menuItem — { id, category_id }
 * @param {string} promoType — '2x1' | 'barra' | 'combo' | 'primera-visita'
 * @param {{ businessDay?: string }} opts — 'YYYY-MM-DD' del día laboral
 * @returns {{ unitPrice: number|null, promoLabel: string|null, error: { code: string, message: string }|null }}
 */
export function resolvePromoUnitPrice(db, menuItem, promoType, { businessDay } = {}) {
  const promo = promoById(promoType);
  if (!promo) {
    return { unitPrice: null, promoLabel: null, error: { code: 'INVALID_PROMO_TYPE', message: `Tipo de promo inválido: ${promoType}` } };
  }
  if (promo.promoType === 'MODIFIER') {
    return { unitPrice: null, promoLabel: null, error: { code: 'PROMO_NOT_A_LINE', message: `${promo.name} es un adicional del item, no una línea propia` } };
  }
  if (!isPromotionActiveForDay(promoType, businessDay)) {
    return { unitPrice: null, promoLabel: null, error: { code: 'PROMO_NOT_ACTIVE', message: `${promo.name} no está activa este día laboral` } };
  }
  const categoryName = categoryNameOf(db, menuItem);
  if (promo.categoryName && categoryName !== promo.categoryName) {
    return { unitPrice: null, promoLabel: null, error: { code: 'PROMO_ITEM_NOT_ELIGIBLE', message: `${promo.name} aplica solo a ${promo.categoryName}` } };
  }
  if (promo.promoType === 'COMBO' && !promo.comboPrices?.[categoryName]) {
    return { unitPrice: null, promoLabel: null, error: { code: 'PROMO_ITEM_NOT_ELIGIBLE', message: `${promo.name} aplica solo a Signature + Cerveza Artesanal` } };
  }
  const price = promoUnitPrice(promo, categoryName);
  if (price == null) {
    return { unitPrice: null, promoLabel: null, error: { code: 'PROMO_NOT_A_LINE', message: `${promo.name} no define precio de línea` } };
  }
  return { unitPrice: round2(price), promoLabel: promo.label || promo.name, promoCategory: categoryName, error: null };
}

/**
 * Valida las reglas de CONTEXTO de una promo contra TODAS las líneas del
 * pedido (existentes + nuevas). Se llama UNA vez por tipo de promo en el
 * route, después de pre-validar cada línea con resolvePromoUnitPrice.
 *
 * Líneas: [{ categoryName, promoType, quantity }] (sin importar db).
 *
 * Reglas (SSOT):
 *   - BOGO (2x1): unidades gratis ≤ unidades pagadas de la categoría.
 *   - PRICE_OVERRIDE con oncePerOrder (Primera Visita): máx 1 unidad.
 *   - COMBO: pares Signature/Cerveza balanceados (misma cantidad, ≥1).
 *
 * @param {Array<{categoryName?: string|null, promoType?: string|null, quantity?: number}>} allLines
 * @param {string} promoType
 * @param {string} businessDay — 'YYYY-MM-DD' del día laboral
 * @returns {{ valid: boolean, code?: string, message?: string }}
 */
export function validatePromoContext(allLines, promoType, businessDay) {
  const promo = promoById(promoType);
  // Tipo desconocido o sin reglas de contexto → el route ya lo rechazó/no aplica.
  if (!promo) return { valid: true };
  const lines = (Array.isArray(allLines) ? allLines : []).filter(l => l && l.promoType === promoType);
  if (lines.length === 0) return { valid: true };
  // Si la promo no está activa hoy, el route lo rechaza antes (resolvePromoUnitPrice).
  if (!isPromotionActiveForDay(promoType, businessDay)) return { valid: true };

  const units = lines.reduce((s, l) => s + (l.quantity || 1), 0);
  const otherLines = (Array.isArray(allLines) ? allLines : []).filter(l => l && l.promoType !== promoType);

  switch (promo.promoType) {
    case 'BOGO': {
      const paidUnits = otherLines
        .filter(l => l.categoryName === promo.categoryName)
        .reduce((s, l) => s + (l.quantity || 1), 0);
      if (units > paidUnits) {
        return {
          valid: false,
          code: 'PROMO_CONTEXT_VIOLATION',
          message: 'El 2x1 requiere una Michelada Signature pagada por cada unidad gratis',
        };
      }
      return { valid: true };
    }
    case 'PRICE_OVERRIDE': {
      if (promo.oncePerOrder && units > 1) {
        return {
          valid: false,
          code: 'PROMO_CONTEXT_VIOLATION',
          message: `${promo.name} solo se aplica una vez por pedido`,
        };
      }
      return { valid: true };
    }
    case 'COMBO': {
      const sigUnits = lines.filter(l => l.categoryName === SIGNATURE_CATEGORY).reduce((s, l) => s + (l.quantity || 1), 0);
      const artUnits = lines.filter(l => l.categoryName === ARTESANAL_CATEGORY).reduce((s, l) => s + (l.quantity || 1), 0);
      if (sigUnits < 1 || artUnits < 1 || sigUnits !== artUnits) {
        return {
          valid: false,
          code: 'PROMO_CONTEXT_VIOLATION',
          message: 'El combo requiere 1 Michelada Signature + 1 Cerveza Artesanal por par',
        };
      }
      return { valid: true };
    }
    default:
      return { valid: true };
  }
}
