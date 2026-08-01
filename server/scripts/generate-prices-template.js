/**
 * ═══════════════════════════════════════════════════════════
 *  generate-prices-template.js — Create data/prices-template.json
 *  from the current SQLite database.
 *
 *  Usage:
 *    node server/scripts/generate-prices-template.js
 *
 *  Reads every menu item (real UUIDs from menu_items) and every
 *  modifier option (modifier_options) and writes the template file
 *  used by load-prices.js. Prices are exported as null so the user
 *  fills them in (price 0 → null: a placeholder, not a real price).
 *
 *  Output: data/prices-template.json (gitignored — regenerate on demand).
 * ═══════════════════════════════════════════════════════════
 */

import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { getDb, closeDb, getDbPath } from '../db/index.js';

const TEMPLATE_PATH = resolve(import.meta.dirname, '..', '..', 'data', 'prices-template.json');

const db = getDb();

const items = db.prepare(`
  SELECT mi.id, mi.name, mc.name AS category, mi.price
  FROM menu_items mi
  JOIN menu_categories mc ON mi.category_id = mc.id
  ORDER BY mc.sort_order, mi.sort_order, mi.name
`).all();

const modifierOptions = db.prepare(`
  SELECT mo.id, mi.name AS menuItemName, mg.name AS groupName, mo.name AS optionName, mo.price_adjustment
  FROM modifier_options mo
  JOIN modifier_groups mg ON mo.group_id = mg.id
  JOIN menu_items mi ON mg.menu_item_id = mi.id
  ORDER BY mi.name, mo.sort_order
`).all();

const template = {
  currency: 'BOB',
  // price: null = "no llenado aún" — el usuario lo reemplaza con el precio real
  items: items.map(i => ({ id: i.id, name: i.name, category: i.category, price: i.price === 0 ? null : i.price })),
  modifierOptions: modifierOptions.map(m => ({
    id: m.id,
    menuItemName: m.menuItemName,
    groupName: m.groupName,
    optionName: m.optionName,
    priceAdjustment: m.price_adjustment,
  })),
};

writeFileSync(TEMPLATE_PATH, JSON.stringify(template, null, 2) + '\n', 'utf-8');

console.log(`[generate-prices-template] Wrote ${template.items.length} items + ${template.modifierOptions.length} modifier options → ${TEMPLATE_PATH}`);
console.log(`[generate-prices-template] Source DB: ${getDbPath()}`);

closeDb();
