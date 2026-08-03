/**
 * Client Orders — Public order creation for the clientes PWA.
 *
 * "El pedido activo es el permiso": the client creates an order with
 * NO JWT (table_number + session_id is the permission). The order is
 * created directly in 'called' status (the client already "sent" it),
 * so the mesero just needs to confirm it.
 *
 * TDD: tests written before the service implementation.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Simple in-memory DB mock (no better-sqlite3 dependency)
function createMockDb() {
  const tables = [
    { id: 't1', number: 1, status: 'free', capacity: 4 },
    { id: 't2', number: 2, status: 'free', capacity: 4 },
  ];
  const menuItems = [
    { id: 'm1', name: 'Chelada Clásica', price: 20, area: 'bar', category_id: 'c1', is_active: 1 },
    { id: 'm2', name: 'Pique Macho', price: 85, area: 'cocina', category_id: 'c2', is_active: 1 },
    { id: 'm3', name: 'Pizza La Rey', price: null, area: 'cocina', category_id: 'c3', is_active: 1 },
  ];
  const orders = [];
  const orderItems = [];
  const calls = [];
  const now = () => new Date().toISOString();
  const staff = [
    { id: 's-mesero', role: 'mesero', is_active: 1, display_name: 'Mesero', created_at: now() },
  ];

  // Statement shim: dispatches on SQL content, always returns an object
  // with .get/.all/.run so the service can call them uniformly.
  const stmt = (sql) => ({
    get: (...params) => {
      if (sql.includes('FROM staff WHERE role')) {
        return staff.find(s => s.role === params[0]) || undefined;
      }
      if (sql.includes('FROM tables WHERE number')) {
        return tables.find(t => t.number === Number(params[0])) || undefined;
      }
      if (sql.includes('FROM tables WHERE id')) {
        return tables.find(t => t.id === params[0]) || undefined;
      }
      if (sql.includes('FROM menu_items WHERE id')) {
        return menuItems.find(m => m.id === params[0]) || undefined;
      }
      if (sql.includes('FROM orders WHERE id')) {
        return orders.find(o => o.id === params[0]) || undefined;
      }
      if (sql.includes('FROM waiter_calls WHERE table_id') && sql.includes('pending')) {
        return calls.find(c => c.table_id === params[0] && c.status === 'pending') || undefined;
      }
      if (sql.includes('FROM orders o') && sql.includes('table_number')) {
        return orders.find(o => o.id === params[0]) || undefined;
      }
      return undefined;
    },
    all: (orderId) => {
      if (sql.includes('FROM order_items')) {
        return orderItems.filter(oi => oi.order_id === orderId);
      }
      return [];
    },
    run: (...params) => {
      if (sql.includes('INSERT INTO orders')) {
        // SQL: (id, table_id, table_number, waiter_id, waiter_name, status='called',
        //       subtotal, iva_amount, discount, discount_reason, total, notes, guest_count, local_id, is_paid)
        // → params: [0]id [1]table_id [2]table_number [3]waiter_id [4]waiter_name
        //           [5]subtotal [6]iva [7]total [8]notes [9]guest_count
        const order = {
          id: params[0], table_id: params[1], table_number: params[2], waiter_id: params[3],
          waiter_name: params[4], status: 'called', subtotal: params[5], iva_amount: params[6],
          total: params[7], notes: params[8], guest_count: params[9], created_at: now(),
        };
        orders.push(order);
        return { changes: 1, lastInsertRowid: 0 };
      }
      if (sql.includes('INSERT INTO order_items')) {
        orderItems.push({
          id: params[0], order_id: params[1], menu_item_id: params[2], menu_item_name: params[3],
          quantity: params[4], unit_price: params[5], modifiers_json: params[6],
          subtotal: params[7], status: params[8], preparation_notes: params[9], created_at: now(),
        });
        return { changes: 1, lastInsertRowid: 0 };
      }
      if (sql.includes('INSERT INTO waiter_calls')) {
        calls.push({ id: params[0], table_id: params[1], table_number: params[2], status: 'pending' });
        return { changes: 1, lastInsertRowid: 0 };
      }
      if (sql.includes('UPDATE tables SET status')) {
        const table = tables.find(t => t.id === params[1] || t.id === params[params.length - 1]);
        if (table) table.status = 'occupied';
        return { changes: 1 };
      }
      if (sql.includes('UPDATE orders SET status')) {
        const order = orders.find(o => o.id === params[params.length - 1]);
        if (order) order.status = params[0];
        return { changes: 1 };
      }
      return { changes: 1 };
    },
  });

  return {
    _state: { tables, menuItems, orders, orderItems, calls, staff },
    prepare: (sql) => stmt(sql),
    transaction: (fn) => fn,
  };
}

vi.mock('../../server/db/index.js', () => ({
  getDb: vi.fn(() => mockDb),
}));

let mockDb;

beforeEach(() => {
  mockDb = createMockDb();
});

describe('createPublicOrder service', () => {
  it('creates a called order for the table with computed totals', async () => {
    const { createPublicOrder } = await import('../../server/services/client-orders.js');
    const result = createPublicOrder(mockDb, {
      table_number: 1,
      session_id: 'abc-123',
      items: [{ menu_item_id: 'm1', quantity: 2 }, { menu_item_id: 'm2', quantity: 1 }],
    });

    expect(result.success).toBe(true);
    const order = mockDb._state.orders[0];
    expect(order.status).toBe('called');
    expect(order.table_number).toBe(1);
    // m1: 20 * 2 = 40, m2: 85 * 1 = 85 → subtotal 125, iva 13% = 16.25, total 141.25
    expect(order.subtotal).toBe(125);
    expect(order.iva_amount).toBe(16.25);
    expect(order.total).toBe(141.25);
    expect(mockDb._state.orderItems).toHaveLength(2);
  });

  it('uses price 0 when menu item price is null (size-variant item)', async () => {
    const { createPublicOrder } = await import('../../server/services/client-orders.js');
    const result = createPublicOrder(mockDb, {
      table_number: 1,
      session_id: 'abc-123',
      items: [{ menu_item_id: 'm3', quantity: 1 }],
    });

    expect(result.success).toBe(true);
    const order = mockDb._state.orders[0];
    expect(order.subtotal).toBe(0);
    expect(order.total).toBe(0);
  });

  it('rejects when table does not exist', async () => {
    const { createPublicOrder } = await import('../../server/services/client-orders.js');
    const result = createPublicOrder(mockDb, {
      table_number: 99,
      session_id: 'abc-123',
      items: [{ menu_item_id: 'm1', quantity: 1 }],
    });
    expect(result.success).toBe(false);
    expect(result.code).toBe('TABLE_NOT_FOUND');
  });

  it('rejects invalid items (no items or empty)', async () => {
    const { createPublicOrder } = await import('../../server/services/client-orders.js');
    const noItems = createPublicOrder(mockDb, { table_number: 1, session_id: 'abc', items: [] });
    expect(noItems.success).toBe(false);
    expect(noItems.code).toBe('ITEMS_REQUIRED');
  });

  it('marks the table as occupied after creating the order', async () => {
    const { createPublicOrder } = await import('../../server/services/client-orders.js');
    createPublicOrder(mockDb, {
      table_number: 2,
      session_id: 'abc-123',
      items: [{ menu_item_id: 'm1', quantity: 1 }],
    });
    const table = mockDb._state.tables.find(t => t.number === 2);
    expect(table.status).toBe('occupied');
  });
});

describe('getPublicOrderStatus service', () => {
  it('returns normalized status for a client-tracked order', async () => {
    const { createPublicOrder, getPublicOrderStatus } = await import('../../server/services/client-orders.js');
    createPublicOrder(mockDb, {
      table_number: 1,
      session_id: 'abc-123',
      items: [{ menu_item_id: 'm1', quantity: 1 }],
    });
    const orderId = mockDb._state.orders[0].id;

    const status = getPublicOrderStatus(mockDb, orderId);
    expect(status.success).toBe(true);
    expect(status.status).toBe('called');
    expect(status.total).toBe(22.6);
  });

  it('returns not-found for unknown order id', async () => {
    const { getPublicOrderStatus } = await import('../../server/services/client-orders.js');
    const status = getPublicOrderStatus(mockDb, 'nope');
    expect(status.success).toBe(false);
    expect(status.code).toBe('ORDER_NOT_FOUND');
  });
});
