import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { applySchema, SCHEMA_VERSION } from '../../server/db/schema.js';
import { recordMixedPayment } from '../../server/services/financial/payment-service.js';

function world() {
  const db = new Database(':memory:');
  applySchema(db);
  db.prepare("INSERT INTO staff (id, pin_hash, role, display_name) VALUES ('s1', 'x', 'admin', 'Admin')").run();
  db.prepare("INSERT INTO tables (id, number) VALUES ('t1', 1)").run();
  db.prepare("INSERT INTO orders (id, table_id, table_number, waiter_id, waiter_name, total, status) VALUES ('o1', 't1', 1, 's1', 'Admin', 10000, 'served')").run();
  return db;
}

describe('financial mixed payments', () => {
  it('records cash and QR atomically and marks the order paid', () => {
    const db = world();
    const result = recordMixedPayment(db, {
      orderId: 'o1', idempotencyKey: 'op-1', processedBy: 's1',
      allocations: [
        { method: 'cash', amount: 4000, received: 5000 },
        { method: 'qr', amount: 6000, reference: 'qr-1' },
      ],
    });
    expect(result).toMatchObject({ order_total: 10000, paid_amount: 10000, remaining: 0, is_fully_paid: true });
    expect(result.by_method).toEqual({ cash: 4000, qr: 6000 });
    expect(db.prepare('SELECT COUNT(*) count FROM payments').get().count).toBe(2);
    expect(db.prepare('SELECT status FROM orders WHERE id = \'o1\'').get().status).toBe('paid');
    expect(SCHEMA_VERSION).toBe(15);
    db.close();
  });

  it('returns the original result for a repeated idempotency key', () => {
    const db = world();
    const input = { orderId: 'o1', idempotencyKey: 'op-2', processedBy: 's1', allocations: [{ method: 'qr', amount: 10000 }] };
    const first = recordMixedPayment(db, input);
    const second = recordMixedPayment(db, input);
    expect(second).toEqual(first);
    expect(db.prepare('SELECT COUNT(*) count FROM payments').get().count).toBe(1);
    db.close();
  });
});
