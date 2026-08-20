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
    { id: 'm1', name: 'Chelada Clásica', price: 2000, area: 'bar', category_id: 'c1', is_active: 1 },
    { id: 'm2', name: 'Pique Macho', price: 8500, area: 'cocina', category_id: 'c2', is_active: 1 },
    { id: 'm3', name: 'Pizza La Rey', price: null, area: 'cocina', category_id: 'c3', is_active: 1 },
  ];
  const modifierOptions = [
    { id: 'o1', group_id: 'g1', name: 'Mediana', price_adjustment: 0, is_default: 1 },
    { id: 'o2', group_id: 'g1', name: 'Familiar', price_adjustment: 1500, is_default: 0 },
    { id: 'o3', group_id: 'g1', name: 'Familiar XL', price_adjustment: 3000, is_default: 0 },
  ];
  const modifierGroups = [{ id: 'g1', menu_item_id: 'm3' }];
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
        // La query de mesero por defecto lleva el rol como LITERAL en SQL
        // (role = 'mesero') — sin bind param. El rol puede venir también
        // como parámetro (otros callers).
        const roleMatch = sql.match(/role = '([^']+)'/);
        if (roleMatch) return staff.find(s => s.role === roleMatch[1]) || undefined;
        return staff.find(s => s.role === params[0]) || undefined;
      }
      if (sql.includes('FROM staff WHERE is_active')) {
        // Fallback a cualquier staff activo (fix FK 2026-08-13)
        return staff.find(s => s.is_active === 1) || undefined;
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
      if (sql.includes('FROM modifier_options WHERE id')) {
        return modifierOptions.find(o => o.id === params[0]) || undefined;
      }
      if (sql.includes('FROM orders WHERE id')) {
        return orders.find(o => o.id === params[0]) || undefined;
      }
      if (sql.includes('FROM orders WHERE table_id') && sql.includes('status')) {
        // P1-2: búsqueda de pedido activo por mesa
        return orders.find(o =>
          o.table_id === params[0] && !['paid', 'cancelled'].includes(o.status)
        ) || undefined;
      }
      if (sql.includes('SELECT id, status, table_number, total, updated_at')) {
        // P2-4: getPublicOrderStatus
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
    all: (...params) => {
      if (sql.includes('FROM order_items')) {
        return orderItems.filter(oi => oi.order_id === params[0]);
      }
      if (sql.includes('FROM modifier_groups')) {
        // resolveModifierAdjustment: grupos de un menu_item
        return modifierGroups.filter(g => g.menu_item_id === params[0]);
      }
      if (sql.includes('FROM modifier_options') && sql.includes('group_id IN')) {
        return modifierOptions.filter(o => params.includes(o.group_id));
      }
      if (sql.includes('FROM modifier_options') && sql.includes('id IN')) {
        return modifierOptions.filter(o => params.includes(o.id));
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
          total: params[7], notes: params[8], guest_count: params[9], local_id: params[10], created_at: now(),
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
        calls.push({
          id: params[0], table_id: params[1], table_number: params[2],
          session_id: params[3], call_type: params[4] || 'call_waiter', status: 'pending', created_at: now(),
        });
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
    _state: { tables, menuItems, modifierOptions, orders, orderItems, calls, staff },
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
    // Modelo SSOT EXTRACTIVO (precio INCLUYE IVA, centavos): total = 4000 + 8500 = 12500
    // (lo que paga el cliente), subtotal = 12500/1.13 = 11062, iva = 1438.
    expect(order.subtotal).toBe(11062);
    expect(order.iva_amount).toBe(1438);
    expect(order.total).toBe(12500);
    expect(mockDb._state.orderItems).toHaveLength(2);
  });

  it('rejects size-variant item WITHOUT size (price null, no manual) → PRICE_REQUIRED_MANUAL', async () => {
    // Sprint 1 (B): el server NUNCA factura 0. Un item de precio null sin
    // manual_price (clientes no lo mandan) ni tamaño es rechazado.
    const { createPublicOrder } = await import('../../server/services/client-orders.js');
    const result = createPublicOrder(mockDb, {
      table_number: 1,
      session_id: 'abc-123',
      items: [{ menu_item_id: 'm3', quantity: 1 }],
    });

    expect(result.success).toBe(false);
    expect(result.code).toBe('PRICE_REQUIRED_MANUAL');
    expect(mockDb._state.orders).toHaveLength(0);
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

  it('creates a pending call_waiter call so the mesero is notified', async () => {
    const { createPublicOrder } = await import('../../server/services/client-orders.js');
    createPublicOrder(mockDb, {
      table_number: 1,
      session_id: 'abc-123',
      items: [{ menu_item_id: 'm1', quantity: 1 }],
    });
    const call = mockDb._state.calls[0];
    expect(call).toBeDefined();
    expect(call.call_type).toBe('call_waiter');
    expect(call.status).toBe('pending');
    expect(call.table_id).toBe('t1');
    expect(call.session_id).toBe('abc-123');
  });

  it('applies modifier price adjustments to size-variant items', async () => {
    const { createPublicOrder } = await import('../../server/services/client-orders.js');
    const result = createPublicOrder(mockDb, {
      table_number: 1,
      session_id: 'abc-123',
      items: [{
        menu_item_id: 'm3', // pizza, price null
        quantity: 1,
        modifiers: [{ option_id: 'o2' }], // Familiar +1500
      }],
    });
    expect(result.success).toBe(true);
    const order = mockDb._state.orders[0];
    // subtotal (base) 1500 / 1.13 = 1327, iva 173, total 1500
    expect(order.subtotal).toBe(1327);
    expect(order.total).toBe(1500);
  });

  it('sums multiple modifier adjustments and multiplies by quantity', async () => {
    const { createPublicOrder } = await import('../../server/services/client-orders.js');
    createPublicOrder(mockDb, {
      table_number: 1,
      session_id: 'abc-123',
      items: [{
        menu_item_id: 'm3',
        quantity: 2,
        modifiers: [{ option_id: 'o2' }, { option_id: 'o3' }], // +1500 +3000 = +4500
      }],
    });
    const order = mockDb._state.orders[0];
    // unit 4500 * 2 = 9000 (gross, incluye IVA) → total 9000, subtotal 7965, iva 1035
    expect(order.subtotal).toBe(7965);
    expect(order.total).toBe(9000);
  });

  it('rejects invalid modifier options with a clear code', async () => {
    const { createPublicOrder } = await import('../../server/services/client-orders.js');
    const result = createPublicOrder(mockDb, {
      table_number: 1,
      session_id: 'abc-123',
      items: [{
        menu_item_id: 'm3',
        quantity: 1,
        modifiers: [{ option_id: 'o99' }], // does not exist
      }],
    });
    expect(result.success).toBe(false);
    expect(result.code).toBe('INVALID_MODIFIER_OPTION');
  });

  it('NO tolera el doble-nombre modifier_option_id (contrato SSOT: option_id único)', async () => {
    // FASE 5: se eliminó la tolerancia frágil de doble-nombre en cliente.
    const { createPublicOrder } = await import('../../server/services/client-orders.js');
    const result = createPublicOrder(mockDb, {
      table_number: 1,
      session_id: 'abc-123',
      items: [{
        menu_item_id: 'm3',
        quantity: 1,
        modifiers: [{ modifier_option_id: 'o2' }], // nombre NO autorizado
      }],
    });
    // El option_id no es válido (undefined) → debe rechazar con código claro.
    expect(result.success).toBe(false);
    expect(result.code).toBe('INVALID_MODIFIER_OPTION');
  });

  // ═══ P1-2 (2026-08-11): retry idempotente por session_id/local_id ═══

  it('P1-2: mismo session_id + pedido activo → devuelve el existente (no duplica)', async () => {
    const { createPublicOrder } = await import('../../server/services/client-orders.js');

    const first = createPublicOrder(mockDb, {
      table_number: 1,
      session_id: 'session-x',
      items: [{ menu_item_id: 'm1', quantity: 2 }],
    });
    expect(first.success).toBe(true);
    expect(first.duplicate).toBeUndefined();
    const firstOrderId = first.order.id;
    expect(mockDb._state.orders).toHaveLength(1);

    // Doble-tap: mismo teléfono reenvía el mismo pedido
    const second = createPublicOrder(mockDb, {
      table_number: 1,
      session_id: 'session-x',
      items: [{ menu_item_id: 'm1', quantity: 2 }],
    });

    expect(second.success).toBe(true);
    expect(second.duplicate).toBe(true);
    expect(second.order.id).toBe(firstOrderId); // el MISMO pedido
    expect(mockDb._state.orders).toHaveLength(1); // NO se creó otro
    expect(mockDb._state.orderItems).toHaveLength(1); // sin items duplicados
  });

  it('P1-2: mismo session_id PERO pedido ya pagado → puede crear uno nuevo', async () => {
    const { createPublicOrder } = await import('../../server/services/client-orders.js');

    const first = createPublicOrder(mockDb, {
      table_number: 1,
      session_id: 'session-y',
      items: [{ menu_item_id: 'm1', quantity: 1 }],
    });
    // Cerrar el pedido (pagado)
    const order = mockDb._state.orders.find(o => o.id === first.order.id);
    order.status = 'paid';

    const second = createPublicOrder(mockDb, {
      table_number: 1,
      session_id: 'session-y',
      items: [{ menu_item_id: 'm1', quantity: 1 }],
    });
    expect(second.success).toBe(true);
    expect(second.duplicate).toBeUndefined(); // nuevo pedido real
    expect(mockDb._state.orders).toHaveLength(2);
  });

  it('P1-2: OTRO session_id con pedido activo → 409 TABLE_HAS_ACTIVE_ORDER', async () => {
    const { createPublicOrder } = await import('../../server/services/client-orders.js');

    createPublicOrder(mockDb, {
      table_number: 1,
      session_id: 'session-a',
      items: [{ menu_item_id: 'm1', quantity: 1 }],
    });

    const other = createPublicOrder(mockDb, {
      table_number: 1,
      session_id: 'session-b', // otro teléfono
      items: [{ menu_item_id: 'm1', quantity: 1 }],
    });
    expect(other.success).toBe(false);
    expect(other.code).toBe('TABLE_HAS_ACTIVE_ORDER');
    expect(mockDb._state.orders).toHaveLength(1);
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
    // total incluye IVA = 2000 (precio del item, ya incluye IVA, centavos)
    expect(status.total).toBe(2000);
  });

  it('returns not-found for unknown order id', async () => {
    const { getPublicOrderStatus } = await import('../../server/services/client-orders.js');
    const status = getPublicOrderStatus(mockDb, 'nope');
    expect(status.success).toBe(false);
    expect(status.code).toBe('ORDER_NOT_FOUND');
  });

  // ═══ P2-4 (2026-08-11): updatedAt en hora local La Paz (no UTC) ═══

  it('P2-4: updatedAt se devuelve en hora local America/La_Paz (UTC-4)', async () => {
    const { getPublicOrderStatus } = await import('../../server/services/client-orders.js');
    // DB guarda UTC: '2026-08-11 20:54:32' → local La Paz = 16:54:32 (UTC-4)
    const order = {
      id: 'ord-local', status: 'confirmed', table_number: 1, total: 2000,
      updated_at: '2026-08-11 20:54:32', created_at: '2026-08-11 20:54:32',
    };
    mockDb._state.orders.push(order);

    const status = getPublicOrderStatus(mockDb, 'ord-local');
    expect(status.success).toBe(true);
    expect(status.updatedAt).toBe('2026-08-11 16:54:32');
  });

  it('P2-4: updatedAt null → no rompe (null seguro)', async () => {
    const { getPublicOrderStatus } = await import('../../server/services/client-orders.js');
    const order = {
      id: 'ord-null', status: 'draft', table_number: 2, total: 1000,
      updated_at: null, created_at: '2026-08-11 20:54:32',
    };
    mockDb._state.orders.push(order);

    const status = getPublicOrderStatus(mockDb, 'ord-null');
    expect(status.success).toBe(true);
    expect(status.updatedAt).toBeNull();
  });
});
