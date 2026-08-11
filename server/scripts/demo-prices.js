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
 *  Rango por categoría (BOB, Cochabamba):
 *    Micheladas             Bs 25 – 45
 *    Ensaladas              Bs 28 – 40
 *    Tablas y Canastas      Bs 42 – 85
 *    Burgers & Sandwiches   Bs 26 – 40
 *    Quesadillas            Bs 32 – 38
 *    Pizzas (Mediana)       Bs 50 (Familiar +20, XL +40 → 50–90)
 *    Empanadas              Bs 12 – 17
 *    Salsas y Extras        Bs 6 – 10
 * ═══════════════════════════════════════════════════════════
 */

import { pathToFileURL } from 'node:url';
import { getDb, closeDb } from '../db/index.js';
import {
  applyBulkPriceUpdates,
  applyBulkModifierPriceUpdates,
} from '../services/menu-bulk-updates.js';

// ── Pricing plan: category → prices in sort_order ──────────
const PRICING_PLAN = {
  'Micheladas de la Casa': [28, 30, 32, 34, 30, 33, 35, 32, 31, 34],
  'Ensaladas': [28, 32, 38, 34, 30],
  'Tablas y Canastas': [45, 52, 58, 68, 42, 85],
  'Burgers & Sandwiches': [28, 32, 30, 38, 26, 34, 30, 35, 32, 40, 36],
  'Quesadillas': [32, 35, 38],
  'Pizzas': [50, 50, 50, 50], // base = Mediana; sizes adjust via modifier options
  'Empanadas': [14, 15, 16, 14, 17, 15, 12],
  'Salsas y Extras': [6, 7, 8, 10],
};

/** Tamaños de pizza: ajuste de precio sobre el precio base (Mediana). */
const PIZZA_SIZE_ADJUST = { Mediana: 0, Familiar: 20, XL: 40 };

const FALLBACK_PRICE = 25;

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
 * null → los +20/+40 de Familiar/XL se perdían silenciosamente. Este helper
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
    SELECT mi.id, mi.name, mi.price, mc.name as category
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
      const price = plan ? (plan[idx] ?? FALLBACK_PRICE) : FALLBACK_PRICE;
      if (item.price !== price) {
        itemUpdates.push({ id: item.id, price });
        summary.push(`  ${category} · ${item.name}: ${item.price ?? 'NULL'} → Bs ${price}`);
      }
    });
  }

  // Ajustes de tamaño (pizza): Mediana 0, Familiar +20, XL +40 — delegado
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
