/**
 * Menu Bulk Update Helpers — Pure DB functions for bulk price updates.
 *
 * Extracted from menu.js so the logic can be unit-tested without
 * an Express server.
 */
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

// ============================================================
// Prices File — validatePricesFile (load-prices.js + unit tests)
// ============================================================

/**
 * Validate a user-filled prices file (data/prices.json or template).
 *
 * Accepted shape:
 *   { currency: 'BOB', items: [{ id, name, category, price }], modifierOptions?: [{ id, name, priceAdjustment }] }
 *
 * - price === null  → skipped (not yet filled) — NOT an error
 * - price <= 0      → error (a product cannot be free by accident)
 * - price non-number → error
 * - items with errors are excluded from the returned items list.
 *
 * @param {object} pricesFile
 * @returns {{ valid: boolean, errors: Array<{id: string, index: number, reason: string}>, items: Array, skipped: number, modifierOptions: Array }}
 */
export function validatePricesFile(pricesFile) {
  if (!pricesFile || typeof pricesFile !== 'object') {
    return { valid: false, errors: [{ id: '(file)', index: -1, reason: 'Archivo de precios inválido' }], items: [], skipped: 0, modifierOptions: [] };
  }

  if (!Array.isArray(pricesFile.items)) {
    return { valid: false, errors: [{ id: '(file)', index: -1, reason: '`items` debe ser un array' }], items: [], skipped: 0, modifierOptions: [] };
  }

  const errors = [];
  const items = [];
  let skipped = 0;

  pricesFile.items.forEach((entry, index) => {
    if (!entry || typeof entry !== 'object') {
      errors.push({ id: String(entry?.id ?? ''), index, reason: 'Entrada inválida' });
      return;
    }
    if (!entry.id || typeof entry.id !== 'string') {
      errors.push({ id: String(entry.id ?? ''), index, reason: 'id requerido' });
      return;
    }
    if (entry.price === null || entry.price === undefined) {
      skipped++;
      return;
    }
    if (typeof entry.price !== 'number' || Number.isNaN(entry.price)) {
      errors.push({ id: entry.id, index, reason: 'price debe ser un número' });
      return;
    }
    if (entry.price <= 0) {
      errors.push({ id: entry.id, index, reason: 'price debe ser mayor a 0' });
      return;
    }
    items.push({ id: entry.id, name: entry.name || '', category: entry.category || '', price: entry.price });
  });

  // Modifier options are optional; validate the same way.
  const modifierOptions = [];
  const modifierErrors = [];
  if (Array.isArray(pricesFile.modifierOptions)) {
    pricesFile.modifierOptions.forEach((entry, index) => {
      const v = validateModifierOptionUpdate(entry);
      if (!v.valid) {
        modifierErrors.push({ id: String(entry?.id ?? ''), index, reason: v.error });
        return;
      }
      modifierOptions.push({ id: entry.id, name: entry.name || '', priceAdjustment: entry.priceAdjustment });
    });
  }

  const valid = errors.length === 0 && modifierErrors.length === 0;
  return {
    valid,
    errors: [...errors, ...modifierErrors],
    items,
    skipped,
    modifierOptions,
  };
}

/**
 * Validate a single modifier option update entry.
 * @returns {{ valid: boolean, error: string|null }}
 */
export function validateModifierOptionUpdate(entry) {
  if (!entry || typeof entry !== 'object') {
    return { valid: false, error: 'Entrada inválida' };
  }
  if (!entry.id || typeof entry.id !== 'string') {
    return { valid: false, error: 'id requerido' };
  }
  if (typeof entry.priceAdjustment !== 'number' || Number.isNaN(entry.priceAdjustment)) {
    return { valid: false, error: 'priceAdjustment numérico requerido' };
  }
  if (entry.priceAdjustment < 0) {
    return { valid: false, error: 'priceAdjustment no puede ser negativo' };
  }
  return { valid: true, error: null };
}

/**
 * Validate a bulk modifier options request shape.
 * @returns {{ valid: boolean, error: string|null }}
 */
export function validateBulkModifierPricesRequest(body) {
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
    const v = validateModifierOptionUpdate(body.updates[i]);
    if (!v.valid) {
      return { valid: false, error: `Opción #${i + 1}: ${v.error}` };
    }
  }
  return { valid: true, error: null };
}

/**
 * Apply price adjustments to modifier options (pizza sizes, etc).
 * Returns { updated, failed, errors }. Skips unknown ids (no throw).
 *
 * @param {object} db — better-sqlite3 db instance
 * @param {Array<{id: string, priceAdjustment: number}>} updates
 * @returns {{ updated: number, failed: number, errors: Array<{id: string, reason: string}> }}
 */
export function applyBulkModifierPriceUpdates(db, updates) {
  if (!db) throw new Error('db is required');
  if (!Array.isArray(updates)) throw new Error('updates must be an array');

  const updateStmt = db.prepare(`
    UPDATE modifier_options SET price_adjustment = ? WHERE id = ?
  `);
  const findStmt = db.prepare('SELECT id FROM modifier_options WHERE id = ?');

  let updated = 0;
  const errors = [];

  const tx = db.transaction((entries) => {
    for (const entry of entries) {
      const existing = findStmt.get(entry.id);
      if (!existing) {
        errors.push({ id: entry.id, reason: 'not_found' });
        continue;
      }
      updateStmt.run(entry.priceAdjustment, entry.id);
      updated++;
    }
  });
  tx(updates);

  return { updated, failed: errors.length, errors };
}
