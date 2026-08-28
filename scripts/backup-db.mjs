#!/usr/bin/env node
/**
 * backup-db.mjs — Backup seguro de la DB SQLite (WAL-safe).
 *
 * v1.5 (2026-08-28): reemplaza el `copy` crudo de backup.bat, que producía
 * backups VACÍOS de ~4KB cuando los datos vivían en el WAL (bug N2 del audit).
 * Usa la API backup() de better-sqlite3, consistente online (hace checkpoint
 * interno y copia datos+WAL), y verifica integridad del archivo resultante.
 *
 * Uso:
 *   node scripts/backup-db.mjs                  # backup default → backups/backup-<ts>.db
 *   node scripts/backup-db.mjs --keep 14        # retiene 14 backups (default 7)
 *   DB_PATH=data/test.db node scripts/backup-db.mjs   # ruta explícita (env)
 *
 * Salida (stdout, lista para logs/backup.log):
 *   [OK] Backup: <ruta> (bytes=12345, orders=7, integrity=ok)
 *   [ERROR] ...
 * Exit code: 0 OK, 1 error.
 */

import { existsSync, mkdirSync, readdirSync, unlinkSync, statSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_DIR = resolve(__dirname, '..');

// ---------------------------------------------------------------------------
// Parsing mínimo de .env (sin dotenv): DB_PATH/DATABASE_PATH/DATABASE_URL,
// BACKUP_DIR. Respeta rutas relativas ("./data/...") y absolutas.
// ---------------------------------------------------------------------------
function loadEnv() {
  const out = {};
  const envFile = join(APP_DIR, '.env');
  if (existsSync(envFile)) {
    const text = readFileSync(envFile, 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
  return out;
}

function toAbsolute(appDir, p) {
  if (!p) return null;
  if (p.startsWith('.') || !/^[A-Za-z]:[\\/]/.test(p)) return resolve(appDir, p);
  return p;
}

// ---------------------------------------------------------------------------
// Timestamp local yyyy-MM-dd_HH-mm-ss
// ---------------------------------------------------------------------------
function timestamp() {
  const d = new Date();
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
}

async function main() {
  const args = process.argv.slice(2);
  const keepRaw = args.find((a) => a.startsWith('--keep='))?.split('=')[1] ?? '7';
  const keep = Math.max(1, parseInt(keepRaw, 10) || 7);

  const env = loadEnv();
  const dbPath =
    toAbsolute(APP_DIR, process.env.DB_PATH) ??
    toAbsolute(APP_DIR, env.DB_PATH) ??
    toAbsolute(APP_DIR, env.DATABASE_PATH) ??
    toAbsolute(APP_DIR, env.DATABASE_URL) ??
    join(APP_DIR, 'data', 'rey-de-la-chelada.db');
  const backupDir =
    toAbsolute(APP_DIR, process.env.BACKUP_DIR) ??
    toAbsolute(APP_DIR, env.BACKUP_DIR) ??
    join(APP_DIR, 'backups');

  if (!existsSync(dbPath)) {
    console.log(`[SKIP] No database found at ${dbPath}`);
    process.exit(0);
  }

  mkdirSync(backupDir, { recursive: true });

  const dest = join(backupDir, `backup-${timestamp()}.db`);
  let db;
  try {
    db = new Database(dbPath);
    db.pragma('wal_checkpoint(PASSIVE)');
    await db.backup(dest);
  } catch (err) {
    console.log(`[ERROR] Backup failed: ${err.message}`);
    process.exitCode = 1;
    return;
  } finally {
    if (db) db.close();
  }

  // Verificación: abrir el backup readonly + integrity_check + conteo de órdenes
  try {
    const check = new Database(dest, { readonly: true });
    const integrity = check.pragma('integrity_check', { simple: true });
    const orders = check.prepare('SELECT count(*) c FROM orders').get().c;
    const bytes = statSync(dest).size;
    check.close();
    if (integrity !== 'ok') throw new Error(`integrity_check = ${integrity}`);
    console.log(`[OK] Backup: ${dest} (bytes=${bytes}, orders=${orders}, integrity=ok)`);
  } catch (err) {
    console.log(`[ERROR] Backup verification failed: ${err.message}`);
    process.exitCode = 1;
    return;
  }

  // Prune: mantener los `keep` backups más recientes
  try {
    const files = readdirSync(backupDir)
      .filter((f) => /^backup-.*\.db$/.test(f))
      .map((f) => join(backupDir, f))
      .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
    for (const f of files.slice(keep)) {
      unlinkSync(f);
      console.log(`[PRUNE] Removed ${f}`);
    }
  } catch (err) {
    console.log(`[WARN] Prune failed (non-fatal): ${err.message}`);
  }
}

main();