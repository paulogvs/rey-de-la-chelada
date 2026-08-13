/**
 * S2-C — fetchPendingOrders (ordersApi) + paymentMethods helpers
 *
 * TDD: tests written before implementation (contrato S2-C de la caja:
 * GET /api/orders?pending=1 devuelve pedidos activos con paid_amount).
 */

import { describe, it, expect, vi } from 'vitest';
import {
  fetchPendingOrders,
  type ServerOrder,
  type ServerOrderItem,
} from '../../src/pwa/_shared/api/ordersApi';
import {
  METHOD_LABELS,
  METHOD_ICONS,
  PAYMENT_METHODS,
  methodLabel,
  methodIcon,
} from '../../src/pwa/_shared/utils/paymentMethods';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const serverItem: ServerOrderItem = {
  id: 'oi1',
  order_id: 'o1',
  menu_item_id: 'm1',
  menu_item_name: 'Chelada Clásica',
  quantity: 2,
  unit_price: 20,
  modifiers_json: null,
  subtotal: 40,
  status: 'served',
  preparation_notes: '',
  created_at: '2026-08-08T10:00:00.000Z',
  item_name: 'Chelada Clásica',
  kds_module: 'bar',
};

const pendingOrder: ServerOrder = {
  id: 'o1',
  table_id: 't3',
  table_number: 3,
  waiter_id: 'w1',
  waiter_name: 'Mesero',
  status: 'served',
  subtotal: 40,
  iva_amount: 5.2,
  discount: 0,
  discount_reason: '',
  total: 45.2,
  payment_method: null,
  payment_reference: null,
  is_paid: 0,
  paid_at: null,
  notes: '',
  guest_count: 2,
  created_at: '2026-08-08T10:00:00.000Z',
  updated_at: '2026-08-08T10:05:00.000Z',
  local_id: null,
  paid_amount: 10,
  items: [serverItem],
};

describe('fetchPendingOrders (S2-C)', () => {
  it('GETs /api/orders?pending=1 y normaliza paid_amount (SSOT server)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ success: true, orders: [pendingOrder], count: 1 })
    );
    const result = await fetchPendingOrders('tok-caja', fetchMock as unknown as typeof fetch);

    expect(result.ok).toBe(true);
    expect(result.orders).toHaveLength(1);
    const order = result.orders[0];
    expect(order.id).toBe('o1');
    expect(order.tableNumber).toBe(3);
    expect(order.status).toBe('served');
    // S2-C: el abono previo se lee del server (paid_amount), NO se calcula en cliente
    expect(order.paidAmount).toBe(10);
    expect(order.items).toHaveLength(1);

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/api/orders');
    expect(url).toContain('pending=1');
  });

  it('paid_amount ausente → 0 (compatibilidad con pedidos sin pagos)', async () => {
    const { paid_amount: _paid, ...withoutPaid } = pendingOrder;
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ success: true, orders: [{ ...withoutPaid }], count: 1 })
    );
    const result = await fetchPendingOrders('tok-caja', fetchMock as unknown as typeof fetch);
    expect(result.ok).toBe(true);
    expect(result.orders[0].paidAmount).toBe(0);
  });

  it('respuesta sin orders → array vacío sin excepción', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ success: true, orders: [], count: 0 })
    );
    const result = await fetchPendingOrders('tok-caja', fetchMock as unknown as typeof fetch);
    expect(result.ok).toBe(true);
    expect(result.orders).toEqual([]);
  });
});

describe('paymentMethods helpers', () => {
  it('tiene SOLO los 2 métodos del SSOT server (cash, qr)', () => {
    expect(PAYMENT_METHODS).toEqual(['cash', 'qr']);
  });

  it('methodLabel devuelve label en español o el código crudo', () => {
    expect(methodLabel('cash')).toBe('Efectivo');
    expect(methodLabel('qr')).toBe('QR');
    expect(methodLabel('desconocido')).toBe('desconocido');
  });

  it('methodIcon devuelve nombre de icono (AppIconName) o fallback', () => {
    expect(methodIcon('qr')).toBe('smartphone');
    expect(methodIcon('cash')).toBe('banknote');
    expect(methodIcon('nope')).toBe('wallet');
  });

  it('tablas de label/icon cubren todos los PAYMENT_METHODS', () => {
    for (const m of PAYMENT_METHODS) {
      expect(METHOD_LABELS[m]).toBeTruthy();
      expect(METHOD_ICONS[m]).toBeTruthy();
    }
  });
});
