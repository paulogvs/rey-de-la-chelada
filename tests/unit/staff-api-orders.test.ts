/**
 * Staff API — orders module (pure, injectable fetch)
 *
 * TDD: tests written before implementation.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  createOrder,
  confirmOrder,
  updateOrderStatus,
  submitOrder,
  fetchOrdersByStatus,
  fetchOrderById,
  type OrderPayload,
  type ServerOrder,
  type ServerOrderItem,
} from '../../src/pwa/_shared/api/ordersApi';

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
  status: 'pending',
  preparation_notes: '',
  created_at: '2026-08-01T10:00:00.000Z',
  item_name: 'Chelada Clásica',
  kds_module: 'bar',
};

const serverOrder: ServerOrder = {
  id: 'o1',
  table_id: 't1',
  table_number: 3,
  waiter_id: 'w1',
  waiter_name: 'Mesero',
  status: 'draft',
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
  created_at: '2026-08-01T10:00:00.000Z',
  updated_at: '2026-08-01T10:00:00.000Z',
  local_id: 'o1',
  items: [serverItem],
};

describe('createOrder', () => {
  it('POSTs payload and returns normalized order', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ success: true, order: serverOrder }, 201));
    const payload: OrderPayload = {
      table_id: 't1',
      items: [{ menu_item_id: 'm1', quantity: 2 }],
      guest_count: 2,
    };

    const result = await createOrder('tok-1', payload, fetchMock as unknown as typeof fetch);

    expect(result.ok).toBe(true);
    expect(result.order).toMatchObject({
      id: 'o1',
      tableNumber: 3,
      status: 'draft',
      total: 45.2,
      isPaid: false,
    });
    expect(result.order!.items).toHaveLength(1);
    expect(result.order!.items![0]).toMatchObject({
      menuItemId: 'm1',
      menuItemName: 'Chelada Clásica',
      quantity: 2,
      unitPrice: 20,
    });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual(payload);
  });

  it('returns error result when table is invalid', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ success: false, error: 'Mesa no encontrada', code: 'TABLE_NOT_FOUND' }, 404)
    );
    const result = await createOrder('tok-1', { table_id: 'nope', items: [{ menu_item_id: 'm1', quantity: 1 }] }, fetchMock as unknown as typeof fetch);
    expect(result.ok).toBe(false);
    expect(result.code).toBe('TABLE_NOT_FOUND');
    expect(result.order).toBeNull();
  });
});

describe('confirmOrder', () => {
  it('PATCHes confirm and returns confirmed status', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ success: true, status: 'confirmed', message: 'Pedido confirmado' })
    );
    const result = await confirmOrder('tok-1', 'o1', fetchMock as unknown as typeof fetch);
    expect(result.ok).toBe(true);
    expect(result.data?.status).toBe('confirmed');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe('PATCH');
    expect(url).toContain('/confirm');
    // No body for confirm
    expect(init.body).toBeUndefined();
  });
});

describe('submitOrder', () => {
  it('PATCHes submit (draft → called)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ success: true, status: 'called', message: 'Pedido enviado al mesero' })
    );
    const result = await submitOrder('tok-1', 'o1', fetchMock as unknown as typeof fetch);
    expect(result.ok).toBe(true);
    expect(result.data?.status).toBe('called');
  });
});

describe('updateOrderStatus', () => {
  it('PATCHes status with body', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ success: true, status: 'preparing' })
    );
    const result = await updateOrderStatus('tok-1', 'o1', 'preparing', fetchMock as unknown as typeof fetch);
    expect(result.ok).toBe(true);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ status: 'preparing' });
  });
});

describe('fetchOrdersByStatus', () => {
  it('GETs orders filtered by status and normalizes them', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ success: true, orders: [serverOrder], count: 1 })
    );
    const result = await fetchOrdersByStatus('tok-1', 'called', fetchMock as unknown as typeof fetch);
    expect(result.ok).toBe(true);
    expect(result.orders).toHaveLength(1);
    expect(result.orders![0].status).toBe('draft');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/api/orders');
    expect(url).toContain('status=called');
  });
});

describe('fetchOrderById — FIRMA (regresión 2026-08-27)', () => {
  // FIX 2026-08-27: PaymentPanel llamaba fetchOrderById(orderId, token) pero
  // la firma es (token, orderId) → el JWT iba como orderId en la URL y el
  // UUID como Bearer → 401 INVALID_TOKEN en cada cobro. Este test fija el
  // contrato: token en el header Authorization, orderId en la URL.
  it('usa el TOKEN en el header y el ORDER_ID en la URL (NUNCA invertidos)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ success: true, order: serverOrder })
    );
    const token = 'JWT-de-sesion-abc123';
    const orderId = 'uuid-del-pedido-987';
    const result = await fetchOrderById(token, orderId, fetchMock as unknown as typeof fetch);

    expect(result.ok).toBe(true);
    expect(result.order?.id).toBe('o1');

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    // La URL debe contener el ORDER_ID (no el token)
    expect(url).toContain(`/api/orders/${orderId}`);
    expect(url).not.toContain(token);
    // El header Authorization debe llevar el TOKEN (no el orderId)
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${token}`);
    expect(headers.Authorization).not.toContain(orderId);
  });

  it('devuelve order null si el server no responde con order (404/401)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ success: false, code: 'ORDER_NOT_FOUND', error: 'no' }, 404)
    );
    const result = await fetchOrderById('tok', 'o1', fetchMock as unknown as typeof fetch);
    expect(result.ok).toBe(false);
    expect(result.order).toBeNull();
  });
});
