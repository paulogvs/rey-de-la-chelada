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
// Menu (base genérico — el menú REAL lo carga load-menu.js)
// ============================================================

const CATEGORIES = [
  { name: 'Cervezas', emoji: '🍺', sort_order: 1 },
  { name: 'Tragos', emoji: '🍹', sort_order: 2 },
  { name: 'Comidas', emoji: '🍽', sort_order: 3 },
  { name: 'Entradas', emoji: '🥨', sort_order: 4 },
];

const ITEMS = {
  'Cervezas': [
    { name: 'Cerveza Pacena', price: 15, area: 'bar', sort_order: 1, size_variants: JSON.stringify({ media: 15, litro: 25 }) },
    { name: 'Cerveza Huari', price: 14, area: 'bar', sort_order: 2 },
    { name: 'Cerveza Taquina', price: 15, area: 'bar', sort_order: 3 },
    { name: 'Cerveza Sin Alcohol', price: 13, area: 'bar', sort_order: 4 },
  ],
  'Tragos': [
    { name: 'Cuba Libre', price: 35, area: 'bar', sort_order: 1 },
    { name: 'Mojito', price: 35, area: 'bar', sort_order: 2 },
    { name: 'Chelada Clásica', price: 20, area: 'bar', sort_order: 3, description: 'Cerveza con limón y sal' },
  ],
  'Comidas': [
    { name: 'Pique Macho', price: 85, area: 'cocina', sort_order: 1, preparation_time: 25, description: 'Carne, salchicha, papas y ají' },
    { name: 'Silpancho', price: 45, area: 'cocina', sort_order: 2, preparation_time: 20 },
    { name: 'Fricase', price: 40, area: 'cocina', sort_order: 3, preparation_time: 15 },
    { name: 'Picante de Pollo', price: 50, area: 'cocina', sort_order: 4, preparation_time: 25 },
  ],
  'Entradas': [
    { name: 'Papas Fritas', price: 18, area: 'cocina', sort_order: 1, preparation_time: 10 },
    { name: 'Salteñas (2)', price: 20, area: 'cocina', sort_order: 2, preparation_time: 10 },
    { name: 'Queso Frito', price: 25, area: 'cocina', sort_order: 3, preparation_time: 10 },
  ],
};

/**
 * Ensure the generic base menu exists (idempotent).
 * @param {object} db — better-sqlite3 instance
 */
export function ensureMenu(db) {
  for (const cat of CATEGORIES) {
    let category = db.prepare('SELECT id FROM menu_categories WHERE name = ?').get(cat.name);
    if (!category) {
      const id = randomUUID();
      db.prepare(
        'INSERT INTO menu_categories (id, name, emoji, sort_order) VALUES (?, ?, ?, ?)'
      ).run(id, cat.name, cat.emoji, cat.sort_order);
      category = { id };
    }

    for (const item of ITEMS[cat.name] || []) {
      const existing = db.prepare('SELECT id FROM menu_items WHERE name = ? AND category_id = ?').get(item.name, category.id);
      if (!existing) {
        db.prepare(`
          INSERT INTO menu_items (id, category_id, name, description, price, currency,
                                  is_active, is_available, preparation_time, sort_order, area, size_variants)
          VALUES (?, ?, ?, ?, ?, 'BOB', 1, 1, ?, ?, ?, ?)
        `).run(
          randomUUID(), category.id, item.name, item.description || '',
          item.price, item.preparation_time || 15, item.sort_order || 0, item.area, item.size_variants || null
        );
      }
    }
  }
}

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
  ensureMenu(db);

  return db;
}

// CLI entry — solo cuando se ejecuta directamente
const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  const db = runSeed();
  console.log('[Seed] Completo ✅');
  closeDb();
}
