/**
 * Menu Modifier Helpers — Pure DB functions for modifier groups.
 *
 * Extracted from load-menu.js so they can be unit-tested without
 * the top-level load-menu script executing.
 *
 * All functions are idempotent — safe to call multiple times.
 *
 * ⚠️ FIX P0-2 (2026-08-11): ANTES hacía DELETE + re-INSERT de options con
 * `randomUUID()` en cada arranque → los option_ids se regeneraban y el
 * carrito del cliente PWA (que guarda option_id) quedaba huérfano tras
 * cada restart (400 INVALID_MODIFIER_OPTION). Ahora hace UPSERT por
 * (group_id, name): conserva el id existente (IDs estables).
 *
 * ⚠️ FIX P0-1 (2026-08-11): ANTES, con seed `precios: {mediana: null, ...}`,
 * escribía price_adjustment = 0 en cada arranque → los ajustes de tamaño
 * de pizza (Mediana 0 / Familiar +20 / XL +40, aplicados por demo-prices)
 * se perdían silenciosamente (pérdida de ingresos). Ahora, si el seed trae
 * null para un tamaño, CONSERVA el price_adjustment existente en la DB.
 */

import { randomUUID } from 'node:crypto';

/**
 * Create a "Tamaño" modifier group for an item that has size_variants.
 * One modifier_option per size, with price_adjustment = the variant price.
 *
 * Idempotent: looks for an existing group with the same (menu_item_id, name)
 * and updates it instead of inserting a duplicate. Options are UPSERTED by
 * (group_id, name) — stable ids + preserved adjustments (P0-1/P0-2).
 *
 * @param {object} db — better-sqlite3 database instance
 * @param {string} menuItemId — the menu_items.id
 * @param {object} sizeVariants — e.g. { mediana: 40, familiar: 60, xl: 80 }
 *   (null price = keep existing adjustment, not force 0)
 * @returns {string|null} groupId if created/updated, null if skipped
 */
export function createModifierGroupsForItem(db, menuItemId, sizeVariants) {
  if (!db || !menuItemId || !sizeVariants || typeof sizeVariants !== 'object') {
    return null;
  }
  const sizes = Object.keys(sizeVariants);
  if (sizes.length === 0) return null;

  // Look for an existing "Tamaño" group on this item
  const existing = db.prepare(
    'SELECT id FROM modifier_groups WHERE menu_item_id = ? AND name = ?'
  ).get(menuItemId, 'Tamaño');

  let groupId;
  if (existing) {
    groupId = existing.id;
    db.prepare(`
      UPDATE modifier_groups
      SET type = 'select', required = 1, min_select = 1, max_select = 1
      WHERE id = ?
    `).run(groupId);
  } else {
    groupId = randomUUID();
    db.prepare(`
      INSERT INTO modifier_groups (id, menu_item_id, name, type, required, min_select, max_select, sort_order)
      VALUES (?, ?, 'Tamaño', 'select', 1, 1, 1, 0)
    `).run(groupId, menuItemId);
  }

  const sizeLabel = {
    mediana: 'Mediana', familiar: 'Familiar', xl: 'XL',
    pequena: 'Pequeña', grande: 'Grande',
  };

  // ── UPSERT options por (group_id, name) — P0-1/P0-2 ───────────
  const findOption = db.prepare(
    'SELECT id, price_adjustment FROM modifier_options WHERE group_id = ? AND name = ?'
  );
  const updateOption = db.prepare(`
    UPDATE modifier_options SET price_adjustment = ?, is_default = ?, sort_order = ?
    WHERE id = ?
  `);
  const insertOption = db.prepare(`
    INSERT INTO modifier_options (id, group_id, name, price_adjustment, is_default, sort_order)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  let sortOrder = 0;
  for (const sizeKey of sizes) {
    const label = sizeLabel[sizeKey] || sizeKey.charAt(0).toUpperCase() + sizeKey.slice(1);
    const seedPrice = sizeVariants[sizeKey];
    const hasSeedPrice = typeof seedPrice === 'number' && Number.isFinite(seedPrice);

    const existingOpt = findOption.get(groupId, label);
    if (existingOpt) {
      // P0-1: si el seed trae null → conservar el adjustment actual de la DB
      const newAdjustment = hasSeedPrice ? seedPrice : existingOpt.price_adjustment;
      updateOption.run(newAdjustment, sortOrder === 0 ? 1 : 0, sortOrder, existingOpt.id);
    } else {
      insertOption.run(
        randomUUID(), groupId, label, hasSeedPrice ? seedPrice : 0,
        sortOrder === 0 ? 1 : 0, sortOrder
      );
    }
    sortOrder++;
  }

  return groupId;
}
