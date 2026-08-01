/**
 * Menu Bulk Update Helpers — Pure DB functions for bulk price updates.
 *
 * Extracted from menu.js so the logic can be unit-tested without
 * an Express server.
 */

import { randomUUID } from 'node:crypto';

/**
 * Validate the shape of an individual update entry.
 * @returns {{ valid: boolean, error: string|null }}
 */
export function validatePriceUpdate(entry) {
  if (!entry || typeof entry !== 'object') {
    return { valid: false, error: 'Entrada inválida' };
  }
  if (!entry.id || typeof entry.id !== 'string') {
    return { valid: false, error: 'id requerido' };
  }
  if (typeof entry.price !== 'number' || Number.isNaN(entry.price)) {
    return { valid: false, error: 'price numérico requerido' };
  }
  if (entry.price < 0) {
    return { valid: false, error: 'price no puede ser negativo' };
  }
  return { valid: true, error: null };
}

/**
 * Validate the bulk request shape.
 * @returns {{ valid: boolean, error: string|null }}
 */
export function validateBulkPricesRequest(body) {
  if (!body || typeof body !== 'object') {
    return { valid: false, error: 'Cuerpo requerido' };
  }
  if (!Array.isArray(body.updates)) {
    return { valid: false, error: '`updates` debe ser un array' };
  }
  if (body.updates.length === 0) {
    return { valid: false, error: 'Al menos una actualización requerida' };
  }
  for (let i = 0; i < body.updates.length; i++) {
    const v = validatePriceUpdate(body.updates[i]);
    if (!v.valid) {
      return { valid: false, error: `Item #${i + 1}: ${v.error}` };
    }
  }
  return { valid: true, error: null };
}

/**
 * Apply a list of price updates in a single transaction.
 * Returns { updated, failed, errors }.
 * Skips IDs that don't exist (does not throw).
 *
 * @param {object} db — better-sqlite3 db instance
 * @param {Array<{id: string, price: number}>} updates
 * @returns {{ updated: number, failed: number, errors: Array<{id: string, reason: string}> }}
 */
export function applyBulkPriceUpdates(db, updates) {
  if (!db) throw new Error('db is required');
  if (!Array.isArray(updates)) throw new Error('updates must be an array');

  const updateStmt = db.prepare(`
    UPDATE menu_items SET price = ?, updated_at = datetime('now') WHERE id = ?
  `);
  const findStmt = db.prepare('SELECT id FROM menu_items WHERE id = ?');

  let updated = 0;
  const errors = [];

  const tx = db.transaction((entries) => {
    for (const entry of entries) {
      const existing = findStmt.get(entry.id);
      if (!existing) {
        errors.push({ id: entry.id, reason: 'not_found' });
        continue;
      }
      updateStmt.run(entry.price, entry.id);
      updated++;
    }
  });
  tx(updates);

  return { updated, failed: errors.length, errors };
}
