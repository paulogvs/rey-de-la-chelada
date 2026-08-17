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
          if (sql.includes('FROM modifier_options WHERE group_id') && sql.includes('name')) {
            // P0-2 UPSERT lookup: SELECT id, price_adjustment FROM modifier_options WHERE group_id = ? AND name = ?
            const [group_id, name] = args;
            for (const opt of options.values()) {
              if (opt.group_id === group_id && opt.name === name) return opt;
            }
            return undefined;
          }
          return undefined;
        },
        run(...args) {
          if (sql.includes('INSERT INTO modifier_groups')) {
            if (sql.includes('Adicionales')) {
              // Sprint 1 (D): VALUES (?, ?, 'Adicionales', 'multi', 0, 0, ?, 1)
              const [id, menu_item_id, max_select] = args;
              groups.set(id, {
                id, menu_item_id,
                name: 'Adicionales', type: 'multi',
                required: 0, min_select: 0, max_select, sort_order: 1,
              });
              return { changes: 1 };
            }
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
            if (sql.includes('max_select')) {
              // Sprint 1 (D): SET type='multi', required=0, min_select=0, max_select=? WHERE id=?
              const [max_select, id] = args;
              const g = groups.get(id);
              if (g) {
                g.type = 'multi'; g.required = 0; g.min_select = 0; g.max_select = max_select;
              }
              return { changes: 1 };
            }
            // Helper SQL: SET type = 'select', required = 1, min_select = 1, max_select = 1 WHERE id = ?
            const [id] = args;
            const g = groups.get(id);
            if (g) {
              g.type = 'select'; g.required = 1; g.min_select = 1; g.max_select = 1;
            }
            return { changes: 1 };
          }
          if (sql.includes('UPDATE modifier_options')) {
            if (sql.includes('is_default')) {
              // P0-2 (2026-08-11): UPSERT tamaños — SET price_adjustment=?, is_default=?, sort_order=? WHERE id=?
              const [price_adjustment, is_default, sort_order, id] = args;
              const opt = options.get(id);
              if (opt) {
                opt.price_adjustment = price_adjustment;
                opt.is_default = is_default;
                opt.sort_order = sort_order;
              }
            } else {
              // Sprint 1 (D): UPSERT adicionales — SET price_adjustment=?, sort_order=? WHERE id=?
              const [price_adjustment, sort_order, id] = args;
              const opt = options.get(id);
              if (opt) {
                opt.price_adjustment = price_adjustment;
                opt.sort_order = sort_order;
              }
            }
            return { changes: 1 };
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

  // ═══ P0-1/P0-2 (2026-08-11) — fixes del bootstrap ═══════════

  it('P0-2: re-run conserva los option_ids (UPSERT por nombre, sin regenerar UUIDs)', () => {
    // 1ª carga con precios
    const firstOpts = [];
    createModifierGroupsForItem(db, 'item-11', { mediana: 50, familiar: 70, xl: 90 });
    Array.from(db.options.values()).forEach(o => firstOpts.push({ name: o.name, id: o.id }));

    // 2ª carga (simula restart del server — loadMenuFromSeed corre otra vez)
    createModifierGroupsForItem(db, 'item-11', { mediana: 50, familiar: 70, xl: 90 });

    const secondOpts = Array.from(db.options.values());
    expect(secondOpts.length).toBe(3); // sin duplicados
    for (const fo of firstOpts) {
      const match = secondOpts.find(o => o.name === fo.name);
      expect(match.id).toBe(fo.id); // MISMO id — no regenerado
    }
  });

  it('P0-1: seed con precios null NO pisa price_adjustment existente (demo-prices)', () => {
    // Simula: applyDemoPrices ya puso +20/+40 en la DB
    createModifierGroupsForItem(db, 'item-12', { mediana: 0, familiar: 20, xl: 40 });

    // Restart: load-menu re-corre con seed null (precios: { mediana: null, familiar: null, xl: null })
    createModifierGroupsForItem(db, 'item-12', { mediana: null, familiar: null, xl: null });

    const byName = Object.fromEntries(Array.from(db.options.values()).map(o => [o.name, o]));
    expect(byName['Familiar'].price_adjustment).toBe(20); // conservado, NO 0
    expect(byName['XL'].price_adjustment).toBe(40);       // conservado, NO 0
  });

  it('P0-1: seed con precios numéricos SÍ actualiza price_adjustment', () => {
    createModifierGroupsForItem(db, 'item-13', { mediana: 0, familiar: 20, xl: 40 });
    // El seed trae precios nuevos (números) → se propagan
    createModifierGroupsForItem(db, 'item-13', { mediana: 0, familiar: 25, xl: 45 });

    const byName = Object.fromEntries(Array.from(db.options.values()).map(o => [o.name, o]));
    expect(byName['Familiar'].price_adjustment).toBe(25);
    expect(byName['XL'].price_adjustment).toBe(45);
  });
});

