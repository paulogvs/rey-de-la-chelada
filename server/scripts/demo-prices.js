/**
 * ═══════════════════════════════════════════════════════════
 *  demo-prices.js — Carga precios BOB realistas de demostración
 *
 *  Hace que la app sea 100% testeable con precios desde el primer
 *  arranque (las micheladas/pizzas nacen con price = NULL).
 *
 *  Usa el servicio compartido menu-bulk-updates (la misma lógica
 *  que el Admin PWA y load-prices.js) — SSOT.
 *
 *  Uso:
 *    node server/scripts/demo-prices.js            → aplica precios demo
 *    node server/scripts/demo-prices.js --dry-run  → muestra qué cambiaría
 *    node server/scripts/demo-prices.js --reset    → deja todo en NULL/0
 *
 *  Rango por categoría (BOB, Cochabamba — centavos):
 *    Ensaladas              Bs 2800 – 4000
 *    Tablas y Canastas      Bs 4200 – 8500
 *    Burgers & Sandwiches   Bs 2600 – 4000
 *    Quesadillas            Bs 3200 – 3800
 *    Pizzas (Mediana)       Bs 5000 (Familiar +2000, XL +4000 → 5000–9000)
 *    Empanadas              Bs 1200 – 1700
 *    Salsas y Extras        Bs 600 – 1000
 *
 *  ⚠️ Sprint 1 (2026-08-17): el menú BAR ya trae precios REALES en el seed.
 *  El demo SOLO rellena items sin precio (price IS NULL), NUNCA a items de
 *  precio manual (price_variable = 1, "Consultar precio") ni a la categoría
 *  display "Promociones" (no facturables). 'Micheladas de la Casa' (vieja
 *  categoría del seed genérico) fue retirada del plan.
 * ═══════════════════════════════════════════════════════════
 */

import { pathToFileURL } from 'node:url';
import { getDb, closeDb } from '../db/index.js';
import {
  applyBulkPriceUpdates,
  applyBulkModifierPriceUpdates,
} from '../services/menu-bulk-updates.js';

// ── Pricing plan: category → prices in sort_order ──────────
// Sprint 1: SOLO categorías COCINA (el menú BAR ya tiene precios reales).
const PRICING_PLAN = {
  'Ensaladas': [2800, 3200, 3800, 3400, 3000],
  'Tablas y Canastas': [4500, 5200, 5800, 6800, 4200, 8500],
  'Burgers & Sandwiches': [2800, 3200, 3000, 3800, 2600, 3400, 3000, 3500, 3200, 4000, 3600],
  'Quesadillas': [3200, 3500, 3800],
  'Pizzas': [5000, 5000, 5000, 5000], // base = Mediana; sizes adjust via modifier options
  'Empanadas': [1400, 1500, 1600, 1400, 1700, 1500, 1200],
  'Salsas y Extras': [600, 700, 800, 1000],
};

/** Categoría display de promociones — nunca facturable, jamás recibe demo price. */
const DISPLAY_ONLY_CATEGORIES = new Set(['Promociones']);

/** Tamaños de pizza: ajuste de precio (centavos) sobre el precio base (Mediana). */
const PIZZA_SIZE_ADJUST = { Mediana: 0, Familiar: 2000, XL: 4000 };

const FALLBACK_PRICE = 2500;

/**
 * Aplica SOLO los ajustes de tamaño de pizza (modifier_options.price_adjustment)
 * desde PIZZA_SIZE_ADJUST. Idempotente y NO destructivo:
 *
 *   - opción en 0 (estado "roto" del bug P0-1) → se reaplica el plan (sanación)
 *   - opción con ajuste > 0 (editado por admin) → se PRESERVA, no se pisa
 *   - opción con ajuste == target → no-op
 *
 * ⚠️ FIX P0-1 (2026-08-11): bootstrap re-carga el menú en cada arranque y
 * load-menu.js (upsert) escribía price_adjustment = 0 cuando el seed trae
 * null → los +2000/+4000 de Familiar/XL se perdían silenciosamente. Este helper
 * se ejecuta SIEMPRE en el bootstrap (a diferencia de applyDemoPrices, que
 * solo corre cuando hay items sin precio) para garantizar que los ajustes
 * sobrevivan a cada restart SIN pisar precios de items editados por admin.
 *
 * @param {object} db — better-sqlite3 instance
 * @param {{ log?: (msg: string) => void, dryRun?: boolean }} [opts]
 * @returns {{ updated: number, failed: number, message: string }}
 */
