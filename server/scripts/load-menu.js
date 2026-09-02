/**
 * ═══════════════════════════════════════════════════════════
 *  load-menu.js — Import menu data from menu-seed.json to SQLite
 *
 *  Usage: node server/scripts/load-menu.js
 *
 *  Reads src/core/data/menu-seed.json (SSOT) and upserts
 *  categories + items into SQLite. Also creates modifier groups
 *  for items with size_variants (pizzas, etc).
 *
 *  v9 (Sprint 1): el seed puede traer `precio_variable` (1 = "Consultar
 *  precio", precio manual obligatorio) y `promo_price` (precio promo).
 *  En UPDATE, price_variable solo se pisa si el seed lo define (null
 *  conserva el valor existente para no pisar cambios del admin).
 *
 *  Idempotent: safe to run multiple times.
 *
 *  Image path convention:
 *    BAR items → /menu-photos/micheladas/{id}.png
 *    COC items → /menu-photos/categorias/cat-{category}.jpg (fallback)
 *
 *  Exports loadMenuFromSeed(db) so the auto-bootstrap can reuse
 *  this logic at server startup (server/db/bootstrap.js).
 * ═══════════════════════════════════════════════════════════
 */

import { randomUUID } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { getDb, closeDb } from '../db/index.js';
import { createModifierGroupsForItem, createAdditionsModifiersForItem } from './menu-modifier-helpers.js';

// ── Paths ──────────────────────────────────────────────────
const ROOT = resolve(import.meta.dirname, '..', '..');
const SEED_PATH = join(ROOT, 'src', 'core', 'data', 'menu-seed.json');
const PHOTO_BASE = '/menu-photos';

/**
 * Load the real menu from menu-seed.json into the DB (idempotent upsert).
 * @param {object} db — better-sqlite3 instance
 * @param {{ log?: (msg: string) => void }} [opts]
 * @returns {{ categoriesCreated: number, categoriesUpdated: number, itemsCreated: number, itemsUpdated: number }}
 */
