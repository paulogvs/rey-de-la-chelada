/**
 * KDSBoard filter tests — pedidos mixtos se reparten por área.
 *
 * FASE 1 (KDS separado): un pedido con items de bar + cocina debe
 * mostrarse en cada pantalla KDS con SOLO sus items (SSOT defensivo:
 * el servidor ya filtra por mi.area, pero el cliente re-filtra por
 * kds_module porque el WebSocket entrega pedidos completos).
 */

import { describe, it, expect } from 'vitest';
import { filterItemsByModule } from '../../src/ui/components/KDSBoard/filter';
import type { Order } from '../../src/core/types';

function makeItem(id: string, kdsModule: 'cocina' | 'bar') {
  return {
    id,
    menuItemId: `menu-${id}`,
    menuItemName: `Item ${id}`,
    quantity: 1,
    unitPrice: 20,
    modifiers: [],
    subtotal: 20,
    status: 'pending',
    preparationNotes: '',
    createdAt: '2026-08-01T10:00:00.000Z',
    kds_module: kdsModule,
  } as never;
}

function makeOrder(id: string, items: ReturnType<typeof makeItem>[]): Order {
  return {
    id,
    tableId: `table-${id}`,
    tableNumber: 7,
    waiterId: 'w1',
    waiterName: 'Test',
    items,
    status: 'confirmed',
    subtotal: 0,
    ivaAmount: 0,
    discount: 0,
    discountReason: '',
    total: 0,
    paymentMethod: null,
    paymentReference: null,
    isPaid: false,
    paidAt: null,
    notes: '',
    guestCount: 1,
    createdAt: '2026-08-01T10:00:00.000Z',
    updatedAt: '2026-08-01T10:00:00.000Z',
    syncedAt: null,
    localId: id,
  };
}

describe('filterItemsByModule', () => {
  it('bar ve solo items de area bar en un pedido mixto', () => {
    const order = makeOrder('o-mix', [
      makeItem('michelada-1', 'bar'),
      makeItem('michelada-2', 'bar'),
      makeItem('pizza-1', 'cocina'),
    ]);

    const barOrders = filterItemsByModule([order], 'bar');
    expect(barOrders).toHaveLength(1);
    expect(barOrders[0].items.map(i => i.id)).toEqual(['michelada-1', 'michelada-2']);
  });

  it('cocina ve solo items de area cocina en el mismo pedido mixto', () => {
    const order = makeOrder('o-mix', [
      makeItem('michelada-1', 'bar'),
      makeItem('michelada-2', 'bar'),
      makeItem('pizza-1', 'cocina'),
    ]);

    const cocinaOrders = filterItemsByModule([order], 'cocina');
    expect(cocinaOrders).toHaveLength(1);
    expect(cocinaOrders[0].items.map(i => i.id)).toEqual(['pizza-1']);
  });

  it('omite pedidos sin items del modulo (bar no ve pedido solo-comida)', () => {
    const order = makeOrder('o-food-only', [
      makeItem('pizza-1', 'cocina'),
      makeItem('fideos-1', 'cocina'),
    ]);

    const barOrders = filterItemsByModule([order], 'bar');
    expect(barOrders).toHaveLength(0);
  });

  it('mantiene items sin kds_module como cocina (backward-compat)', () => {
    const legacy = makeItem('tradicional', 'cocina') as Record<string, unknown>;
    delete legacy.kds_module;
    const order = makeOrder('o-legacy', [legacy as never]);

    const cocinaOrders = filterItemsByModule([order], 'cocina');
    expect(cocinaOrders).toHaveLength(1);
    expect(filterItemsByModule([order], 'bar')).toHaveLength(0);
  });

  it('no muta los pedidos originales (inmutabilidad)', () => {
    const order = makeOrder('o-mix', [
      makeItem('michelada-1', 'bar'),
      makeItem('pizza-1', 'cocina'),
    ]);
    const before = order.items.length;

    filterItemsByModule([order], 'bar');

    expect(order.items.length).toBe(before);
  });
});