export function applyPizzaSizeAdjustments(db, { log = console.log, dryRun = false } = {}) {
  const modOptions = db.prepare(`
    SELECT mo.id, mo.name, mo.price_adjustment, mg.menu_item_id, mi.name as item_name
    FROM modifier_options mo
    JOIN modifier_groups mg ON mo.group_id = mg.id
    JOIN menu_items mi ON mg.menu_item_id = mi.id
  `).all();

  const modUpdates = [];
  const summary = [];

  for (const opt of modOptions) {
    const adjust = PIZZA_SIZE_ADJUST[opt.name];
    if (adjust === undefined) continue;
    // Sanar solo el estado roto (0) — nunca pisar un ajuste manual > 0
    if (opt.price_adjustment === 0 && adjust !== 0) {
      modUpdates.push({ id: opt.id, priceAdjustment: adjust });
      summary.push(`  Tamaño ${opt.name} (${opt.item_name}): ${opt.price_adjustment} → +${adjust} (sanación)`);
    }
  }

  if (dryRun) {
    log('[pizza-size-adjust] DRY RUN:');
    log(summary.join('\n') || '  (sin cambios)');
    return { updated: modUpdates.length, failed: 0, message: 'dry-run' };
  }

  if (modUpdates.length === 0) {
    return { updated: 0, failed: 0, message: 'no-op' };
  }

  const modResult = applyBulkModifierPriceUpdates(db, modUpdates);
  log('[pizza-size-adjust] Resultado:');
  log(`  Opciones actualizadas: ${modResult.updated}${modResult.failed > 0 ? ` (${modResult.failed} fallaron)` : ''}`);
  log('');
  log(summary.join('\n'));

  return {
    updated: modResult.updated,
    failed: modResult.failed,
    message: 'applied',
  };
}

/**
 * Apply demo BOB prices to all menu items + pizza size adjustments.
 * Idempotent: skips items whose price already matches.
 *
 * Reusable from server/db/bootstrap.js (auto-seed at startup) and
 * from the CLI entry below.
 *
 * @param {object} db — better-sqlite3 instance
 * @param {{ log?: (msg: string) => void, dryRun?: boolean, reset?: boolean }} [opts]
 * @returns {{ updated: number, failed: number, message: string }}
 */