export function loadMenuFromSeed(db, { log = console.log } = {}) {
  // ── Read seed data ─────────────────────────────────────────
  if (!existsSync(SEED_PATH)) {
    throw new Error(`[load-menu] Seed file not found: ${SEED_PATH}`);
  }

  let seedData;
  try {
    const raw = readFileSync(SEED_PATH, 'utf-8');
    seedData = JSON.parse(raw);
  } catch (err) {
    throw new Error(`[load-menu] Error reading seed: ${err.message}`, { cause: err });
  }

  const menu = seedData.restobar?.menu;
  if (!menu) {
    throw new Error('[load-menu] Invalid seed: missing restobar.menu');
  }

  // ── Parse seed into categories + items ─────────────────────
  const categories = [];
  const items = [];

  let categorySort = 0;
  let itemSort = 0;

  for (const [areaKey, area] of Object.entries(menu)) {
    const areaLower = areaKey.toLowerCase(); // 'bar' or 'cocina'

    for (const cat of area.categorias || []) {
      const catName = cat.nombre_categoria;
      // v18: icono estandarizado — 🍻 Barra / 🍽️ Cocina (coincide con el Admin).
      const catEmoji = areaKey === 'BAR' ? '🍻' : '🍽️';

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

        // Sprint 1 (D): adicionales como modifiers (grupo "Adicionales" multi)
        const adicionales = Array.isArray(seedItem.adicionales) ? seedItem.adicionales : null;

        // price_variable (v9): 1 = "Consultar precio" (precio manual obligatorio
        // al facturar). Solo se actualiza en UPDATE cuando el seed lo define
        // explícitamente (null → se conserva el valor existente, no pisa admin).
        const priceVariable = seedItem.precio_variable === undefined
          ? null
          : (seedItem.precio_variable ? 1 : 0);

        items.push({
          category: catName,
          name: seedItem.nombre,
          subtitle: seedItem.subtitulo || '',
          description: description || ingredientes,
          price: seedItem.precio ?? null,
          price_variable: priceVariable,
          promo_price: seedItem.promo_price ?? null,
          area: areaLower,
          sort_order: itemSort++,
          preparation_time: areaLower === 'bar' ? 5 : 15,
          image_url: imageUrl,
          size_variants: sizeVariants,
          has_ice: seedItem.tiene_ice || false,
          ingredient_list: seedItem.ingredientes || [],
          garnish_list: seedItem.decoracion_garnish || [],
          recipe_json: seedItem.receta_tecnica || null,
          adicionales,
        });
      }
    }
  }

  log(`[load-menu] Parsed ${categories.length} categories, ${items.length} items from seed`);

  // ── Import into SQLite ─────────────────────────────────────
  let categoriesCreated = 0;
  let categoriesUpdated = 0;
  let itemsCreated = 0;
  let itemsUpdated = 0;

  const transaction = db.transaction(() => {
    // Reconciliation is deliberate: the seed is the complete official catalog.
    // Historical rows remain available for old orders, but cannot reappear in
    // menu or order flows after a catalog replacement.
    db.prepare('UPDATE menu_categories SET is_active = 0').run();
    db.prepare('UPDATE menu_items SET is_active = 0, is_available = 0').run();

    // Process categories
    for (const cat of categories) {
      const existing = db.prepare('SELECT id FROM menu_categories WHERE name = ?').get(cat.name);

      if (existing) {
        db.prepare(`
          UPDATE menu_categories
           SET emoji = COALESCE(?, emoji),
               is_active = 1,
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
        log(`[load-menu] Category "${item.category}" not found for "${item.name}" — skipping`);
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
        // The seed is the complete catalog authority. Existing menu rows are
        // reconciled to it so a catalog replacement cannot retain old prices.
        db.prepare(`
          UPDATE menu_items
          SET subtitle = COALESCE(?, subtitle),
              description = COALESCE(?, description),
              price = ?,
              price_variable = COALESCE(?, price_variable),
              promo_price = ?,
              area = COALESCE(?, area),
              sort_order = COALESCE(?, sort_order),
              preparation_time = COALESCE(?, preparation_time),
              size_variants = COALESCE(?, size_variants),
              image_url = COALESCE(?, image_url),
              is_active = 1,
              is_available = 1,
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
          item.price_variable,
          item.promo_price,
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

        // Sync modifier groups for items with size_variants
        if (item.size_variants) {
          createModifierGroupsForItem(db, existing.id, item.size_variants);
        }
        // Sprint 1 (D): adicionales como modifiers (barra)
        if (item.adicionales) {
          createAdditionsModifiersForItem(db, existing.id, item.adicionales);
        }
        itemsUpdated++;
      } else {
        const newId = randomUUID();
        db.prepare(`
          INSERT INTO menu_items (id, category_id, name, subtitle, description, price, price_variable,
                                  promo_price, currency, is_active, is_available, preparation_time,
                                  sort_order, area, has_ice, ingredient_list, garnish_list, recipe_json,
                                  size_variants, image_url)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'BOB', 1, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          newId,
          category.id,
          item.name,
          item.subtitle || null,
          item.description || '',
          item.price,
          item.price_variable ? 1 : 0,
          item.promo_price,
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

        // Create modifier groups for items with size_variants
        if (item.size_variants) {
          createModifierGroupsForItem(db, newId, item.size_variants);
        }
        // Sprint 1 (D): adicionales como modifiers (barra)
        if (item.adicionales) {
          createAdditionsModifiersForItem(db, newId, item.adicionales);
        }
        itemsCreated++;
      }
    }
  });

  transaction();

  log(`[load-menu] Done:`);
  log(`  Categories: ${categoriesCreated} created, ${categoriesUpdated} updated`);
  log(`  Items: ${itemsCreated} created, ${itemsUpdated} updated`);

  return { categoriesCreated, categoriesUpdated, itemsCreated, itemsUpdated };
}

// CLI entry — solo cuando se ejecuta directamente
const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  const db = getDb();
  loadMenuFromSeed(db);
  closeDb();
}
