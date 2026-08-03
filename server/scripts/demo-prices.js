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

import { getDb, closeDb } from '../db/index.js';
import {
  applyBulkPriceUpdates,
  applyBulkModifierPriceUpdates,
} from '../services/menu-bulk-updates.js';

// ── Flags ──────────────────────────────────────────────────
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const RESET = args.includes('--reset');

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

// ── Helpers ────────────────────────────────────────────────
function round2(n) {
  return Math.round(n * 100) / 100;
}

// ── Main ───────────────────────────────────────────────────
const db = getDb();

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
const modUpdates = []; // { id, priceAdjustment }
const summary = []; // human-readable lines

if (RESET) {
  // Reset: devolver todo a NULL / 0 (estado "sin precios")
  const tx = db.transaction(() => {
    db.prepare('UPDATE menu_items SET price = NULL, updated_at = datetime(\'now\')').run();
    db.prepare('UPDATE modifier_options SET price_adjustment = 0').run();
  });
  tx();
  console.log('[demo-prices] RESET aplicado: todos los precios en NULL y ajustes en 0.');
  console.log(`  Items: ${items.length} | Opciones de tamaño: ${modOptions.length}`);
  closeDb();
  process.exit(0);
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

// Ajustes de tamaño (pizza): Mediana 0, Familiar +20, XL +40
for (const opt of modOptions) {
  const adjust = PIZZA_SIZE_ADJUST[opt.name];
  if (adjust === undefined) continue;
  if (opt.price_adjustment !== adjust) {
    modUpdates.push({ id: opt.id, priceAdjustment: adjust });
    summary.push(`  Tamaño ${opt.name} (${opt.item_name}): ${opt.price_adjustment} → +${adjust}`);
  }
}

// ── Apply / dry-run ────────────────────────────────────────
if (DRY_RUN) {
  console.log('[demo-prices] DRY RUN — no se escribirá nada. Cambios:');
  console.log(`  Items a actualizar: ${itemUpdates.length}`);
  console.log(`  Opciones a actualizar: ${modUpdates.length}`);
  console.log('');
  console.log(summary.join('\n') || '  (sin cambios)');
  closeDb();
  process.exit(0);
}

if (itemUpdates.length === 0 && modUpdates.length === 0) {
  console.log('[demo-prices] Sin cambios — los precios ya están cargados.');
  closeDb();
  process.exit(0);
}

const itemResult = applyBulkPriceUpdates(db, itemUpdates);
const modResult = applyBulkModifierPriceUpdates(db, modUpdates);

console.log('[demo-prices] Resultado:');
console.log(`  Items actualizados:   ${itemResult.updated}${itemResult.failed > 0 ? ` (${itemResult.failed} fallaron)` : ''}`);
console.log(`  Opciones actualizadas: ${modResult.updated}${modResult.failed > 0 ? ` (${modResult.failed} fallaron)` : ''}`);
console.log('');
console.log(summary.join('\n'));

if (itemResult.failed > 0 || modResult.failed > 0) {
  const errors = [...itemResult.errors, ...modResult.errors];
  console.log('\nErrores:');
  for (const e of errors) console.log(`  ${e.id}: ${e.reason}`);
}

closeDb();
process.exit(itemResult.failed > 0 || modResult.failed > 0 ? 2 : 0);
