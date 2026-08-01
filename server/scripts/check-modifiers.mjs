import { getDb, closeDb } from '../db/index.js';
const db = getDb();
const groups = db.prepare('SELECT * FROM modifier_groups').all();
const opts = db.prepare('SELECT * FROM modifier_options').all();
const items = db.prepare("SELECT id, name, size_variants FROM menu_items WHERE size_variants IS NOT NULL").all();
console.log('Modifier groups:', groups.length);
console.log('Options:', opts.length);
console.log('Items with size_variants:');
for (const it of items) {
  console.log(`  - ${it.name} (${it.id}) size_variants=${it.size_variants}`);
  const myGroups = groups.filter(g => g.menu_item_id === it.id);
  for (const g of myGroups) {
    console.log(`    Group: ${g.name} (type=${g.type}, required=${g.required})`);
    const myOpts = opts.filter(o => o.group_id === g.id);
    for (const o of myOpts) {
      console.log(`      - ${o.name}: +${o.price_adjustment} BOB${o.is_default ? ' (default)' : ''}`);
    }
  }
}
closeDb();
