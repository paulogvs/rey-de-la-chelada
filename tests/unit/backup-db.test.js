/**
 * backup-db.mjs — Backup WAL-safe (fix N2 del audit 2026-08-28).
 *
 * Valida que el script:
 * 1. Crea un backup con DATOS reales (no un stub vacío de 4KB como el `copy` crudo)
 * 2. Verifica integridad del backup (orders presentes, integrity=ok)
 * 3. Prune: mantiene solo los `--keep` backups más recientes
 * 4. [SKIP] si la DB no existe (exit 0, sin error)
 */

import { describe, it, expect, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, statSync, utimesSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const PROJECT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPT = join(PROJECT_ROOT, 'scripts', 'backup-db.mjs');

const tmpDirs = [];

function makeTempDir() {
  const d = mkdtempSync(join(tmpdir(), 'rdc-backup-test-'));
  tmpDirs.push(d);
  return d;
}

function runBackup(env) {
  return execFileSync(process.execPath, [SCRIPT, '--keep=2'], {
    cwd: PROJECT_ROOT,
    env: { ...process.env, ...env },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

afterEach(() => {
  for (const d of tmpDirs.splice(0)) {
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {
      /* best-effort cleanup */
    }
  }
});

describe('backup-db.mjs (WAL-safe)', () => {
  it('crea un backup con DATOS (no un stub vacío) y verifica integridad', () => {
    const dir = makeTempDir();
    const dbPath = join(dir, 'test.db');

    // DB con datos reales
    const db = new Database(dbPath);
    db.exec('CREATE TABLE orders (id TEXT PRIMARY KEY, total INTEGER)');
    db.exec('CREATE TABLE menu_items (id TEXT PRIMARY KEY, name TEXT)');
    const ins = db.prepare('INSERT INTO orders VALUES (?, ?)');
    for (let i = 1; i <= 5; i++) ins.run(`ord-${i}`, i * 1000);
    db.prepare('INSERT INTO menu_items VALUES (?, ?)').run('m1', 'Cerveza');
    db.close();

    const out = runBackup({ DB_PATH: dbPath, BACKUP_DIR: join(dir, 'backups') });

    // Backup creado
    const files = readdirSync(join(dir, 'backups')).filter((f) => f.endsWith('.db'));
    expect(files).toHaveLength(1);
    const backupFile = join(dir, 'backups', files[0]);

    // El backup NO es un stub: debe tener peso y contener las órdenes
    const size = statSync(backupFile).size;
    expect(size).toBeGreaterThan(1024);

    const check = new Database(backupFile, { readonly: true });
    expect(check.pragma('integrity_check', { simple: true })).toBe('ok');
    expect(check.prepare('SELECT count(*) c FROM orders').get().c).toBe(5);
    expect(check.prepare('SELECT count(*) c FROM menu_items').get().c).toBe(1);
    check.close();

    expect(out).toContain('[OK] Backup:');
    expect(out).toContain('orders=5');
  });

  it('prune: mantiene solo los --keep backups más recientes', () => {
    const dir = makeTempDir();
    const dbPath = join(dir, 'test.db');
    const db = new Database(dbPath);
    db.exec('CREATE TABLE orders (id TEXT PRIMARY KEY)');
    db.prepare('INSERT INTO orders VALUES (?)').run('a');
    db.close();

    const backupDir = join(dir, 'backups');
    mkdirSync(backupDir, { recursive: true });
    // 3 backups viejos (mtime antiguo)
    for (const name of ['backup-2026-01-01_00-00-00.db', 'backup-2026-01-02_00-00-00.db', 'backup-2026-01-03_00-00-00.db']) {
      const f = join(backupDir, name);
      writeFileSync(f, 'x');
      const old = new Date(Date.now() - 30 * 24 * 3600 * 1000);
      utimesSync(f, old, old);
    }

    runBackup({ DB_PATH: dbPath, BACKUP_DIR: backupDir });

    // keep=2 → solo quedan 2: el nuevo + el más reciente de los viejos
    const remaining = readdirSync(backupDir).filter((f) => f.endsWith('.db'));
    expect(remaining).toHaveLength(2);
    expect(remaining.some((f) => f.startsWith('backup-2026-01-03'))).toBe(true);
    expect(remaining.some((f) => f.startsWith('backup-2026-01-01'))).toBe(false);
    expect(remaining.some((f) => f.startsWith('backup-2026-01-02'))).toBe(false);
  });

  it('[SKIP] exit 0 si la DB no existe', () => {
    const dir = makeTempDir();
    const out = runBackup({ DB_PATH: join(dir, 'no-existe.db'), BACKUP_DIR: join(dir, 'backups') });
    expect(out).toContain('[SKIP]');
  });
});