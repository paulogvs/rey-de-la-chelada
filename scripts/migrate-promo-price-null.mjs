// ═══════════════════════════════════════════════════════════════
// Migración promo_price → NULL (Sprint Promos 2026-08-19, Opción A)
//
// El seed ya NO trae promo_price en Micheladas Signature (eran 25) ni en
// Cerveza Artesanal (eran 12): el descuento ahora vive en las promos por
// día laboral (botones manuales del mesero: 2x1, Miércoles de Barra,
// Combo, Primera Visita).
//
// load-menu.js hace upsert que NO pisa precios existentes (solo rellena
// NULLs) → cambiar el seed NO actualiza una DB ya sembrada. Este script
// pone promo_price = NULL en esas 2 categorías (idempotente).
//
// Uso:
//   node scripts/migrate-promo-price-null.mjs           # dry-run (reporta)
//   node scripts/migrate-promo-price-null.mjs --yes     # ejecuta el UPDATE
//   DB_PATH=data/rey-de-la-chelada.db node scripts/migrate-promo-price-null.mjs --yes
// ═══════════════════════════════════════════════════════════════

const { getDb, closeDb } = await import('../server/db/index.js');

const CATEGORIES = ['Micheladas Signature', 'Cerveza Artesanal'];
const YES = process.argv.includes('--yes');
const db = getDb();

const affected = db.prepare(`
  SELECT mi.id, mi.name, mi.promo_price, c.name AS category
  FROM menu_items mi
  JOIN menu_categories c ON c.id = mi.category_id
  WHERE c.name IN (${CATEGORIES.map(() => '?').join(',')})
    AND mi.promo_price IS NOT NULL
`).all(...CATEGORIES);

console.log(`[migrate-promo-price-null] ${affected.length} item(s) con promo_price en Signature/Artesanal:`);
for (const a of affected) {
  console.log(`  - ${a.category} / ${a.name}: promo_price ${a.promo_price} → NULL`);
}

if (affected.length === 0) {
  console.log('[migrate-promo-price-null] Nada que migrar (ya limpio).');
  closeDb();
  process.exit(0);
}

if (!YES) {
  console.log('\n[dry-run] No se ejecutó ningún cambio. Usa --yes para aplicar.');
  closeDb();
  process.exit(0);
}

const run = db.transaction(() => {
  const upd = db.prepare(
    `UPDATE menu_items SET promo_price = NULL WHERE id = ?`
  );
  for (const a of affected) upd.run(a.id);
});
run();
console.log(`\n[migrate-promo-price-null] ${affected.length} item(s) actualizados.`);

const remaining = db.prepare(`
  SELECT COUNT(*) AS n FROM menu_items mi
  JOIN menu_categories c ON c.id = mi.category_id
  WHERE c.name IN (${CATEGORIES.map(() => '?').join(',')}) AND mi.promo_price IS NOT NULL
`).get(...CATEGORIES);
console.log(`[migrate-promo-price-null] Verificación: quedan ${remaining.n} con promo_price (esperado 0).`);

closeDb();