/**
 * extras-service.js — Extras por GRUPO del menú (v15 2026-08-29).
 *
 * Los extras se definen a nivel de CATEGORÍA (grupo) y aplican a todos los
 * items del grupo. El módulo KDS se hereda del grupo (pizzas→cocina,
 * micheladas→bar). El mesero los marca como modificadores del item al
 * abrirlo (aparecen como un grupo "Extras" multi-select).
 */

import { randomUUID } from 'node:crypto';
import { getDb } from '../db/index.js';

export function listExtras(categoryId) {
  const db = getDb();
  return db.prepare(`SELECT * FROM category_extras WHERE category_id = ? ORDER BY sort_order, name`).all(categoryId);
}

/** Extras ACTIVOS de un grupo (para el mesero al abrir un item). */
export function activeExtrasForCategory(categoryId) {
  const db = getDb();
  return db.prepare(`SELECT id, name, price FROM category_extras WHERE category_id = ? AND active = 1 ORDER BY sort_order, name`).all(categoryId);
}

export function createExtra(categoryId, data) {
  const db = getDb();
  const id = randomUUID();
  db.prepare(`INSERT INTO category_extras (id, category_id, name, price, active, sort_order, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`)
    .run(id, categoryId, data.name, data.price || 0, data.active === false ? 0 : 1, data.sort_order || 0);
  return db.prepare('SELECT * FROM category_extras WHERE id = ?').get(id);
}

export function updateExtra(id, data) {
  const db = getDb();
  db.prepare(`UPDATE category_extras SET name=?, price=?, active=?, sort_order=?, updated_at=datetime('now') WHERE id=?`)
    .run(data.name, data.price || 0, data.active === false ? 0 : 1, data.sort_order || 0, id);
  return db.prepare('SELECT * FROM category_extras WHERE id = ?').get(id);
}

export function deleteExtra(id) {
  const db = getDb();
  db.prepare('DELETE FROM category_extras WHERE id = ?').run(id);
}

export default {
  listExtras,
  activeExtrasForCategory,
  createExtra,
  updateExtra,
  deleteExtra,
};