/**
 * Prices File Validation Tests
 *
 * TDD: validatePricesFile parses + validates the user-filled prices JSON
 * (data/prices.json or data/prices-template.json) before applying it to the DB.
 * Returns { valid, errors, items } where items are the validated entries.
 */

import { describe, it, expect } from 'vitest';
import {
  validatePricesFile,
  validateModifierOptionUpdate,
  applyBulkModifierPriceUpdates,
} from '../../server/services/menu-bulk-updates.js';

// In-memory DB mock that tracks modifier_options
function makeModifierDb() {
  const options = new Map();
  return {
    options,
    prepare(sql) {
      return {
        get(...args) {
          if (sql.includes('FROM modifier_options WHERE id =')) {
            const [id] = args;
            return options.has(id) ? { id } : undefined;
          }
          return undefined;
        },
        run(...args) {
          if (sql.includes('UPDATE modifier_options SET price_adjustment')) {
            const [price, id] = args;
            const opt = options.get(id);
            if (opt) {
              opt.price_adjustment = price;
              return { changes: 1 };
            }
            return { changes: 0 };
          }
          return { changes: 0 };
        },
      };
    },
    transaction(fn) {
      return entries => fn(entries);
    },
  };
}

describe('validatePricesFile', () => {
  it('accepts a valid file with positive prices', () => {
    const file = {
      currency: 'BOB',
      items: [
        { id: 'i1', name: 'Cheve-Chango', category: 'Micheladas', price: 25 },
        { id: 'i2', name: 'César', category: 'Ensaladas', price: 45.5 },
      ],
    };
    const r = validatePricesFile(file);
    expect(r.valid).toBe(true);
    expect(r.errors).toEqual([]);
    expect(r.items).toHaveLength(2);
  });

  it('skips items with null price (not yet filled)', () => {
    const file = {
      currency: 'BOB',
      items: [
        { id: 'i1', name: 'Cheve-Chango', category: 'Micheladas', price: 25 },
        { id: 'i2', name: 'César', category: 'Ensaladas', price: null },
      ],
    };
    const r = validatePricesFile(file);
    expect(r.valid).toBe(true);
    expect(r.items).toHaveLength(1);
    expect(r.skipped).toBe(1);
  });

  it('rejects a missing items array', () => {
    const r = validatePricesFile({ currency: 'BOB' });
    expect(r.valid).toBe(false);
  });

  it('rejects items that are not an array', () => {
    const r = validatePricesFile({ currency: 'BOB', items: 'nope' });
    expect(r.valid).toBe(false);
  });

  it('rejects negative prices', () => {
    const r = validatePricesFile({
      currency: 'BOB',
      items: [{ id: 'i1', name: 'X', category: 'Y', price: -5 }],
    });
    expect(r.valid).toBe(false);
    expect(r.errors[0].id).toBe('i1');
  });

  it('rejects zero prices (a product cannot be free by accident)', () => {
    const r = validatePricesFile({
      currency: 'BOB',
      items: [{ id: 'i1', name: 'X', category: 'Y', price: 0 }],
    });
    expect(r.valid).toBe(false);
  });

  it('rejects non-numeric prices', () => {
    const r = validatePricesFile({
      currency: 'BOB',
      items: [{ id: 'i1', name: 'X', category: 'Y', price: 'veinte' }],
    });
    expect(r.valid).toBe(false);
  });

  it('rejects items missing an id', () => {
    const r = validatePricesFile({
      currency: 'BOB',
      items: [{ name: 'X', category: 'Y', price: 10 }],
    });
    expect(r.valid).toBe(false);
  });

  it('collects multiple errors with indices', () => {
    const r = validatePricesFile({
      currency: 'BOB',
      items: [
        { id: 'i1', name: 'A', category: 'Y', price: -1 },
        { id: 'i2', name: 'B', category: 'Y', price: 'x' },
      ],
    });
    expect(r.valid).toBe(false);
    expect(r.errors).toHaveLength(2);
  });

  it('returns a file with only valid items when some are invalid', () => {
    const r = validatePricesFile({
      currency: 'BOB',
      items: [
        { id: 'i1', name: 'A', category: 'Y', price: 10 },
        { id: 'i2', name: 'B', category: 'Y', price: -1 },
      ],
    });
    expect(r.valid).toBe(false);
    expect(r.items).toHaveLength(1);
    expect(r.items[0].id).toBe('i1');
  });
});

describe('validateModifierOptionUpdate', () => {
  it('accepts a valid modifier option update', () => {
    expect(validateModifierOptionUpdate({ id: 'm1', priceAdjustment: 15 }))
      .toEqual({ valid: true, error: null });
  });

  it('accepts a zero adjustment (free option)', () => {
    expect(validateModifierOptionUpdate({ id: 'm1', priceAdjustment: 0 }))
      .toEqual({ valid: true, error: null });
  });

  it('rejects negative adjustments', () => {
    expect(validateModifierOptionUpdate({ id: 'm1', priceAdjustment: -3 }).valid)
      .toBe(false);
  });

  it('rejects missing id', () => {
    expect(validateModifierOptionUpdate({ priceAdjustment: 15 }).valid).toBe(false);
  });

  it('rejects non-numeric adjustment', () => {
    expect(validateModifierOptionUpdate({ id: 'm1', priceAdjustment: '15' }).valid)
      .toBe(false);
  });
});

describe('applyBulkModifierPriceUpdates', () => {
  it('updates modifier option adjustments', () => {
    const db = makeModifierDb();
    db.options.set('m1', { id: 'm1', price_adjustment: 0 });
    db.options.set('m2', { id: 'm2', price_adjustment: 0 });

    const result = applyBulkModifierPriceUpdates(db, [
      { id: 'm1', priceAdjustment: 15 },
      { id: 'm2', priceAdjustment: 30 },
    ]);

    expect(result.updated).toBe(2);
    expect(db.options.get('m1').price_adjustment).toBe(15);
    expect(db.options.get('m2').price_adjustment).toBe(30);
  });

  it('reports not_found for unknown option ids', () => {
    const db = makeModifierDb();
    const result = applyBulkModifierPriceUpdates(db, [
      { id: 'ghost', priceAdjustment: 15 },
    ]);
    expect(result.updated).toBe(0);
    expect(result.failed).toBe(1);
    expect(result.errors).toEqual([{ id: 'ghost', reason: 'not_found' }]);
  });

  it('throws when db is missing', () => {
    expect(() => applyBulkModifierPriceUpdates(null, [])).toThrow();
  });
});
