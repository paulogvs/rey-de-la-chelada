/**
 * menu-strict-reset.mjs — Limpia la DB del menú para que coincida EXACTA
 * con el seed oficial (105 items / 19 categorías):
 *
 *   - Borra físicamente items que NO están en el seed (si no tienen pedidos;
 *     con pedidos → los conserva inactivos para no romper el historial)
 *   - Borra duplicados (mismo nombre+categoría normalizado)
 *   - Activa TODOS los items del seed (is_active=1, is_available=1)
 *   - Reaplica precios/ajustes oficiales del seed (incl. pizzas)
 *   - Borra categorías que no estén en el seed (si quedaron vacías)
 *
 * Uso:
 *   node scripts/menu-strict-reset.mjs --dry-run   → plan (no escribe)
 *   node scripts/menu-strict-reset.mjs --apply     → aplica
 *
 * Seguro: nunca borra items con pedidos (los deja inactivos y lo reporta).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { getDb, closeDb } from '../server/db/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SEED_PATH = path.resolve(__dirname, '../src/core/data/menu-seed.json');
const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const dryRun = !APPLY;

/** Slug normalizado: lowercase + sin diacríticos + trim (match robusto) */
function slug(s) {
  return String(s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

// ── Leer seed → mapa slug(cat|item) → { price, priceVariable, promoPrice, area } ──
const seed = JSON.parse(fs.readFileSync(SEED_PATH, 'utf8'));
const seedMap = new Map(); // `${catSlug}|${itemSlug}` → data
const seedCatSlugs = new Set();
for (const areaKey of ['BAR', 'COCINA']) {
  const areaData = seed?.restobar?.menu?.[areaKey];
  if (!areaData?.categorias) continue;
  for (const cat of areaData.categorias) {
    const catSlug = slug(cat.nombre_categoria);
    seedCatSlugs.add(catSlug);
    for (const item of cat.items) {
      seedMap.set(`${catSlug}|${slug(item.nombre)}`, {
        price: item.precio ?? null,
        priceVariable: item.precio_variable ?? 0,
        promoPrice: item.promo_price ?? null,
        area: areaKey === 'BAR' ? 'bar' : 'cocina',
        name: item.nombre,
        catName: cat.nombre_categoria,
      });
    }
  }
}

const db = getDb();
const log = (msg) => console.log(msg);

const items = db.prepare(`
  SELECT mi.id, mi.name, mi.is_active, mi.is_available, mi.area, mc.name as cat, mc.id as cat_id
  FROM menu_items mi JOIN menu_categories mc ON mi.category_id = mc.id
`).all();
const categories = db.prepare('SELECT id, name, is_active FROM menu_categories').all();
const catIdByName = new Map(categories.map(c => [c.name, c.id]));

log('═══ MENÚ ESTRICTO (seed oficial) ═══');
log(`Seed: ${seedMap.size} items · DB: ${items.length} items / ${categories.length} categorías`);

// ── 1. Items FUERA del seed ──
const toDelete = [];     // sin pedidos → borrado físico
const toDeactivate = []; // con pedidos → conservar inactivo
const catToDelete = new Set();

for (const item of items) {
  const key = `${slug(item.cat)}|${slug(item.name)}`;
  if (seedMap.has(key)) continue; // está en el seed

  const orderCount = db.prepare(
    'SELECT COUNT(*) AS n FROM order_items WHERE menu_item_id = ?'
  ).get(item.id).n;

  if (orderCount > 0) {
    toDeactivate.push({ ...item, orderCount });
    catToDelete.delete(item.cat); // no borrar la categoría si conserva items
  } else {
    toDelete.push(item);
  }
}

// ── 2. Duplicados del seed (mismo slug; conservar 1) ──
const seen = new Set();
const dupDelete = [];
for (const item of items) {
  const key = `${slug(item.cat)}|${slug(item.name)}`;
  if (!seedMap.has(key)) continue;
  if (seen.has(key)) {
    const orderCount = db.prepare(
      'SELECT COUNT(*) AS n FROM order_items WHERE menu_item_id = ?'
    ).get(item.id).n;
    if (orderCount > 0) {
      // el duplicado tiene pedidos → conservarlo activo; mejor reportar
      log(`  ⚠️ duplicado CON pedidos (se conserva): ${item.cat} | ${item.name} [${item.id.slice(0, 8)}]`);
    } else {
      dupDelete.push(item);
    }
  } else {
    seen.add(key);
  }
}

// ── 3. Categorías fuera del seed ──
const catsOutside = categories.filter(c => !seedCatSlugs.has(slug(c.name)));

log(`Fuera del seed: ${toDelete.length} a borrar · ${toDeactivate.length} con pedidos (se conservan inactivos)`);
log(`Duplicados a borrar: ${dupDelete.length}`);
log(`Categorías fuera del seed: ${catsOutside.map(c => c.name).join(', ') || 'ninguna'}`);

if (dryRun) {
  log('\n── PLAN (dry-run, no escribe) ──');
  for (const it of toDelete) log(`  DELETE: ${it.cat} | ${it.name}`);
  for (const it of toDeactivate) log(`  DEACTIVATE (${it.orderCount} pedidos): ${it.cat} | ${it.name}`);
  for (const it of dupDelete) log(`  DELETE dup: ${it.cat} | ${it.name}`);
  for (const c of catsOutside) log(`  DELETE cat: ${c.name}`);
  log('\n  Activar + reaplicar precios del seed en los items restantes.');
  closeDb();
  process.exit(0);
}

// ── APPLY ──
const tx = db.transaction(() => {
  const deleteItem = (id) => {
    const groups = db.prepare('SELECT id FROM modifier_groups WHERE menu_item_id = ?').all(id);
    for (const g of groups) db.prepare('DELETE FROM modifier_options WHERE group_id = ?').run(g.id);
    db.prepare('DELETE FROM modifier_groups WHERE menu_item_id = ?').run(id);
    db.prepare('DELETE FROM menu_items WHERE id = ?').run(id);
  };

  for (const it of toDelete) { deleteItem(it.id); log(`  ✕ borrado: ${it.cat} | ${it.name}`); }
  for (const it of dupDelete) { deleteItem(it.id); log(`  ✕ borrado duplicado: ${it.cat} | ${it.name}`); }
  for (const it of toDeactivate) {
    db.prepare('UPDATE menu_items SET is_active = 0, is_available = 0 WHERE id = ?').run(it.id);
    log(`  ◐ conservado inactivo (${it.orderCount} pedido(s)): ${it.cat} | ${it.name}`);
  }

  // Activar TODO el seed + reaplicar precios oficiales
  let activated = 0;
  for (const item of items) {
    const key = `${slug(item.cat)}|${slug(item.name)}`;
    const seedData = seedMap.get(key);
    if (!seedData) continue;
    db.prepare(`
      UPDATE menu_items
      SET is_active = 1, is_available = 1,
          price = ?, price_variable = ?, promo_price = ?, area = ?
      WHERE id = ?
    `).run(seedData.price, seedData.priceVariable, seedData.promoPrice, seedData.area, item.id);
    activated++;
  }
  log(`  ✓ activados + precios del seed: ${activated} items`);

  // Categorías fuera del seed: borrar si quedaron vacías
  for (const c of catsOutside) {
    const count = db.prepare('SELECT COUNT(*) AS n FROM menu_items WHERE category_id = ?').get(c.id).n;
    if (count === 0) {
      db.prepare('DELETE FROM menu_categories WHERE id = ?').run(c.id);
      log(`  ✕ categoría borrada: ${c.name}`);
    } else {
      db.prepare('UPDATE menu_categories SET is_active = 0 WHERE id = ?').run(c.id);
      log(`  ◐ categoría con items históricos conservada inactiva: ${c.name}`);
    }
  }

  // Activar las 19 categorías del seed
  for (const c of categories) {
    if (seedCatSlugs.has(slug(c.name))) {
      db.prepare('UPDATE menu_categories SET is_active = 1 WHERE id = ?').run(c.id);
    }
  }
});
tx();

// Pizzas: reaplicar variantes del seed (createModifierGroupsForItem)
const { createModifierGroupsForItem } = await import('../server/scripts/menu-modifier-helpers.js');
for (const areaKey of ['BAR', 'COCINA']) {
  const areaData = seed?.restobar?.menu?.[areaKey];
  if (!areaData?.categorias) continue;
  for (const cat of areaData.categorias) {
    if (!cat.variantes_tamanos) continue;
    for (const seedItem of cat.items) {
      if (!seedItem.precios) continue;
      const catId = catIdByName.get(cat.nombre_categoria);
      if (!catId) continue;
      const row = db.prepare('SELECT id FROM menu_items WHERE name = ? AND category_id = ?')
        .get(seedItem.nombre, catId);
      if (row) createModifierGroupsForItem(db, row.id, seedItem.precios);
    }
  }
}
log('  ✓ variantes de pizza reaplicadas del seed');

const finalCount = db.prepare('SELECT COUNT(*) AS n FROM menu_items').get().n;
const activeCount = db.prepare('SELECT COUNT(*) AS n FROM menu_items WHERE is_active = 1').get().n;
const finalCats = db.prepare('SELECT COUNT(*) AS n FROM menu_categories WHERE is_active = 1').get().n;
log(`\n═══ RESULTADO ═══`);
log(`Items: ${finalCount} (activos ${activeCount}) · Categorías activas: ${finalCats}`);
log(activeCount === 105 && finalCats === 19
  ? '✅ Menú limpio: 105 items activos / 19 categorías — sin duplicados ni ocultos'
  : '⚠️ Revisar: hay items inactivos conservados por historial (ver log)');

closeDb();