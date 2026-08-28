/**
 * Limpieza de datos transaccionales — Rey de la Chelada (PROD pruebas)
 * Opción A: borra SOLO pedidos, pagos, comprobantes, cierres y llamadas a mesero.
 * MANTIENE: staff, mesas, menú (items + categorías + modificadores).
 *
 * Uso: node scripts/clear-operational.mjs [--dry-run]
 */
import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB = process.env.DB_PATH || path.resolve(__dirname, '..', 'data', 'rey-de-la-chelada.db');
const dryRun = process.argv.includes('--dry-run');

const db = new Database(DB);
db.pragma('foreign_keys = ON');

// Orden de borrado respetando FK (hijos antes que padres):
// payment_proofs (FK payments) → payment_operations (FK orders) → order_items (FK orders, CASCADE)
// → payments (FK orders) → waiter_calls (FK tables) → cash_closings → orders (último, padres)
const TABLES = [
  'payment_proofs',
  'payment_operations',
  'order_items',
  'payments',
  'waiter_calls',
  'cash_closings',
  'orders',
];

console.log(`DB: ${DB} ${dryRun ? '(DRY-RUN)' : ''}`);

// 1. Retornar mesas a estado libre (status=free, current_order_id=NULL)
let tablesReset = null;
try {
  const before = db.prepare(`SELECT COUNT(*) c FROM tables WHERE status != 'free' OR current_order_id IS NOT NULL`).get();
  if (!dryRun) {
    // Restablecer estado de mesa y pedido activo (barra/mesas ocupadas)
    tablesReset = db.prepare(`UPDATE tables SET status = 'free', current_order_id = NULL, assigned_waiter_id = NULL`).run().changes;
  } else {
    tablesReset = before.c;
  }
  console.log(`  tables: ${before.c} no-libres → reset a free (${tablesReset})`);
} catch (e) {
  console.log(`  tables: skip (${e.message})`);
}

// 2. Borrar filas transaccionales y resetear secuencia/AUTOINCREMENT
for (const t of TABLES) {
  let count = 0;
  let hasColumn = true;
  try {
    count = db.prepare(`SELECT COUNT(*) c FROM ${t}`).get().c;
  } catch (e) {
    hasColumn = false;
    console.log(`  ${t}: skip (${e.message})`);
  }
  if (!hasColumn) continue;
  if (!dryRun) {
    db.prepare(`DELETE FROM ${t}`).run();
    // Resetear AUTOINCREMENT si existe la columna id INTEGER PRIMARY KEY AUTOINCREMENT
    try {
      const sqliteSeq = db.prepare(
        `SELECT name FROM sqlite_master WHERE type='table' AND name='sqlite_sequence'`
      ).get();
      if (sqliteSeq) db.prepare(`DELETE FROM sqlite_sequence WHERE name = ?`).run(t);
    } catch { /* noop */ }
  }
  console.log(`  ${t}: ${count} filas ${dryRun ? '(se borrarían)' : '→ eliminadas'}`);
}

console.log(dryRun ? 'DRY-RUN completado — no se modificó nada.' : 'Limpieza completada ✓');
