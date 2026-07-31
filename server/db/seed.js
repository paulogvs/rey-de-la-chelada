/**
 * ═══════════════════════════════════════════════════════════
 *  SEED — Datos iniciales (idempotente)
 *
 *  Uso: node server/db/seed.js
 *
 *  Crea si no existen:
 *    - Staff: admin (PIN 0000), mesero (PIN 1111), kds (PIN 2222)
 *    - Mesas 1-10
 *    - Categorías + items de menú de ejemplo
 *
 *  v2: 3 roles only (admin, mesero, kds). Shared PIN per role.
 *  Alineado al SSOT: server/db/schema.js
 * ═══════════════════════════════════════════════════════════
 */

import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { getDb, closeDb } from './index.js';

const db = getDb();

// ============================================================
// Staff (v2: 3 roles, shared PIN per role)
// ============================================================

function ensureStaff({ pin, role, display_name }) {
  const existing = db.prepare('SELECT id FROM staff WHERE role = ?').get(role);
  if (existing) {
    console.log(`[Seed] Staff ${role} ya existe — skip`);
    return;
  }
  const pinHash = bcrypt.hashSync(String(pin), 10);
  db.prepare(
    'INSERT INTO staff (id, pin_hash, role, display_name) VALUES (?, ?, ?, ?)'
  ).run(randomUUID(), pinHash, role, display_name);
  console.log(`[Seed] Staff creado: ${role} (PIN ${pin})`);
}

// ============================================================
// Tables
// ============================================================

function ensureTables(count = 10) {
  for (let i = 1; i <= count; i++) {
    const existing = db.prepare('SELECT id FROM tables WHERE number = ?').get(i);
    if (!existing) {
      db.prepare(
        'INSERT INTO tables (id, number, capacity, status, section, position) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(randomUUID(), i, i <= 6 ? 4 : 6, 'free', i % 2 === 0 ? 'terraza' : 'interior', i);
    }
  }
  console.log(`[Seed] Mesas 1-${count} aseguradas`);
}

// ============================================================
// Menu
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

function ensureMenu() {
  for (const cat of CATEGORIES) {
    let category = db.prepare('SELECT id FROM menu_categories WHERE name = ?').get(cat.name);
    if (!category) {
      const id = randomUUID();
      db.prepare(
        'INSERT INTO menu_categories (id, name, emoji, sort_order) VALUES (?, ?, ?, ?)'
      ).run(id, cat.name, cat.emoji, cat.sort_order);
      category = { id };
      console.log(`[Seed] Categoría creada: ${cat.name}`);
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
  console.log('[Seed] Menú asegurado');
}

// ============================================================
// Run (v2: 3 roles only)
// ============================================================

const ADMIN_PIN = process.env.ADMIN_PIN || '0000';
const MESERO_PIN = process.env.MESERO_PIN || '1111';
const KDS_PIN = process.env.KDS_PIN || '2222';

ensureStaff({ pin: ADMIN_PIN, role: 'admin', display_name: 'Administrador' });
ensureStaff({ pin: MESERO_PIN, role: 'mesero', display_name: 'Mesero' });
ensureStaff({ pin: KDS_PIN, role: 'kds', display_name: 'KDS' });

ensureTables(10);
ensureMenu();

console.log('[Seed] Completo ✅');
closeDb();
