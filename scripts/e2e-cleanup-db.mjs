// Limpieza total de datos E2E residuales en la DB de test.
// Se ejecuta contra la DB indicada por DB_PATH (default test-e2e.db).
// Uso: DB_PATH=data/test-e2e.db node scripts/e2e-cleanup-db.mjs
const { getDb } = await import('../server/db/index.js');
const db = getDb();

// 1. Borrar todas las mesas e2e y sus dependencias
const e2eTables = db.prepare("SELECT id, number FROM tables WHERE section = 'e2e' OR number BETWEEN 90 AND 99").all();
for (const t of e2eTables) {
  const orders = db.prepare('SELECT id FROM orders WHERE table_id = ?').all(t.id);
  for (const o of orders) {
    db.prepare('DELETE FROM payments WHERE order_id = ?').run(o.id);
    db.prepare('DELETE FROM order_items WHERE order_id = ?').run(o.id);
    db.prepare('DELETE FROM orders WHERE id = ?').run(o.id);
  }
  db.prepare('DELETE FROM client_sessions WHERE table_number = ?').run(t.number);
  db.prepare('DELETE FROM waiter_calls WHERE table_number = ?').run(t.number);
  db.prepare('DELETE FROM tables WHERE id = ?').run(t.id);
}

// 2. Borrar pedidos huérfanos de E2E (mesa ya no existe)
const orphans = db.prepare(`
  SELECT o.id FROM orders o
  LEFT JOIN tables t ON o.table_id = t.id
  WHERE t.id IS NULL
`).all();
for (const o of orphans) {
  db.prepare('DELETE FROM payments WHERE order_id = ?').run(o.id);
  db.prepare('DELETE FROM order_items WHERE order_id = ?').run(o.id);
  db.prepare('DELETE FROM orders WHERE id = ?').run(o.id);
}

// 3. Borrar items de menú E2E
db.prepare("DELETE FROM menu_items WHERE name LIKE 'E2E%' OR name LIKE 'Agotado%'").run();

// 4. Borrar cortes de caja de E2E (creados por el test de cierre)
db.prepare("DELETE FROM cash_closings WHERE notes = '' AND closed_by IS NOT NULL").run();
db.prepare("DELETE FROM cash_closings WHERE notes = '' AND closed_by IS NULL").run();

// 5. Borrar sesiones clientes residuales de mesas e2e
db.prepare('DELETE FROM client_sessions WHERE table_number BETWEEN 90 AND 99').run();

console.log('Cleanup E2E completo');
console.log(`- payments restantes: ${db.prepare('SELECT COUNT(*) n FROM payments').get().n}`);
console.log(`- orders restantes: ${db.prepare('SELECT COUNT(*) n FROM orders').get().n}`);
console.log(`- mesas restantes: ${db.prepare('SELECT COUNT(*) n FROM tables').get().n}`);
console.log(`- closings restantes: ${db.prepare('SELECT COUNT(*) n FROM cash_closings').get().n}`);
