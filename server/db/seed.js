/**
 * ═══════════════════════════════════════════════════════════
 *  SEED — Datos iniciales (idempotente)
 *
 *  Uso: node server/db/seed.js
 *
 *  Crea si no existen:
 *    - Staff: admin (PIN 0000), mesero (PIN 1111), kds (PIN 2222), caja (PIN 3333)
 *    - Mesas 1-10
 *    - Categorías + items de menú de ejemplo
 *
 *  v2: shared PIN per role.
 *  v5: + rol 'caja' (S1) — cajero separado del admin, PIN 3333.
 *  Alineado al SSOT: server/db/schema.js
 * ═══════════════════════════════════════════════════════════
 */

import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { pathToFileURL } from 'node:url';
import { getDb, closeDb } from './index.js';

// ============================================================
// Staff (shared PIN per role)
// ============================================================

/**
 * Ensure a staff role exists with the given PIN (idempotent).
 * @param {object} db — better-sqlite3 instance
 * @param {{ pin: string|number, role: string, display_name: string }} opts
 * @returns {{ created: boolean, role: string }}
 */
export function ensureStaff(db, { pin, role, display_name }) {
  const existing = db.prepare('SELECT id FROM staff WHERE role = ?').get(role);
  if (existing) {
    return { created: false, role };
  }
  const pinHash = bcrypt.hashSync(String(pin), 10);
  db.prepare(
    'INSERT INTO staff (id, pin_hash, role, display_name) VALUES (?, ?, ?, ?)'
  ).run(randomUUID(), pinHash, role, display_name);
  return { created: true, role };
}

// ============================================================
// Tables
// ============================================================

/**
 * Ensure tables 1..count exist (idempotent).
 * @param {object} db — better-sqlite3 instance
 * @param {number} [count=10]
 * @returns {{ created: number }}
 */
export function ensureTables(db, count = 10) {
  let created = 0;
  for (let i = 1; i <= count; i++) {
    const existing = db.prepare('SELECT id FROM tables WHERE number = ?').get(i);
    if (!existing) {
      db.prepare(
        'INSERT INTO tables (id, number, capacity, status, section, position) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(randomUUID(), i, i <= 6 ? 4 : 6, 'free', i % 2 === 0 ? 'terraza' : 'interior', i);
      created++;
    }
  }
  return { created };
}

// ============================================================
// Menu — el menú REAL lo carga load-menu.js (menu-seed.json = SSOT).
// Aquí NO se siembran categorías genéricas: el menú de producción
// (8 categorías / 49 items) proviene exclusivamente de
// src/core/data/menu-seed.json vía server/db/bootstrap.js.
// ============================================================

// ============================================================
// Run (v2: 3 roles only)
// ============================================================

export function runSeed(db = getDb()) {
  const ADMIN_PIN = process.env.ADMIN_PIN || '0000';
  const MESERO_PIN = process.env.MESERO_PIN || '1111';
  const KDS_PIN = process.env.KDS_PIN || '2222';
  const CAJA_PIN = process.env.CAJA_PIN || '3333';

  ensureStaff(db, { pin: ADMIN_PIN, role: 'admin', display_name: 'Administrador' });
  ensureStaff(db, { pin: MESERO_PIN, role: 'mesero', display_name: 'Mesero' });
  ensureStaff(db, { pin: KDS_PIN, role: 'kds', display_name: 'KDS' });
  ensureStaff(db, { pin: CAJA_PIN, role: 'caja', display_name: 'Cajero' });

  // ⚠️ M4/2.8: 10 = SSOT src/core/config/app.config.ts (capacity.totalTables).
  // DEFAULT_TABLES env lo sobreescribe en runtime (ver bootstrap.js).
  ensureTables(db, parseInt(process.env.DEFAULT_TABLES || '10', 10));

  return db;
}

// CLI entry — solo cuando se ejecuta directamente
const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  runSeed();
  console.log('[Seed] Completo ✅');
  closeDb();
}
