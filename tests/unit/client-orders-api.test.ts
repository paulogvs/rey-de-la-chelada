/**
 * Client Orders API — public endpoints used by the clientes PWA.
 *
 * TDD: tests written before implementation. No auth → the API layer must
 * simply forward to /api/client-orders with the right method/body.
 */

import { describe, it, expect } from 'vitest';
import {
  createClientOrder,
  getClientOrderStatus,
} from '../../src/pwa/_shared/api/clientOrdersApi';

function jsonFetch(responseBody: unknown, status = 200): typeof fetch {
  return (async () =>
    new Response(JSON.stringify(responseBody), {
      status,
      headers: { 'Content-Type': 'application/json' },
    })) as typeof fetch;
}

describe('createClientOrder', () => {
  it('POSTs the order payload to /api/client-orders', async () => {
    let calledUrl = '';
    let calledMethod = '';
    let calledBody: unknown = null;
    const fetchImpl = (async (url: unknown, init: unknown) => {
      calledUrl = String(url);
      calledMethod = (init as RequestInit)?.method ?? 'GET';
      calledBody = JSON.parse(((init as RequestInit)?.body as string) ?? '{}');
      return new Response(
        JSON.stringify({ success: true, orderId: 'o1', status: 'called', total: 45 }),
        { status: 201, headers: { 'Content-Type': 'application/json' } }
      );
    }) as typeof fetch;

    const result = await createClientOrder(
      {
        table_number: 4,
        session_id: 'sess-1',
        items: [{ menu_item_id: 'm1', quantity: 2, modifiers: [{ option_id: 'o2' }] }],
        guest_count: 2,
      },
      fetchImpl
    );

    expect(calledUrl).toBe('/api/client-orders');
    expect(calledMethod).toBe('POST');
    expect(calledBody).toEqual({
      table_number: 4,
      session_id: 'sess-1',
      items: [{ menu_item_id: 'm1', quantity: 2, modifiers: [{ option_id: 'o2' }] }],
      guest_count: 2,
    });
    expect(result.ok).toBe(true);
    expect(result.data?.orderId).toBe('o1');
  });

  it('normalizes server errors into ApiResult', async () => {
    const result = await createClientOrder(
      { table_number: 99, session_id: 's', items: [] },
      jsonFetch({ success: false, code: 'TABLE_NOT_FOUND', error: 'Mesa no encontrada' }, 400)
    );
    expect(result.ok).toBe(false);
    expect(result.code).toBe('TABLE_NOT_FOUND');
    expect(result.data).toBeNull();
  });
});

describe('getClientOrderStatus', () => {
  it('GETs the order status from /api/client-orders/:id', async () => {
    let calledUrl = '';
    const fetchImpl = (async (url: unknown) => {
      calledUrl = String(url);
      return new Response(
        JSON.stringify({
          success: true,
          order: {
            success: true,
            status: 'preparing',
            tableNumber: 4,
            total: 45,
            items: [{ name: 'Pizza', quantity: 1, subtotal: 30 }],
            updatedAt: '2026-08-02T12:00:00Z',
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }) as typeof fetch;

    const result = await getClientOrderStatus('order-123', fetchImpl);
    expect(calledUrl).toBe('/api/client-orders/order-123');
    expect(result.ok).toBe(true);
    expect(result.data?.status).toBe('preparing');
  });

  it('returns not-found as ApiResult error', async () => {
    const result = await getClientOrderStatus(
      'nope',
      jsonFetch({ success: false, code: 'ORDER_NOT_FOUND', error: 'Pedido no encontrado' }, 404)
    );
    expect(result.ok).toBe(false);
    expect(result.code).toBe('ORDER_NOT_FOUND');
  });
});
