/**
 * ═══════════════════════════════════════════════════════════
 *  load-prices.js — Apply menu prices from a JSON file to SQLite
 *
 *  Usage:
 *    node server/scripts/load-prices.js [path-to-prices-file]
 *
 *  Default path: data/prices.json (if present), else data/prices-template.json.
 *
 *  The prices file is created from data/prices-template.json — the user
 *  fills in each price and runs this script. It validates every price
 *  (positive number, items with price null are skipped) and applies via
 *  the shared menu-bulk-updates service (same logic as the admin API
 *  POST /api/menu/items/bulk-prices).
 *
 *  Also supports modifierOptions: [{ id, name, priceAdjustment }] to set
 *  pizza size adjustments (modifier_options.price_adjustment).
 *
 *  Output: summary — N updated, M skipped (missing), errors.
 * ═══════════════════════════════════════════════════════════
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { getDb, closeDb } from '../db/index.js';
import {
  validatePricesFile,
  applyBulkPriceUpdates,
  applyBulkModifierPriceUpdates,
} from '../services/menu-bulk-updates.js';

// ── Resolve the prices file path ─────────────────────────────
const ROOT = resolve(import.meta.dirname, '..', '..');

function resolvePricesPath(cliArg) {
  if (cliArg) return resolve(ROOT, cliArg);

  const filled = join(ROOT, 'data', 'prices.json');
  if (existsSync(filled)) return filled;

  return join(ROOT, 'data', 'prices-template.json');
}

const pricesPath = resolvePricesPath(process.argv[2]);

if (!existsSync(pricesPath)) {
  console.error(`[load-prices] Prices file not found: ${pricesPath}`);
  console.error(`  Copy data/prices-template.json → data/prices.json, fill prices, and run again.`);
  process.exit(1);
}

// ── Read + parse ─────────────────────────────────────────────
let pricesFile;
try {
  pricesFile = JSON.parse(readFileSync(pricesPath, 'utf-8'));
} catch (err) {
  console.error(`[load-prices] Error reading prices file: ${err.message}`);
  process.exit(1);
}

// ── Validate ─────────────────────────────────────────────────
const validation = validatePricesFile(pricesFile);
if (!validation.valid) {
  console.error('[load-prices] Validation failed:');
  for (const err of validation.errors) {
    console.error(`  ✗ [${err.index >= 0 ? `item #${err.index + 1}` : 'file'}] ${err.id || ''}: ${err.reason}`);
  }
  console.error(`\n[load-prices] Aborted — nothing was written.`);
  closeDb();
  process.exit(1);
}

// ── Apply ────────────────────────────────────────────────────
const db = getDb();
const currency = pricesFile.currency || 'BOB';

console.log(`[load-prices] Applying ${validation.items.length} price(s) (${currency}) from ${pricesPath}`);

const itemResult = applyBulkPriceUpdates(db, validation.items);
const modResult = validation.modifierOptions.length > 0
  ? applyBulkModifierPriceUpdates(db, validation.modifierOptions)
  : { updated: 0, failed: 0, errors: [] };

// ── Summary ──────────────────────────────────────────────────
const updated = itemResult.updated + modResult.updated;
const skipped = validation.skipped;
const failed = itemResult.failed + modResult.failed;

console.log('\n[load-prices] Summary:');
console.log(`  ✓ Updated:    ${updated} (${itemResult.updated} items + ${modResult.updated} modifier options)`);
console.log(`  - Skipped:    ${skipped} (price null — missing)`);
if (failed > 0) {
  console.log(`  ✗ Errors:     ${failed}`);
  for (const err of [...itemResult.errors, ...modResult.errors]) {
    console.log(`      ${err.id}: ${err.reason}`);
  }
} else {
  console.log(`  ✗ Errors:     0`);
}

console.log(`\n[load-prices] Done.`);
closeDb();
process.exit(failed > 0 ? 2 : 0);
