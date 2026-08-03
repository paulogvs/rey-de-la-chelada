/**
 * Menu Bulk Update Tests
 *
 * TDD: Tests for the pure bulk-update helpers extracted from menu.js.
 * No Express, no DOM — just logic + a small in-memory DB mock.
 */

import { describe, it, expect } from 'vitest';
import {
  validatePriceUpdate,
  validateBulkPricesRequest,
  applyBulkPriceUpdates,
  validateModifierOptionUpdate,
  validateBulkModifierPricesRequest,
  applyBulkModifierPriceUpdates,
} from '../../server/services/menu-bulk-updates.js';

// In-memory DB mock that tracks menu_items
function makeDb() {
  const items = new Map();
  return {
    items,
    prepare(sql) {
      return {
        get(...args) {
          if (sql.includes('FROM menu_items WHERE id =')) {
            const [id] = args;
            return items.has(id) ? { id } : undefined;
          }
          return undefined;
        },
        run(...args) {
          if (sql.includes('UPDATE menu_items SET price')) {
            // Args: [price, id]
            const [price, id] = args;
            const item = items.get(id);
            if (item) {
              item.price = price;
              return { changes: 1 };
            }
            return { changes: 0 };
          }
          return { changes: 0 };
        },
      };
    },
    transaction(fn) {
      return (entries) => fn(entries);
    },
  };
}

describe('validatePriceUpdate', () => {
  it('accepts a valid entry', () => {
    expect(validatePriceUpdate({ id: 'i1', price: 50 })).toEqual({ valid: true, error: null });
  });

  it('accepts price 0', () => {
    expect(validatePriceUpdate({ id: 'i1', price: 0 })).toEqual({ valid: true, error: null });
  });

  it('accepts decimal prices', () => {
    expect(validatePriceUpdate({ id: 'i1', price: 49.99 })).toEqual({ valid: true, error: null });
  });

  it('rejects missing id', () => {
    expect(validatePriceUpdate({ price: 50 }).valid).toBe(false);
  });

  it('rejects non-string id', () => {
    expect(validatePriceUpdate({ id: 123, price: 50 }).valid).toBe(false);
  });

  it('rejects missing price', () => {
    expect(validatePriceUpdate({ id: 'i1' }).valid).toBe(false);
  });

  it('rejects string price', () => {
    expect(validatePriceUpdate({ id: 'i1', price: '50' }).valid).toBe(false);
  });

  it('rejects NaN price', () => {
    expect(validatePriceUpdate({ id: 'i1', price: NaN }).valid).toBe(false);
  });

  it('rejects negative price', () => {
    expect(validatePriceUpdate({ id: 'i1', price: -1 }).valid).toBe(false);
  });

  it('rejects null entry', () => {
    expect(validatePriceUpdate(null).valid).toBe(false);
  });
});

describe('validateBulkPricesRequest', () => {
  it('accepts a valid array', () => {
    const v = validateBulkPricesRequest({ updates: [{ id: 'i1', price: 50 }] });
    expect(v.valid).toBe(true);
  });

  it('rejects missing body', () => {
    expect(validateBulkPricesRequest().valid).toBe(false);
  });

  it('rejects missing updates field', () => {
    expect(validateBulkPricesRequest({}).valid).toBe(false);
  });

  it('rejects non-array updates', () => {
    expect(validateBulkPricesRequest({ updates: 'not-array' }).valid).toBe(false);
  });

  it('rejects empty array', () => {
    expect(validateBulkPricesRequest({ updates: [] }).valid).toBe(false);
  });

  it('reports the index of the first invalid entry', () => {
    const v = validateBulkPricesRequest({
      updates: [
        { id: 'i1', price: 50 },
        { id: 'i2' }, // missing price
      ],
    });
    expect(v.valid).toBe(false);
    expect(v.error).toMatch(/Item #2/);
  });
});

describe('applyBulkPriceUpdates', () => {
  it('updates multiple items in a single transaction', () => {
    const db = makeDb();
    db.items.set('i1', { id: 'i1', price: 10 });
    db.items.set('i2', { id: 'i2', price: 20 });
    db.items.set('i3', { id: 'i3', price: 30 });

    const result = applyBulkPriceUpdates(db, [
      { id: 'i1', price: 15 },
      { id: 'i2', price: 25 },
      { id: 'i3', price: 35 },
    ]);

    expect(result.updated).toBe(3);
    expect(result.failed).toBe(0);
    expect(db.items.get('i1').price).toBe(15);
    expect(db.items.get('i2').price).toBe(25);
    expect(db.items.get('i3').price).toBe(35);
  });

  it('skips non-existent IDs and reports them in errors', () => {
    const db = makeDb();
    db.items.set('i1', { id: 'i1', price: 10 });

    const result = applyBulkPriceUpdates(db, [
      { id: 'i1', price: 15 },
      { id: 'does-not-exist', price: 99 },
    ]);

    expect(result.updated).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.errors).toEqual([{ id: 'does-not-exist', reason: 'not_found' }]);
  });

  it('returns zero updates for an empty list (defensive)', () => {
    const db = makeDb();
    const result = applyBulkPriceUpdates(db, []);
    expect(result.updated).toBe(0);
    expect(result.failed).toBe(0);
  });

  it('throws when db is missing', () => {
    expect(() => applyBulkPriceUpdates(null, [{ id: 'i1', price: 10 }])).toThrow();
  });

  it('throws when updates is not an array', () => {
    const db = makeDb();
    expect(() => applyBulkPriceUpdates(db, null)).toThrow();
  });

  it('preserves unchanged items when only some are updated', () => {
    const db = makeDb();
    db.items.set('i1', { id: 'i1', price: 10 });
    db.items.set('i2', { id: 'i2', price: 20 });

    applyBulkPriceUpdates(db, [{ id: 'i1', price: 15 }]);

    expect(db.items.get('i1').price).toBe(15);
    expect(db.items.get('i2').price).toBe(20); // unchanged
  });
});

