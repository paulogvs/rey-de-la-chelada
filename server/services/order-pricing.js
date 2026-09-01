/**
 * ═══════════════════════════════════════════════════════════
 *  ORDER PRICING SERVICE — Precios de línea SSOT (server)
 *
 *  FASE 2 (2.2): el server SIEMPRE recalcula los precios de un pedido
 *  desde menu_items.price + modificadores resueltos por NOMBRE. Los
 *  montos que vengan del cliente (unit_price/subtotal/total) se ignoran:
 *  un cliente comprometido no puede facturar Bs 0.01.
 *
 *  MIGRACIÓN v11 (2026-08-19): REGLA MANDATORIA del ecosistema FORCH.iA
 *  (money-minor-units) — TODO dinero es ENTERO en CENTAVOS. La DB almacena
 *  INTEGER centavos y la config SSOT (promotions/iva) también. No hay
 *  floats de dinero aquí. La conversión a decimal solo ocurre en display.
 *
 *  v16 (2026-09-01): el SSOT src/core/config/promotions.js quedó ELIMINADO.
 *  Las promos se resuelven SOLO desde la DB vía promos-service, con el
 *  modelo A/B (price_mode/price_value):
 *    - FIXED     → price_value = total del pack (se reparte entre unidades)
 *    - MENU_PLUS → precio de línea = menu_item.price + price_value; con
 *                  línea de quantity>1 la 1ª unidad paga y el resto gratis
 *  La regla BOGO (2x1) ya no vive en código: se modela como MENU_PLUS 0 con
 *  línea de quantity 2 en la DB.
 * ═══════════════════════════════════════════════════════════
 */

import { computeTotals, round2, toCents } from '../../src/core/config/iva.js';
import { activePromosForBusinessDay, promoLineMatchesItem } from './promos-service.js';

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
    const adj = Number(opt.price_adjustment || 0); // INTEGER centavos
    adjustment += adj;
    summary.push({ groupName: m.groupName || '', optionName: opt.name, priceAdjustment: adj });
  }
  return { adjustment: Math.round(adjustment), summary };
}

/**
 * Normaliza un manualPrice del cliente (número o string "12,5" con coma
 * decimal del MoneyInput) → centavos enteros, o null si no es válido.
 * @param {*} value
 * @returns {number|null} centavos
 */
function parseManualPrice(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null;
    return Number.isInteger(value) ? value : toCents(value);
  }
  const normalized = String(value).trim().replace(',', '.');
  const n = Number(normalized);
  if (!Number.isFinite(n)) return null;
  return Number.isInteger(n) ? n : toCents(n);
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
 * v16: inyecta el EXTRA de la promo como sub-línea del item en los modifiers
 * (modifiers_json). Así el KDS lo ve preparar (optionName) y la caja NO lo
 * cobra aparte (priceAdjustment 0 — ya incluido o gratis según el modelo).
 * @param {Array} summary — modifiers resueltos del item (resolveModifierAdjustment)
 * @param {{ name: string }|null} promoExtra — extra de la promo (resolvePromoUnitPrice)
 * @returns {Array}
 */
export function mergePromoModifiers(summary, promoExtra) {
  if (!promoExtra) return Array.isArray(summary) ? summary : [];
  return [
    ...(Array.isArray(summary) ? summary : []),
    { groupName: 'Promo', optionName: promoExtra.name, priceAdjustment: 0 },
  ];
}

/**
 * ── Promos data-driven (DB) — v16 (2026-09-01) ────────────────────────────
 *
 * Las promos creadas en el panel Admin (tabla promos) llegan como
 * promo_type = promo.id (UUID). El SSOT (promotions.js) quedó eliminado;
 * el server las resuelve SOLO desde promos-service:
 *   - deben estar ACTIVAS en el businessDay (activePromosForBusinessDay)
 *   - el menu_item debe matchear una línea de la promo (promoLineMatchesItem)
 *   - precio: modelo A/B (price_mode/price_value):
 *       FIXED     → unit = price_value / totalUnits (split del pack)
 *       MENU_PLUS → unit = menu_item.price + price_value; si la línea es
 *                   única con quantity>1 (2x1) → (menú+ajuste)/quantity
 *                   (la 1ª unidad paga, el resto gratis).
 *   - `promoExtra` (opcional): el extra de la línea, para mostrarlo como
 *     sub-línea en el KDS/orden (price 0 dentro de la promo — no suma).
 */

/**
 * Resuelve el unit_price de una línea con PROMO (Sprint Promos, v16).
 *
 * Contrato (aprobado con el dueño):
 *   - La línea con `promo_type` (id de una promo de la DB) se factura con el
 *     precio de la promo según el modelo A/B. NUNCA acepta precios del cliente.
 *   - Valida: promo activa en el día laboral → item matchea una línea →
 *     precio según price_mode/price_value.
 *   - Las reglas de CONTEXTO (packs del pack, max_per_order) las valida
 *     validatePromoContext() en el route (necesitan el pedido completo).
 *
 * @param {object} db — better-sqlite3
 * @param {object} menuItem — { id, category_id, price }
 * @param {string} promoType — id de una promo de la DB
 * @param {{ businessDay?: string }} opts — 'YYYY-MM-DD' del día laboral
 * @returns {{ unitPrice: number|null, promoLabel: string|null, promoExtra?: { id: string, name: string, price: number }|null, error: { code: string, message: string }|null, promoCategory?: string|null }}
 */
