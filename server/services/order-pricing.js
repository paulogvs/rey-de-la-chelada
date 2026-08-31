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
 *  Extraído de server/routes/orders.js (donde vivía resolveModifierAdjustment)
 *  para que sync.js (push offline) recalcule EXACTAMENTE igual que el
 *  POST /api/orders online. SSOT IVA: src/core/config/iva.js.
 * ═══════════════════════════════════════════════════════════
 */

import { computeTotals, round2, toCents } from '../../src/core/config/iva.js';
import {
  promoById,
  promoUnitPrice,
  isPromotionActiveForDay,
  SIGNATURE_CATEGORY,
  ARTESANAL_CATEGORY,
} from '../../src/core/config/promotions.js';
import { activePromosForBusinessDay } from './promos-service.js'; // v15 FASE 3: promos data-driven (DB)

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
 * v11: el API espera CENTAVOS (contrato SSOT). Por tolerancia con clientes
 * legacy que aún manden Bs con decimales (ej. "10.5"), si el número NO es
 * entero se convierte con toCents() (10.5 → 1050). Un entero (1050) se
 * interpreta como centavos y pasa directo.
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
  //    a. manualPrice explícito del mesero → gana (Bs 0 no válido)
  //    b. sin manual → los modifiers pueden dar el precio (pizza con tamaño
  //       Familiar: el ajuste ES el precio)
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
 * ── Promos data-driven (DB) — v15 FASE 3 (2026-08-31) ────────────────────
 *
 * Las promos creadas en el panel Admin (tabla promos) llegan como
 * promo_type = promo.id (UUID). El SSOT (promotions.js) no las conoce, así
 * que el server las resuelve desde promos-service:
 *   - deben estar ACTIVAS en el businessDay (activePromosForBusinessDay)
 *   - el menu_item debe matchear una línea de la promo (item_id directo o
 *     group_id = categoría del item)
 *   - precio: reparto proporcional del price_total entre TODAS las unidades
 *     del pack (unitPrice = price_total / totalUnits) — el pack completo
 *     siempre suma price_total (2x1, combos, packs).
 */

function dbPromoForItem(promoType, businessDay, menuItem) {
  if (!businessDay || !promoType) return null;
  let active;
  try {
    active = activePromosForBusinessDay(businessDay);
  } catch {
    return null; // DB sin schema v15 → no hay promos data-driven
  }
  const promo = (active || []).find(p => p.id === promoType);
  if (!promo) return null;
  const line = (promo.lines || []).find(l =>
    (l.item_id && l.item_id === menuItem.id) ||
    (l.group_id && l.group_id === menuItem.category_id)
  );
  return { promo, line }; // line puede ser undefined (item no elegible)
}

/**
 * Resuelve el unit_price de una línea con PROMO (Sprint Promos 2026-08-19).
 *
 * Contrato (aprobado con el dueño):
 *   - La línea con `promo_type` se factura con el precio de la promo
 *     (2x1 → 0, Miércoles de Barra → 12, Primera Visita → 25,
 *     Combo → 30 Signature / 15 Cerveza). NUNCA acepta precios del cliente.
 *   - v15 FASE 3: promo_type también puede ser el id de una promo
 *     data-driven de la DB (panel Admin) — se valida activa en el día +
 *     líneas presentes (item_id/group_id) y se reparte el price_total.
 *   - Valida: tipo conocido → día laboral activo → categoría elegible.
 *   - Las reglas de CONTEXTO (par 2x1, una vez primera visita, par combo)
 *     las valida validatePromoContext() en el route (necesitan el pedido).
 *
 * @param {object} db — better-sqlite3
 * @param {object} menuItem — { id, category_id }
 * @param {string} promoType — '2x1' | 'barra' | 'combo' | 'primera-visita' | <promo-id DB>
 * @param {{ businessDay?: string }} opts — 'YYYY-MM-DD' del día laboral
 * @returns {{ unitPrice: number|null, promoLabel: string|null, error: { code: string, message: string }|null }}
 */
export function resolvePromoUnitPrice(db, menuItem, promoType, { businessDay } = {}) {
  const promo = promoById(promoType);
  if (!promo) {
    // v15 FASE 3: ¿promo data-driven de la DB?
    const dbMatch = dbPromoForItem(promoType, businessDay, menuItem);
    if (dbMatch) {
      if (!dbMatch.line) {
        return {
          unitPrice: null,
          promoLabel: null,
          error: {
            code: 'PROMO_ITEM_NOT_ELIGIBLE',
            message: `${dbMatch.promo.label || dbMatch.promo.name} no aplica a este item`,
          },
        };
      }
      const totalUnits = Math.max(1, dbMatch.promo.lines.reduce((s, l) => s + (l.quantity || 1), 0));
      const unitPrice = round2((dbMatch.promo.price_total || 0) / totalUnits);
      return {
        unitPrice,
        promoLabel: dbMatch.promo.label || dbMatch.promo.name,
        promoCategory: categoryNameOf(db, menuItem),
        error: null,
      };
    }
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
 * Reglas de contexto para promos data-driven (DB, v15 FASE 3).
 * allLines puede incluir `itemId`/`categoryId` (los routes los enriquecen)
 * para validar que las líneas del pack estén presentes en el pedido.
 */
function validateDbPromoContext(allLines, promoType, businessDay) {
  if (!businessDay) return { valid: true };
  let active;
  try {
    active = activePromosForBusinessDay(businessDay);
  } catch {
    return { valid: true }; // DB sin schema v15 → el route ya lo rechazó
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
      message: `${promo.label || promo.name} se aplica hasta ${maxPacks} vez/veces por pedido`,
    };
  }

  // 2) líneas del pack presentes en el pedido (item_id directo o group_id
  //    = categoría del item). Sin itemId/categoryId en las líneas (rutas
  //    legacy) esta validación se omite — max_per_order ya protege.
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
        message: `${promo.label || promo.name} requiere ${need} unidad(es) de cada producto del pack`,
      };
    }
  }
  return { valid: true };
}

/**
 * Valida las reglas de CONTEXTO de una promo contra TODAS las líneas del
 * pedido (existentes + nuevas). Se llama UNA vez por tipo de promo en el
 * route, después de pre-validar cada línea con resolvePromoUnitPrice.
 *
 * Líneas: [{ categoryName, promoType, quantity }] (sin importar db).
 * v15 FASE 3: `itemId`/`categoryId` opcionales para promos data-driven.
 *
 * Reglas (SSOT):
 *   - BOGO (2x1): unidades gratis ≤ unidades pagadas de la categoría.
 *   - PRICE_OVERRIDE con oncePerOrder (Primera Visita): máx 1 unidad.
 *   - COMBO: pares Signature/Cerveza balanceados (misma cantidad, ≥1).
 *   - Promos DB: max_per_order (packs) + líneas del pack presentes.
 *
 * @param {Array<{categoryName?: string|null, promoType?: string|null, quantity?: number, itemId?: string|null, categoryId?: string|null}>} allLines
 * @param {string} promoType
 * @param {string} businessDay — 'YYYY-MM-DD' del día laboral
 * @returns {{ valid: boolean, code?: string, message?: string }}
 */
export function validatePromoContext(allLines, promoType, businessDay) {
  const promo = promoById(promoType);
  // Tipo desconocido: si es una promo de la DB, validar contexto DB;
  // si no existe ni SSOT ni DB, el route ya lo rechazó (no opina).
  if (!promo) return validateDbPromoContext(allLines, promoType, businessDay);
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
