// ═══════════════════════════════════════════════════════════════
//  reseed-official-menu.mjs — CORRECTIVE sprint (2026-08-17)
//
//  El sprint anterior reportó haber sembrado el menú oficial del dueño
//  pero NO lo hizo: menu-seed.json y la DB tenían un placeholder genérico
//  INVENTADO (Cheve-Chango, IPA Artesanal, Chelada Clásica, Happy Hour…).
//  Este script reemplaza TODO el menú BAR por el oficial real (v2) y
//  DESACTIVA (is_active=0, NO borra) el placeholder, preservando pedidos
//  históricos (order_items.menu_item_name es snapshot, no se toca).
//
//  DIFERENCIA CLAVE vs load-menu.js (bootstrap): FORCE.
//  load-menu.js es idempotente y NUNCA pisa un precio no-null (contrato
//  "admin edits survive restart"). Aquí SÍ forzamos los precios oficiales
//  porque es una sustitución total del menú, no un arranque normal.
//
//  Uso:
//    node scripts/reseed-official-menu.mjs          # aplica
//    node scripts/reseed-official-menu.mjs --dry-run
//    DB_PATH=... node scripts/reseed-official-menu.mjs
//
//  Idempotente: safe to run multiple times.
// ═══════════════════════════════════════════════════════════════

import { randomUUID } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { getDb, closeDb } from '../server/db/index.js';
import { createAdditionsModifiersForItem } from '../server/scripts/menu-modifier-helpers.js';

const ROOT = resolve(import.meta.dirname, '..');
const SEED_PATH = join(ROOT, 'src', 'core', 'data', 'menu-seed.json');

const DRY_RUN = process.argv.includes('--dry-run');

// ── Read seed ─────────────────────────────────────────────────
if (!existsSync(SEED_PATH)) {
  console.error(`[reseed] Seed no encontrado: ${SEED_PATH}`);
  process.exit(1);
}
const seed = JSON.parse(readFileSync(SEED_PATH, 'utf-8'));
const menu = seed.restobar.menu;

// ── Build official sets ───────────────────────────────────────
const officialCatNames = [];      // 21 (14 bar + 7 cocina)
const officialPairs = new Set();  // "categoryName::itemName" (112)
const barCategories = [];         // [{ name, items: [{...}] }] (14)

let catSort = 0;
let itemSort = 0;
for (const [areaKey, area] of Object.entries(menu)) {
  const areaLower = areaKey.toLowerCase();
  const emoji = areaKey === 'BAR' ? '🍺' : '🍽️';
  for (const cat of area.categorias || []) {
    officialCatNames.push(cat.nombre_categoria);
    if (areaLower === 'bar') {
      barCategories.push({ name: cat.nombre_categoria, emoji, sortOrder: catSort, items: cat.items || [] });
    }
    catSort++;
    for (const it of cat.items || []) {
      officialPairs.add(`${cat.nombre_categoria}::${it.nombre}`);
      itemSort++;
    }
  }
}

const barItemPlans = [];
let barItemSort = 0;
for (const cat of barCategories) {
  for (const it of cat.items) {
    const priceVariable = it.precio_variable ? 1 : 0;
    barItemPlans.push({
      categoryName: cat.name,
      name: it.nombre,
      subtitle: it.subtitulo || null,
      description: it.descripcion || '',
      price: it.precio ?? null,
      price_variable: priceVariable,
      promo_price: it.promo_price ?? null,
      area: 'bar',
      has_ice: it.tiene_ice ? 1 : 0,
      sortOrder: barItemSort++,
      adicionales: Array.isArray(it.adicionales) ? it.adicionales : null,
    });
  }
}

// ── Apply to DB ───────────────────────────────────────────────
const db = getDb();

const stats = {
  categoriesDeactivated: 0,
  itemsDeactivated: 0,
  categoriesUpserted: 0,
  itemsCreated: 0,
  itemsUpdated: 0,
};

