/**
 * ═══════════════════════════════════════════════════════════
 *  load-menu.js — Import menu data from menu-seed.json to SQLite
 *
 *  Usage: node server/scripts/load-menu.js
 *
 *  Reads src/core/data/menu-seed.json (SSOT) and upserts
 *  categories + items into SQLite.
 *
 *  Idempotent: safe to run multiple times.
 *
 *  Image path convention:
 *    BAR items → /menu-photos/micheladas/{id}.png
 *    COC items → /menu-photos/categorias/cat-{category}.jpg (fallback)
 *
 * ═══════════════════════════════════════════════════════════
 */

import { randomUUID } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { getDb, closeDb } from '../db/index.js';

// ── Paths ──────────────────────────────────────────────────
const ROOT = resolve(import.meta.dirname, '..', '..');
const SEED_PATH = join(ROOT, 'src', 'core', 'data', 'menu-seed.json');
const PHOTO_BASE = '/menu-photos';

// ── Read seed data ─────────────────────────────────────────
if (!existsSync(SEED_PATH)) {
  console.error(`[load-menu] Seed file not found: ${SEED_PATH}`);
  process.exit(1);
}

let seedData;
try {
  const raw = readFileSync(SEED_PATH, 'utf-8');
  seedData = JSON.parse(raw);
} catch (err) {
  console.error(`[load-menu] Error reading seed: ${err.message}`);
  process.exit(1);
}

// ── Parse seed into categories + items ─────────────────────
const categories = [];
const items = [];

const menu = seedData.restobar?.menu;
if (!menu) {
  console.error('[load-menu] Invalid seed: missing restobar.menu');
  process.exit(1);
}

let categorySort = 0;
let itemSort = 0;

for (const [areaKey, area] of Object.entries(menu)) {
  const areaLower = areaKey.toLowerCase(); // 'bar' or 'cocina'

  for (const cat of area.categorias || []) {
    const catName = cat.nombre_categoria;
    const catEmoji = areaKey === 'BAR' ? '🍺' : '🍽️';

    categories.push({
      name: catName,
      emoji: catEmoji,
      sort_order: categorySort++,
    });

    for (const seedItem of cat.items || []) {
      // Build image path
      let imageUrl = null;
      if (seedItem.imagen) {
        // Item has explicit image reference
        if (areaLower === 'bar') {
          imageUrl = `${PHOTO_BASE}/micheladas/${seedItem.imagen}`;
        } else {
          imageUrl = `${PHOTO_BASE}/categorias/${seedItem.imagen}`;
        }
      }

      // Build description from ingredients
      const description = seedItem.descripcion || '';
      const ingredientes = seedItem.ingredientes?.join(', ') || '';

      // Build size variants for pizzas
      let sizeVariants = null;
      if (cat.variantes_tamanos && seedItem.precios) {
        sizeVariants = seedItem.precios;
      }

      items.push({
        category: catName,
        name: seedItem.nombre,
        subtitle: seedItem.subtitulo || '',
        description: description || ingredientes,
        price: seedItem.precio ?? null,
        area: areaLower,
        sort_order: itemSort++,
        preparation_time: areaLower === 'bar' ? 5 : 15,
        image_url: imageUrl,
        size_variants: sizeVariants,
        has_ice: seedItem.tiene_ice || false,
        ingredient_list: seedItem.ingredientes || [],
        garnish_list: seedItem.decoracion_garnish || [],
        recipe_json: seedItem.receta_tecnica || null,
      });
    }
  }
}

console.log(`[load-menu] Parsed ${categories.length} categories, ${items.length} items from seed`);

// ── Import into SQLite ─────────────────────────────────────
const db = getDb();

let categoriesCreated = 0;
let categoriesUpdated = 0;
let itemsCreated = 0;
let itemsUpdated = 0;

const transaction = db.transaction(() => {
  // Process categories
  for (const cat of categories) {
    const existing = db.prepare('SELECT id FROM menu_categories WHERE name = ?').get(cat.name);

    if (existing) {
      db.prepare(`
        UPDATE menu_categories
        SET emoji = COALESCE(?, emoji),
            sort_order = COALESCE(?, sort_order),
            updated_at = datetime('now')
        WHERE id = ?
      `).run(cat.emoji, cat.sort_order, existing.id);
      categoriesUpdated++;
    } else {
      db.prepare(`
        INSERT INTO menu_categories (id, name, emoji, sort_order)
        VALUES (?, ?, ?, ?)
      `).run(randomUUID(), cat.name, cat.emoji, cat.sort_order);
      categoriesCreated++;
    }
  }

  // Process items
  for (const item of items) {
    const category = db.prepare('SELECT id FROM menu_categories WHERE name = ?').get(item.category);
    if (!category) {
      console.warn(`[load-menu] Category "${item.category}" not found for "${item.name}" — skipping`);
      continue;
    }

    const existing = db.prepare(
      'SELECT id FROM menu_items WHERE name = ? AND category_id = ?'
    ).get(item.name, category.id);

    const sizeVariants = item.size_variants ? JSON.stringify(item.size_variants) : null;
    const ingredientList = item.ingredient_list?.length ? JSON.stringify(item.ingredient_list) : null;
    const garnishList = item.garnish_list?.length ? JSON.stringify(item.garnish_list) : null;
    const recipeJson = item.recipe_json ? JSON.stringify(item.recipe_json) : null;

    if (existing) {
      db.prepare(`
        UPDATE menu_items
        SET subtitle = COALESCE(?, subtitle),
            description = COALESCE(?, description),
            price = COALESCE(?, price),
            area = COALESCE(?, area),
            sort_order = COALESCE(?, sort_order),
            preparation_time = COALESCE(?, preparation_time),
            size_variants = COALESCE(?, size_variants),
            image_url = COALESCE(?, image_url),
            has_ice = COALESCE(?, has_ice),
            ingredient_list = COALESCE(?, ingredient_list),
            garnish_list = COALESCE(?, garnish_list),
            recipe_json = COALESCE(?, recipe_json),
            updated_at = datetime('now')
        WHERE id = ?
      `).run(
        item.subtitle || null,
        item.description || null,
        item.price,
        item.area,
        item.sort_order,
        item.preparation_time,
        sizeVariants,
        item.image_url,
        item.has_ice ? 1 : 0,
        ingredientList,
        garnishList,
        recipeJson,
        existing.id
      );
      itemsUpdated++;
    } else {
      db.prepare(`
        INSERT INTO menu_items (id, category_id, name, subtitle, description, price, currency,
                                is_active, is_available, preparation_time, sort_order, area,
                                has_ice, ingredient_list, garnish_list, recipe_json, size_variants, image_url)
        VALUES (?, ?, ?, ?, ?, ?, 'BOB', 1, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        randomUUID(),
        category.id,
        item.name,
        item.subtitle || null,
        item.description || '',
        item.price,
        item.preparation_time,
        item.sort_order,
        item.area,
        item.has_ice ? 1 : 0,
        ingredientList,
        garnishList,
        recipeJson,
        sizeVariants,
        item.image_url
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
