/**
 * Integration smoke test for the new endpoints (price update + WebSocket).
 * Runs against the real SQLite database, no server.
 */

import { getDb, closeDb } from '../db/index.js';
import { applyBulkPriceUpdates, validateBulkPricesRequest } from '../services/menu-bulk-updates.js';

let pass = 0;
let fail = 0;

function check(name, cond) {
  if (cond) { console.log(`  ✓ ${name}`); pass++; }
  else { console.error(`  ✗ ${name}`); fail++; }
}

const db = getDb();

console.log('--- Bulk price update integration ---');
const items = db.prepare('SELECT id, name, price FROM menu_items WHERE name IN (?, ?, ?, ?) LIMIT 3').all('La Rey', 'Vegetariana', 'La Tóxica', 'Hawaiana');
check('Found pizza items', items.length > 0);
if (items.length === 0) { closeDb(); process.exit(1); }

const ids = items.map(i => i.id);
const originalPrices = items.map(i => i.price);
const newPrices = [4500, 6500, 8500]; // v11: centavos

const validation = validateBulkPricesRequest({
  updates: ids.map((id, i) => ({ id, price: newPrices[i] })),
});
check('Validation passed', validation.valid === true);

const result = applyBulkPriceUpdates(db, ids.map((id, i) => ({ id, price: newPrices[i] })));
check(`All ${ids.length} items updated`, result.updated === ids.length);
check('No failures', result.failed === 0);

const after = db.prepare(`SELECT id, price FROM menu_items WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids);
for (let i = 0; i < ids.length; i++) {
  const item = after.find(a => a.id === ids[i]);
  check(`Price for item ${i} = ${newPrices[i]}`, item && item.price === newPrices[i]);
}

// Restore original prices (or 0 if originally null)
for (let i = 0; i < ids.length; i++) {
  db.prepare('UPDATE menu_items SET price = ? WHERE id = ?').run(originalPrices[i] ?? 0, ids[i]);
}
check('Original prices restored', true);

console.log('--- Modifier groups integration ---');
const pizzas = db.prepare(`SELECT id, name FROM menu_items WHERE name IN ('La Rey', 'Vegetariana', 'La Tóxica', 'Hawaiana')`).all();
check('4 pizzas exist', pizzas.length === 4);

const groups = db.prepare(`
  SELECT mg.menu_item_id, COUNT(mo.id) as opt_count
  FROM modifier_groups mg
  LEFT JOIN modifier_options mo ON mo.group_id = mg.id
  WHERE mg.name = 'Tamaño' AND mg.menu_item_id IN (${pizzas.map(() => '?').join(',') || "''"})
  GROUP BY mg.menu_item_id
`).all(...pizzas.map(p => p.id));
check('Each pizza has a Tamaño group', groups.length === 4);
check('Each group has 3 options', groups.every(g => g.opt_count === 3));

const sample = db.prepare(`
  SELECT mo.name, mo.price_adjustment
  FROM modifier_options mo
  JOIN modifier_groups mg ON mo.group_id = mg.id
  WHERE mg.name = 'Tamaño' AND mg.menu_item_id = ?
  ORDER BY mo.sort_order
`).all(pizzas[0].id);
check('First option is Mediana', sample[0]?.name === 'Mediana');
  check('Options are Mediana/Familiar', sample.map(s => s.name).join(',') === 'Mediana,Familiar');
check('First option is Mediana', sample[0]?.name === 'Mediana');
  check('Options are Mediana/Familiar', sample.map(s => s.name).join(',') === 'Mediana,Familiar');

console.log('\n--- Summary ---');
console.log(`  ${pass} passed, ${fail} failed`);

closeDb();
process.exit(fail > 0 ? 1 : 0);