const tx = db.transaction(() => {
  // 1. Desactivar categorías que ya no están en el menú oficial (21 nombres)
  const activeCats = db.prepare('SELECT id, name, is_active FROM menu_categories').all();
  const officialSet = new Set(officialCatNames);
  for (const c of activeCats) {
    if (!officialSet.has(c.name) && c.is_active === 1) {
      if (!DRY_RUN) db.prepare('UPDATE menu_categories SET is_active = 0, updated_at = datetime(\'now\') WHERE id = ?').run(c.id);
      stats.categoriesDeactivated++;
      console.log(`  [cat INA] ${c.name}`);
    }
  }

  // 2. Desactivar items que ya no están en el menú oficial (112 pares cat::nombre)
  const activeItems = db.prepare(`
    SELECT mi.id, mi.name, mi.is_active, mc.name AS cat
    FROM menu_items mi JOIN menu_categories mc ON mc.id = mi.category_id
  `).all();
  for (const it of activeItems) {
    if (!officialPairs.has(`${it.cat}::${it.name}`) && it.is_active === 1) {
      if (!DRY_RUN) db.prepare('UPDATE menu_items SET is_active = 0, updated_at = datetime(\'now\') WHERE id = ?').run(it.id);
      stats.itemsDeactivated++;
      console.log(`  [item INA] ${it.name} (${it.cat})`);
    }
  }

  // 3. Upsert categorías oficiales BAR (reactivar + sort_order/emoji)
  for (const cat of barCategories) {
    const existing = db.prepare('SELECT id FROM menu_categories WHERE name = ?').get(cat.name);
    if (existing) {
      if (!DRY_RUN) {
        db.prepare(`
          UPDATE menu_categories SET emoji = ?, sort_order = ?, is_active = 1, updated_at = datetime('now')
          WHERE id = ?
        `).run(cat.emoji, cat.sortOrder, existing.id);
      }
    } else {
      if (!DRY_RUN) {
        db.prepare('INSERT INTO menu_categories (id, name, emoji, sort_order, is_active) VALUES (?, ?, ?, ?, 1)')
          .run(randomUUID(), cat.name, cat.emoji, cat.sortOrder);
      }
    }
    stats.categoriesUpserted++;
  }

  // 4. Force-upsert items oficiales BAR
  for (const plan of barItemPlans) {
    const cat = db.prepare('SELECT id FROM menu_categories WHERE name = ?').get(plan.categoryName);
    if (!cat) {
      console.error(`  [skip] categoría no encontrada: ${plan.categoryName} (${plan.name})`);
      continue;
    }
    const existing = db.prepare('SELECT id FROM menu_items WHERE name = ? AND category_id = ?').get(plan.name, cat.id);
    let itemId;
    if (existing) {
      itemId = existing.id;
      if (!DRY_RUN) {
        db.prepare(`
          UPDATE menu_items SET
            subtitle = ?, description = ?, price = ?, price_variable = ?, promo_price = ?,
            area = ?, sort_order = ?, preparation_time = ?, has_ice = ?, is_active = 1,
            updated_at = datetime('now')
          WHERE id = ?
        `).run(plan.subtitle, plan.description, plan.price, plan.price_variable, plan.promo_price,
               plan.area, plan.sortOrder, 5, plan.has_ice, itemId);
      }
      stats.itemsUpdated++;
    } else {
      itemId = randomUUID();
      if (!DRY_RUN) {
        db.prepare(`
          INSERT INTO menu_items (id, category_id, name, subtitle, description, price, price_variable,
                                  promo_price, currency, is_active, is_available, preparation_time,
                                  sort_order, area, has_ice)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'BOB', 1, 1, ?, ?, ?, ?)
        `).run(itemId, cat.id, plan.name, plan.subtitle, plan.description, plan.price,
               plan.price_variable, plan.promo_price, 5, plan.sortOrder, plan.area, plan.has_ice);
      }
      stats.itemsCreated++;
    }
    // 5. Modifiers (adicionales) — idempotente por nombre
    if (plan.adicionales && !DRY_RUN) {
      createAdditionsModifiersForItem(db, itemId, plan.adicionales);
    }
  }
});

tx();

console.log('');
console.log('[reseed] Resumen:');
console.log(`  Categorías desactivadas: ${stats.categoriesDeactivated}`);
console.log(`  Items desactivados:      ${stats.itemsDeactivated}`);
console.log(`  Categorías BAR upsert:   ${stats.categoriesUpserted}`);
console.log(`  Items BAR creados:       ${stats.itemsCreated}`);
console.log(`  Items BAR actualizados:  ${stats.itemsUpdated}`);

if (DRY_RUN) {
  console.log('  ⚠️  DRY-RUN — nada se escribió.');
} else {
  // Verificación post-reseed
  const totalCats = db.prepare('SELECT COUNT(*) AS n FROM menu_categories WHERE is_active = 1').get().n;
  const totalItems = db.prepare('SELECT COUNT(*) AS n FROM menu_items WHERE is_active = 1').get().n;
  const barItems = db.prepare("SELECT COUNT(*) AS n FROM menu_items WHERE is_active = 1 AND area = 'bar'").get().n;
  const cocinaItems = db.prepare("SELECT COUNT(*) AS n FROM menu_items WHERE is_active = 1 AND area = 'cocina'").get().n;
  console.log('');
  console.log('  Post-reseed (activos):');
  console.log(`    Categorías: ${totalCats} (esperado 21)`);
  console.log(`    Items:      ${totalItems} (esperado 112)`);
  console.log(`      BAR:    ${barItems} (esperado 73)`);
  console.log(`      COCINA: ${cocinaItems} (esperado 39)`);
}

closeDb();