export function applyDemoPrices(db, { log = console.log, dryRun = false, reset = false } = {}) {
  // ── Flags ──────────────────────────────────────────────────
  const DRY_RUN = dryRun;
  const RESET = reset;

  // 1. Cargar items con su categoría (ordenados por sort_order)
  const items = db.prepare(`
    SELECT mi.id, mi.name, mi.price, mi.price_variable, mc.name as category
    FROM menu_items mi
    JOIN menu_categories mc ON mi.category_id = mc.id
    ORDER BY mc.sort_order ASC, mi.sort_order ASC
  `).all();

  // 2. Cargar opciones de mods (tamaños de pizza)
  const modOptions = db.prepare(`
    SELECT mo.id, mo.name, mo.price_adjustment, mg.menu_item_id, mi.name as item_name
    FROM modifier_options mo
    JOIN modifier_groups mg ON mo.group_id = mg.id
    JOIN menu_items mi ON mg.menu_item_id = mi.id
  `).all();

  // ── Construir updates ──────────────────────────────────────
  const itemUpdates = []; // { id, price }
  const summary = []; // human-readable lines

  if (RESET) {
    // Reset: devolver todo a NULL / 0 (estado "sin precios")
    const tx = db.transaction(() => {
      db.prepare('UPDATE menu_items SET price = NULL, updated_at = datetime(\'now\')').run();
      db.prepare('UPDATE modifier_options SET price_adjustment = 0').run();
    });
    tx();
    log('[demo-prices] RESET aplicado: todos los precios en NULL y ajustes en 0.');
    log(`  Items: ${items.length} | Opciones de tamaño: ${modOptions.length}`);
    return { updated: 0, failed: 0, message: 'reset' };
  }

  // Plan por categoría
  const byCategory = {};
  for (const item of items) {
    if (!byCategory[item.category]) byCategory[item.category] = [];
    byCategory[item.category].push(item);
  }

  for (const [category, catItems] of Object.entries(byCategory)) {
    const plan = PRICING_PLAN[category];
    catItems.forEach((item, idx) => {
      // Sprint 1: el demo SOLO rellena items sin precio. Nunca pisa precios
      // reales del seed, ni items "Consultar precio" (price_variable = 1),
      // ni categorías display no facturables (Promociones).
      if (item.price !== null) return;
      if (item.price_variable === 1) return;
      if (DISPLAY_ONLY_CATEGORIES.has(category)) return;

      const price = plan ? (plan[idx] ?? FALLBACK_PRICE) : FALLBACK_PRICE;
      if (item.price !== price) {
        itemUpdates.push({ id: item.id, price });
        summary.push(`  ${category} · ${item.name}: ${item.price ?? 'NULL'} → Bs ${(price / 100).toFixed(2)}`);
      }
    });
  }

  // Ajustes de tamaño (pizza): Mediana 0, Familiar +2000, XL +4000 — delegado
  // al helper dedicado applyPizzaSizeAdjustments (P0-1: reaplicable siempre).
  const modResultFromHelper = applyPizzaSizeAdjustments(db, { log, dryRun: DRY_RUN });
  if (modResultFromHelper.message === 'applied' || modResultFromHelper.message === 'dry-run') {
    summary.push(`  [tamaños pizza] ${modResultFromHelper.updated} opciones ajustadas`);
  }

  // ── Apply / dry-run ────────────────────────────────────────
  if (DRY_RUN) {
    log('[demo-prices] DRY RUN — no se escribirá nada. Cambios:');
    log(`  Items a actualizar: ${itemUpdates.length}`);
    log(`  Opciones a actualizar: ${modResultFromHelper.updated}`);
    log('');
    log(summary.join('\n') || '  (sin cambios)');
    return { updated: itemUpdates.length + modResultFromHelper.updated, failed: 0, message: 'dry-run' };
  }

  if (itemUpdates.length === 0) {
    log('[demo-prices] Sin cambios en items — los precios ya están cargados.');
    return { updated: 0, failed: 0, message: 'no-op' };
  }

  const itemResult = applyBulkPriceUpdates(db, itemUpdates);

  log('[demo-prices] Resultado:');
  log(`  Items actualizados:   ${itemResult.updated}${itemResult.failed > 0 ? ` (${itemResult.failed} fallaron)` : ''}`);
  log('');
  log(summary.join('\n'));

  if (itemResult.failed > 0) {
    log('\nErrores:');
    for (const e of itemResult.errors) log(`  ${e.id}: ${e.reason}`);
  }

  return {
    updated: itemResult.updated + modResultFromHelper.updated,
    failed: itemResult.failed + modResultFromHelper.failed,
    message: 'applied',
  };
}

// CLI entry — solo cuando se ejecuta directamente
const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  const args = process.argv.slice(2);
  const db = getDb();
  const result = applyDemoPrices(db, {
    dryRun: args.includes('--dry-run'),
    reset: args.includes('--reset'),
  });
  if (result.failed > 0) {
    closeDb();
    process.exit(2);
  }
  closeDb();
}