export function resolvePromoUnitPrice(db, menuItem, promoType, { businessDay } = {}) {
  let active;
  try {
    active = activePromosForBusinessDay(businessDay);
  } catch {
    return { unitPrice: null, promoLabel: null, error: { code: 'INVALID_PROMO_TYPE', message: `Tipo de promo inválido: ${promoType}` } };
  }
  const promo = (active || []).find(p => p.id === promoType);
  if (!promo) {
    return { unitPrice: null, promoLabel: null, error: { code: 'INVALID_PROMO_TYPE', message: `Tipo de promo inválido o no activa: ${promoType}` } };
  }
  const line = (promo.lines || []).find(l => promoLineMatchesItem(l, menuItem));
  if (!line) {
    return {
      unitPrice: null,
      promoLabel: null,
      error: { code: 'PROMO_ITEM_NOT_ELIGIBLE', message: `${promo.label} no aplica a este item` },
    };
  }
  const lines = promo.lines || [];
  const totalUnits = Math.max(1, lines.reduce((s, l) => s + (l.quantity || 1), 0));
  const menuItemPrice = Number(menuItem.price) || 0;
  const priceValue = Number(promo.price_value) || 0;

  let unitPrice;
  if (promo.price_mode === 'MENU_PLUS') {
    const base = menuItemPrice + priceValue;
    // Pack único con quantity>1 (2x1/BOGO): la 1ª unidad paga, el resto gratis.
    if (lines.length === 1 && (lines[0].quantity || 1) > 1) {
      unitPrice = Math.round(base / (lines[0].quantity || 1));
    } else {
      unitPrice = base;
    }
  } else {
    // FIXED: price_value = total del pack → reparto por unidades.
    unitPrice = Math.round(priceValue / totalUnits);
  }

  // Extra de la línea → sub-línea KDS (price 0 dentro de la promo).
  let promoExtra = null;
  if (line.extra_id) {
    const extra = db.prepare('SELECT id, name, price FROM category_extras WHERE id = ?').get(line.extra_id);
    if (extra) promoExtra = { id: extra.id, name: extra.name, price: 0 };
  }

  return {
    unitPrice: round2(unitPrice),
    promoLabel: `PROMO - ${promo.label}`,
    promoCategory: categoryNameOf(db, menuItem),
    promoExtra,
    error: null,
  };
}

/**
 * Reglas de contexto para promos data-driven (DB, v16).
 * allLines puede incluir `itemId`/`categoryId` (los routes los enriquecen)
 * para validar que las líneas del pack estén presentes en el pedido +
 * max_per_order (packs por pedido).
 */
export function validatePromoContext(allLines, promoType, businessDay) {
  let active;
  try {
    active = activePromosForBusinessDay(businessDay);
  } catch {
    return { valid: true }; // DB sin schema → el route ya lo rechazó
  }
  const promo = (active || []).find(p => p.id === promoType);
  if (!promo) return { valid: true }; // promo no activa hoy → el route la rechazó

  const lines = (Array.isArray(allLines) ? allLines : []).filter(l => l && l.promoType === promoType);
  if (lines.length === 0) return { valid: true };

  const totalUnits = Math.max(1, (promo.lines || []).reduce((s, l) => s + (l.quantity || 1), 0));
  const promoUnits = lines.reduce((s, l) => s + (l.quantity || 1), 0);

  // 1) max_per_order: packs completos de la promo por pedido
  const maxPacks = promo.max_per_order || 1;
  if (promoUnits / totalUnits > maxPacks + 0.0001) {
    return {
      valid: false,
      code: 'PROMO_CONTEXT_VIOLATION',
      message: `${promo.label} se aplica hasta ${maxPacks} vez/veces por pedido`,
    };
  }

  // 2) líneas del pack presentes en el pedido (item_id directo o group_id
  //    = categoría del item). Sin itemId/categoryId (rutas omitidas) esta
  //    validación se omite — max_per_order ya protege.
  for (const line of promo.lines || []) {
    const need = line.quantity || 1;
    const have = (Array.isArray(allLines) ? allLines : []).reduce((s, l) => {
      if (!l) return s;
      const matches = (line.item_id && l.itemId === line.item_id) ||
                      (line.group_id && l.categoryId === line.group_id);
      return matches ? s + (l.quantity || 1) : s;
    }, 0);
    if (have < need) {
      return {
        valid: false,
        code: 'PROMO_CONTEXT_VIOLATION',
        message: `${promo.label} requiere ${need} unidad(es) de cada producto del pack`,
      };
    }
  }
  return { valid: true };
}

export default {
  resolveModifierAdjustment,
  resolveItemUnitPrice,
  resolvePromoUnitPrice,
  validatePromoContext,
  categoryNameOf,
  recalcOrder,
  mergePromoModifiers,
};