// In-memory DB mock for modifier_options
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
              opt.priceAdjustment = price;
              return { changes: 1 };
            }
            return { changes: 0 };
          }
          return { changes: 0 };
        },
      };
    },
    transaction(fn) {
      return (entries) => fn(entries);
    },
  };
}

describe('validateModifierOptionUpdate', () => {
  it('accepts a valid entry', () => {
    expect(validateModifierOptionUpdate({ id: 'mo1', priceAdjustment: 25 })).toEqual({ valid: true, error: null });
  });

  it('accepts priceAdjustment 0 (included in base price)', () => {
    expect(validateModifierOptionUpdate({ id: 'mo1', priceAdjustment: 0 })).toEqual({ valid: true, error: null });
  });

  it('rejects missing id', () => {
    expect(validateModifierOptionUpdate({ priceAdjustment: 25 }).valid).toBe(false);
  });

  it('rejects non-string id', () => {
    expect(validateModifierOptionUpdate({ id: 123, priceAdjustment: 25 }).valid).toBe(false);
  });

  it('rejects missing priceAdjustment', () => {
    expect(validateModifierOptionUpdate({ id: 'mo1' }).valid).toBe(false);
  });

  it('rejects string priceAdjustment', () => {
    expect(validateModifierOptionUpdate({ id: 'mo1', priceAdjustment: '25' }).valid).toBe(false);
  });

  it('rejects NaN priceAdjustment', () => {
    expect(validateModifierOptionUpdate({ id: 'mo1', priceAdjustment: NaN }).valid).toBe(false);
  });

  it('rejects negative priceAdjustment', () => {
    expect(validateModifierOptionUpdate({ id: 'mo1', priceAdjustment: -1 }).valid).toBe(false);
  });

  it('rejects null entry', () => {
    expect(validateModifierOptionUpdate(null).valid).toBe(false);
  });
});

describe('validateBulkModifierPricesRequest', () => {
  it('accepts a valid array of updates', () => {
    const v = validateBulkModifierPricesRequest({ updates: [{ id: 'mo1', priceAdjustment: 25 }] });
    expect(v.valid).toBe(true);
  });

  it('rejects missing body', () => {
    expect(validateBulkModifierPricesRequest().valid).toBe(false);
  });

  it('rejects missing updates field', () => {
    expect(validateBulkModifierPricesRequest({}).valid).toBe(false);
  });

  it('rejects non-array updates', () => {
    expect(validateBulkModifierPricesRequest({ updates: 'nope' }).valid).toBe(false);
  });

  it('rejects empty array', () => {
    expect(validateBulkModifierPricesRequest({ updates: [] }).valid).toBe(false);
  });

  it('reports the index of the first invalid entry', () => {
    const v = validateBulkModifierPricesRequest({
      updates: [
        { id: 'mo1', priceAdjustment: 25 },
        { id: 'mo2' }, // missing priceAdjustment
      ],
    });
    expect(v.valid).toBe(false);
    expect(v.error).toMatch(/Opción #2/);
  });
});

describe('applyBulkModifierPriceUpdates', () => {
  it('updates multiple options in a single transaction', () => {
    const db = makeModifierDb();
    db.options.set('mo1', { id: 'mo1', priceAdjustment: 0 });
    db.options.set('mo2', { id: 'mo2', priceAdjustment: 0 });

    const result = applyBulkModifierPriceUpdates(db, [
      { id: 'mo1', priceAdjustment: 25 },
      { id: 'mo2', priceAdjustment: 35 },
    ]);

    expect(result.updated).toBe(2);
    expect(result.failed).toBe(0);
    expect(db.options.get('mo1').priceAdjustment).toBe(25);
    expect(db.options.get('mo2').priceAdjustment).toBe(35);
  });

  it('skips non-existent IDs and reports them in errors', () => {
    const db = makeModifierDb();
    db.options.set('mo1', { id: 'mo1', priceAdjustment: 0 });

    const result = applyBulkModifierPriceUpdates(db, [
      { id: 'mo1', priceAdjustment: 25 },
      { id: 'does-not-exist', priceAdjustment: 99 },
    ]);

    expect(result.updated).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.errors).toEqual([{ id: 'does-not-exist', reason: 'not_found' }]);
  });

  it('returns zero updates for an empty list (defensive)', () => {
    const db = makeModifierDb();
    const result = applyBulkModifierPriceUpdates(db, []);
    expect(result.updated).toBe(0);
    expect(result.failed).toBe(0);
  });
});
