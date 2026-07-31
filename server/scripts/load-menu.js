/**
 * ═══════════════════════════════════════════════════════════
 *  load-menu.js — Import menu data from JSON into SQLite
 *
 *  Usage: node server/scripts/load-menu.js menu-data.json
 *
 *  Idempotent: uses INSERT OR REPLACE for categories and items.
 *  Creates categories if they don't exist, updates if they do.
 *  Same for menu items (matched by name + category).
 *
 *  JSON format:
 *  {
 *    "categories": [
 *      { "name": "Cervezas", "emoji": "🍺", "sort_order": 1 }
 *    ],
 *    "items": [
 *      {
 *        "category": "Cervezas",
 *        "name": "Cerveza Pacena",
 *        "description": "",
 *        "price": 15,
 *        "area": "bar",
 *        "sort_order": 1,
 *        "preparation_time": 15,
 *        "size_variants": { "media": 15, "litro": 25 }
 *      }
 *    ]
 *  }
 *
 * ═══════════════════════════════════════════════════════════
 */

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { getDb, closeDb } from '../db/index.js';

const filePath = process.argv[2];

if (!filePath) {
  console.error('Usage: node server/scripts/load-menu.js <menu-data.json>');
  process.exit(1);
}

let data;
try {
  const raw = readFileSync(resolve(filePath), 'utf-8');
  data = JSON.parse(raw);
} catch (err) {
  console.error(`[load-menu] Error reading file: ${err.message}`);
  process.exit(1);
}

if (!data.categories || !Array.isArray(data.categories)) {
  console.error('[load-menu] Invalid JSON: missing "categories" array');
  process.exit(1);
}

if (!data.items || !Array.isArray(data.items)) {
  console.error('[load-menu] Invalid JSON: missing "items" array');
  process.exit(1);
}

const db = getDb();

let categoriesCreated = 0;
let categoriesUpdated = 0;
let itemsCreated = 0;
let itemsUpdated = 0;

const transaction = db.transaction(() => {
  // Process categories
  for (const cat of data.categories) {
    if (!cat.name) {
      console.warn('[load-menu] Skipping category without name:', cat);
      continue;
    }

    const existing = db.prepare('SELECT id FROM menu_categories WHERE name = ?').get(cat.name);

    if (existing) {
      // Update existing category
      db.prepare(`
        UPDATE menu_categories
        SET emoji = COALESCE(?, emoji),
            sort_order = COALESCE(?, sort_order),
            updated_at = datetime('now')
        WHERE id = ?
      `).run(cat.emoji || null, cat.sort_order ?? null, existing.id);
      categoriesUpdated++;
    } else {
      // Create new category
      db.prepare(`
        INSERT INTO menu_categories (id, name, emoji, sort_order)
        VALUES (?, ?, ?, ?)
      `).run(randomUUID(), cat.name, cat.emoji || '🍽', cat.sort_order || 0);
      categoriesCreated++;
    }
  }

  // Process items
  for (const item of data.items) {
    if (!item.name || !item.category) {
      console.warn('[load-menu] Skipping item without name or category:', item);
      continue;
    }

    // Find category
    const category = db.prepare('SELECT id FROM menu_categories WHERE name = ?').get(item.category);
    if (!category) {
      console.warn(`[load-menu] Category "${item.category}" not found for item "${item.name}" — skipping`);
      continue;
    }

    const existing = db.prepare(
      'SELECT id FROM menu_items WHERE name = ? AND category_id = ?'
    ).get(item.name, category.id);

    const sizeVariants = item.size_variants ? JSON.stringify(item.size_variants) : null;

    if (existing) {
      // Update existing item
      db.prepare(`
        UPDATE menu_items
        SET description = COALESCE(?, description),
            price = COALESCE(?, price),
            area = COALESCE(?, area),
            sort_order = COALESCE(?, sort_order),
            preparation_time = COALESCE(?, preparation_time),
            size_variants = COALESCE(?, size_variants),
            image_url = COALESCE(?, image_url),
            is_available = COALESCE(?, is_available),
            updated_at = datetime('now')
        WHERE id = ?
      `).run(
        item.description ?? null,
        item.price ?? null,
        item.area ?? null,
        item.sort_order ?? null,
        item.preparation_time ?? null,
        sizeVariants,
        item.image_url ?? null,
        item.is_available ?? null,
        existing.id
      );
      itemsUpdated++;
    } else {
      // Create new item
      db.prepare(`
        INSERT INTO menu_items (id, category_id, name, description, price, currency,
                                is_active, is_available, preparation_time, sort_order, area, size_variants, image_url)
        VALUES (?, ?, ?, ?, ?, 'BOB', 1, ?, ?, ?, ?, ?, ?)
      `).run(
        randomUUID(),
        category.id,
        item.name,
        item.description || '',
        item.price ?? null,
        item.is_available !== false ? 1 : 0,
        item.preparation_time || 15,
        item.sort_order || 0,
        item.area || 'cocina',
        sizeVariants,
        item.image_url || null
      );
      itemsCreated++;
    }
  }
});

transaction();

console.log(`[load-menu] Done:`);
console.log(`  Categories: ${categoriesCreated} created, ${categoriesUpdated} updated`);
console.log(`  Items: ${itemsCreated} created, ${itemsUpdated} updated`);

closeDb();