// ═══ Sprint 1 (D): adicionales como modifiers ═══════════════════
import { createAdditionsModifiersForItem } from '../../server/scripts/menu-modifier-helpers.js';

describe('createAdditionsModifiersForItem', () => {
  let db;

  beforeEach(() => {
    db = makeDb();
  });

  it('crea el grupo "Adicionales" (multi, opcional) con sus opciones y precios', () => {
    createAdditionsModifiersForItem(db, 'bar-001', [
      { nombre: 'Shot + Michelada', precio: 15 },
      { nombre: 'Doble Escarchado', precio: 5 },
    ]);

    const group = Array.from(db.groups.values())[0];
    expect(group.name).toBe('Adicionales');
    expect(group.type).toBe('multi');
    expect(group.required).toBe(0);
    expect(group.max_select).toBe(2);

    const byName = Object.fromEntries(Array.from(db.options.values()).map(o => [o.name, o]));
    expect(byName['Shot + Michelada'].price_adjustment).toBe(15);
    expect(byName['Doble Escarchado'].price_adjustment).toBe(5);
  });

  it('re-run es idempotente: actualiza el grupo existente sin duplicar opciones', () => {
    const additions = [
      { nombre: 'Shot + Michelada', precio: 15 },
      { nombre: 'Doble Escarchado', precio: 5 },
    ];
    createAdditionsModifiersForItem(db, 'bar-002', additions);
    const firstGroupId = Array.from(db.groups.values())[0].id;

    // Restart del server — load-menu re-corre con el mismo catálogo
    createAdditionsModifiersForItem(db, 'bar-002', additions);

    expect(db.groups.size).toBe(1);
    expect(db.options.size).toBe(2);
    expect(Array.from(db.groups.values())[0].id).toBe(firstGroupId);
  });

  it('actualiza el precio de una opción existente cuando el seed cambia', () => {
    createAdditionsModifiersForItem(db, 'bar-003', [{ nombre: 'Shot + Michelada', precio: 15 }]);
    createAdditionsModifiersForItem(db, 'bar-003', [{ nombre: 'Shot + Michelada', precio: 18 }]);

    const opt = Array.from(db.options.values())[0];
    expect(opt.name).toBe('Shot + Michelada');
    expect(opt.price_adjustment).toBe(18);
    expect(db.options.size).toBe(1); // sin duplicados
  });

  it('adicionales vacíos o sin nombre → no-op', () => {
    expect(createAdditionsModifiersForItem(db, 'bar-004', [])).toBeNull();
    expect(createAdditionsModifiersForItem(db, 'bar-004', null)).toBeNull();
    expect(createAdditionsModifiersForItem(db, 'bar-004', [{ nombre: '  ', precio: 5 }])).toBeNull();
    expect(db.groups.size).toBe(0);
    expect(db.options.size).toBe(0);
  });
});
