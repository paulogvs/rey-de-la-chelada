/**
 * ═══════════════════════════════════════════════════════════
 *  DB — SQLite Database Connection (Singleton)
 *
 *  Artículo I: SSOT — Una sola conexión a la base de datos.
 *  Artículo VII: Secrets Boundary — Path desde .env, nunca hardcodeado.
 * ═══════════════════════════════════════════════════════════
 */

import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';
import { applySchema } from './schema.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// DB path: /data/rey-de-la-chelada.db (relativo a la raíz del proyecto)
const DB_DIR = path.resolve(__dirname, '..', '..', 'data');
const DB_PATH = path.join(DB_DIR, 'rey-de-la-chelada.db');

let _db = null;

/**
 * Get database instance (creates if first call)
 */
export function getDb() {
  if (_db) return _db;

  // Ensure data directory exists
  if (!fs.existsSync(DB_DIR)) {
    fs.mkdirSync(DB_DIR, { recursive: true });
  }

  console.log(`[DB] Opening database at ${DB_PATH}`);

  _db = new Database(DB_PATH, {
    // Enable WAL mode for better concurrent performance
    // Timeout 5s if busy
    timeout: 5000,
  });

  // Apply schema
  applySchema(_db);

  return _db;
}

/**
 * Close database connection
 */
export function closeDb() {
  if (_db) {
    _db.close();
    _db = null;
    console.log('[DB] Connection closed');
  }
}

/**
 * Get database path (for reference)
 */
export function getDbPath() {
  return DB_PATH;
}

export default { getDb, closeDb, getDbPath };
