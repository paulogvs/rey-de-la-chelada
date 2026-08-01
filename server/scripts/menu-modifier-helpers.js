/**
 * Menu Modifier Helpers — Pure DB functions for modifier groups.
 *
 * Extracted from load-menu.js so they can be unit-tested without
 * the top-level load-menu script executing.
 *
 * All functions are idempotent — safe to call multiple times.
 */

import { randomUUID } from 'node:crypto';

/**
 * Create a "Tamaño" modifier group for an item that has size_variants.
 * One modifier_option per size, with price_adjustment = the variant price.
 *
 * Idempotent: looks for an existing group with the same (menu_item_id, name)
 * and updates it instead of inserting a duplicate. Options are always
 * replaced so price changes from the seed propagate on re-run.
 *
 * @param {object} db — better-sqlite3 database instance
 * @param {string} menuItemId — the menu_items.id
 * @param {object} sizeVariants — e.g. { mediana: 40, familiar: 60, xl: 80 }
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

  // Replace options for this group so price changes from the seed propagate
  db.prepare('DELETE FROM modifier_options WHERE group_id = ?').run(groupId);

  const insertOption = db.prepare(`
    INSERT INTO modifier_options (id, group_id, name, price_adjustment, is_default, sort_order)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const sizeLabel = {
    mediana: 'Mediana', familiar: 'Familiar', xl: 'XL',
    pequena: 'Pequeña', grande: 'Grande',
  };
  let sortOrder = 0;
  for (const sizeKey of sizes) {
    const label = sizeLabel[sizeKey] || sizeKey.charAt(0).toUpperCase() + sizeKey.slice(1);
    const price = typeof sizeVariants[sizeKey] === 'number' ? sizeVariants[sizeKey] : 0;
    insertOption.run(
      randomUUID(), groupId, label, price, sortOrder === 0 ? 1 : 0, sortOrder
    );
    sortOrder++;
  }

  return groupId;
}
