// ═══════════════════════════════════════════════════════════════
// Cleanup de datos placeholder (M5/2.8)
//
// El menú base genérico de server/db/seed.js (14 items a Bs 13-85,
// categorías Cervezas/Tragos/Comidas/Entradas) es SOLO un placeholder:
// el menú REAL se carga desde server/db/load-menu.js.
//
// Este script elimina los items placeholder del menú genérico de la DB
// activa (o la indicada por DB_PATH), PERO SOLO si NUNCA fueron usados
// en un order_item (protección anti-borrado de datos reales).
//
// Uso:
//   node scripts/cleanup-placeholder-data.mjs          # dry-run (no borra)
//   node scripts/cleanup-placeholder-data.mjs --yes    # borra de verdad
//   DB_PATH=data/test-e2e.db node scripts/cleanup-placeholder-data.mjs --yes
// ═══════════════════════════════════════════════════════════════

const { getDb, closeDb } = await import('../server/db/index.js');

// Los items placeholder viven en server/db/seed.js → ITEMS.
// Mantener en sync con esa lista (SSOT de nombres del seed genérico).
const PLACEHOLDER_NAMES = [
  // Cervezas
  'Cerveza Pacena', 'Cerveza Huari', 'Cerveza Taquina', 'Cerveza Sin Alcohol',
  // Tragos
  'Cuba Libre', 'Mojito', 'Chelada Clásica',
  // Comidas
  'Pique Macho', 'Silpancho', 'Fricase', 'Picante de Pollo',
  // Entradas
  'Papas Fritas', 'Salteñas (2)', 'Queso Frito',
];

const YES = process.argv.includes('--yes');
const db = getDb();

const placeholders = db.prepare(
  `SELECT mi.id, mi.name, mi.price, mi.area, c.name AS category
   FROM menu_items mi
   JOIN menu_categories c ON c.id = mi.category_id
   WHERE mi.name IN (${PLACEHOLDER_NAMES.map(() => '?').join(',')})`
).all(...PLACEHOLDER_NAMES);

const used = db.prepare(
  `SELECT DISTINCT menu_item_id FROM order_items WHERE menu_item_id IN (${PLACEHOLDER_NAMES.map(() => '?').join(',')})`
).all(...PLACEHOLDER_NAMES);
const usedIds = new Set(used.map(r => r.menu_item_id));

const toDelete = placeholders.filter(p => !usedIds.has(p.id));
const protectedItems = placeholders.filter(p => usedIds.has(p.id));

console.log(`Placeholder totales: ${placeholders.length}`);
console.log(`  → usados en pedidos (PROTEGIDOS, no se tocan): ${protectedItems.length}`);
console.log(`  → sin uso (candidatos a borrar): ${toDelete.length}`);
console.log('');

if (toDelete.length > 0) {
  console.log('Candidatos:');
  for (const p of toDelete) {
    console.log(`  - [${p.category}] ${p.name} — Bs ${p.price} (${p.area})`);
  }
  console.log('');
}

if (!YES) {
  console.log('⚠️  DRY-RUN — nada se borró. Usa `--yes` para eliminar.');
} else if (toDelete.length > 0) {
  const del = db.prepare('DELETE FROM menu_items WHERE id = ?');
  const tx = db.transaction((items) => items.forEach(i => del.run(i.id)));
  tx(toDelete);
  console.log(`✅ Borrados ${toDelete.length} items placeholder del menú genérico.`);
} else {
  console.log('✅ Nada que borrar (no quedan placeholders sin uso).');
}

closeDb();
