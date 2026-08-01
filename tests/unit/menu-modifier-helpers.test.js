/**
 * Menu Modifier Helper Tests
 *
 * TDD: Tests for createModifierGroupsForItem() — the pure DB helper
 * that builds a "Tamaño" modifier group + per-size options for a
 * menu item that has size_variants (pizzas, etc).
 *
 * Verifies:
 *  - items with size_variants get a "Tamaño" modifier group
 *  - one modifier_option per size is created
 *  - each option has the correct price_adjustment
 *  - first option is default
 *  - existing groups for the same item are updated, options replaced
 *  - null/empty size_variants is a no-op
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createModifierGroupsForItem } from '../../server/scripts/menu-modifier-helpers.js';

// In-memory mock that emulates better-sqlite3 prepare/run/get
function makeDb() {
  const groups = new Map();   // id -> group row
  const options = new Map();  // id -> option row
  let nextId = 1;
  const newId = () => `id-${nextId++}`;

  const db = {
    groups,
    options,
    prepare(sql) {
      return {
        get(...args) {
          if (sql.includes('FROM modifier_groups WHERE menu_item_id')) {
            const [menu_item_id, name] = args;
            for (const g of groups.values()) {
              if (g.menu_item_id === menu_item_id && g.name === name) return g;
            }
            return undefined;
          }
          return undefined;
        },
        run(...args) {
          if (sql.includes('INSERT INTO modifier_groups')) {
            // Helper SQL has literals: VALUES (?, ?, 'Tamaño', 'select', 1, 1, 1, 0)
            const [id, menu_item_id] = args;
            groups.set(id, {
              id, menu_item_id,
              name: 'Tamaño', type: 'select',
              required: 1, min_select: 1, max_select: 1, sort_order: 0,
            });
            return { changes: 1 };
          }
          if (sql.includes('UPDATE modifier_groups')) {
            // Helper SQL: SET type = 'select', required = 1, min_select = 1, max_select = 1 WHERE id = ?
            const [id] = args;
            const g = groups.get(id);
            if (g) {
              g.type = 'select'; g.required = 1; g.min_select = 1; g.max_select = 1;
            }
            return { changes: 1 };
          }
          if (sql.includes('DELETE FROM modifier_options')) {
            const [group_id] = args;
            let count = 0;
            for (const [oid, opt] of options) {
              if (opt.group_id === group_id) { options.delete(oid); count++; }
            }
            return { changes: count };
          }
          if (sql.includes('INSERT INTO modifier_options')) {
            const [id, group_id, name, price_adjustment, is_default, sort_order] = args;
            options.set(id, { id, group_id, name, price_adjustment, is_default, sort_order });
            return { changes: 1 };
          }
          return { changes: 0 };
        },
      };
    },
  };
  return db;
}

describe('createModifierGroupsForItem', () => {
  let db;

  beforeEach(() => {
    db = makeDb();
  });

  it('creates a "Tamaño" group for a pizza with size_variants', () => {
    const groupId = createModifierGroupsForItem(db, 'item-1', {
      mediana: 40, familiar: 60, xl: 80,
    });
    expect(groupId).toBeTruthy();
    const group = db.groups.get(groupId);
    expect(group.name).toBe('Tamaño');
    expect(group.type).toBe('select');
    expect(group.required).toBe(1);
    expect(group.min_select).toBe(1);
    expect(group.max_select).toBe(1);
  });

  it('creates one modifier_option per size with correct price_adjustment', () => {
    const groupId = createModifierGroupsForItem(db, 'item-2', {
      mediana: 40, familiar: 60, xl: 80,
    });
    const opts = Array.from(db.options.values());
    expect(opts.length).toBe(3);
    const byName = Object.fromEntries(opts.map(o => [o.name, o]));
    expect(byName['Mediana'].price_adjustment).toBe(40);
    expect(byName['Familiar'].price_adjustment).toBe(60);
    expect(byName['XL'].price_adjustment).toBe(80);
  });

  it('first option (Mediana) is marked as default', () => {
    const groupId = createModifierGroupsForItem(db, 'item-3', {
      mediana: 40, familiar: 60, xl: 80,
    });
    const opts = Array.from(db.options.values());
    const defaults = opts.filter(o => o.is_default);
    expect(defaults.length).toBe(1);
    expect(defaults[0].name).toBe('Mediana');
  });

  it('is a no-op when size_variants is null', () => {
    const result = createModifierGroupsForItem(db, 'item-4', null);
    expect(result).toBeNull();
    expect(db.groups.size).toBe(0);
    expect(db.options.size).toBe(0);
  });

  it('is a no-op when size_variants is empty object', () => {
    const result = createModifierGroupsForItem(db, 'item-5', {});
    expect(result).toBeNull();
    expect(db.groups.size).toBe(0);
  });

  it('is a no-op when menuItemId is missing', () => {
    const result = createModifierGroupsForItem(db, null, { mediana: 40 });
    expect(result).toBeNull();
  });

  it('preserves size order (sort_order matches input key order)', () => {
    const groupId = createModifierGroupsForItem(db, 'item-6', {
      xl: 80, mediana: 40, familiar: 60,
    });
    const opts = Array.from(db.options.values()).sort((a, b) => a.sort_order - b.sort_order);
    expect(opts[0].name).toBe('XL');
    expect(opts[1].name).toBe('Mediana');
    expect(opts[2].name).toBe('Familiar');
  });

  it('is idempotent — re-running does not create duplicate group', () => {
    const firstId = createModifierGroupsForItem(db, 'item-7', { mediana: 40, familiar: 60 });
    expect(db.groups.size).toBe(1);

    // Re-seed with updated prices — should UPDATE the existing group, not insert
    const secondId = createModifierGroupsForItem(db, 'item-7', { mediana: 45, familiar: 65, xl: 90 });
    expect(db.groups.size).toBe(1);
    expect(secondId).toBe(firstId);

    // Options should be replaced, not duplicated
    const opts = Array.from(db.options.values());
    expect(opts.length).toBe(3);
    const byName = Object.fromEntries(opts.map(o => [o.name, o]));
    expect(byName['Mediana'].price_adjustment).toBe(45);
    expect(byName['XL'].price_adjustment).toBe(90);
  });

  it('accepts null prices in size_variants (treats as 0)', () => {
    const groupId = createModifierGroupsForItem(db, 'item-8', {
      mediana: null, familiar: 60, xl: null,
    });
    const opts = Array.from(db.options.values());
    const byName = Object.fromEntries(opts.map(o => [o.name, o]));
    expect(byName['Mediana'].price_adjustment).toBe(0);
    expect(byName['XL'].price_adjustment).toBe(0);
  });

  it('uses a friendly label for known size keys (mediana → Mediana)', () => {
    createModifierGroupsForItem(db, 'item-9', { mediana: 40 });
    const opts = Array.from(db.options.values());
    expect(opts[0].name).toBe('Mediana');
  });

  it('capitalizes unknown size keys as a fallback', () => {
    createModifierGroupsForItem(db, 'item-10', { super_extra: 100 });
    const opts = Array.from(db.options.values());
    expect(opts[0].name).toBe('Super_extra');
  });
});
