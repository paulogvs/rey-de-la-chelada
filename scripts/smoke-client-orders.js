/* Smoke test: client-orders service against real SQLite DB */
import { getDb } from '../server/db/index.js';
import { createPublicOrder, getPublicOrderStatus } from '../server/services/client-orders.js';

const db = getDb();
const table = db.prepare('SELECT id, number, status FROM tables WHERE number = 5').get();
console.log('table 5:', JSON.stringify(table));

const firstItem = db.prepare('SELECT id FROM menu_items WHERE is_active = 1 LIMIT 1').get();
const result = createPublicOrder(db, {
  table_number: 5,
  session_id: 'smoke-test-1',
  items: [{ menu_item_id: firstItem.id, quantity: 2 }],
});
console.log('create:', result.success, result.order ? result.order.id : result.code, 'total:', result.order ? result.order.total : '-');

if (result.success) {
  const s = getPublicOrderStatus(db, result.order.id);
  console.log('status:', JSON.stringify({ success: s.success, status: s.status, total: s.total, items: s.items ? s.items.length : 0 }));
  // cleanup
  db.prepare('DELETE FROM order_items WHERE order_id = ?').run(result.order.id);
  db.prepare('DELETE FROM orders WHERE id = ?').run(result.order.id);
  db.prepare("UPDATE tables SET status = 'free', current_order_id = NULL WHERE number = 5").run();
  console.log('cleaned up');
} else {
  console.log('FAILED:', result.code, result.error);
  process.exitCode = 1;
}
