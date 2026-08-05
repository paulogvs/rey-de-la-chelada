/**
 * Staff API — waiter-calls module (pure, injectable fetch)
 *
 * TDD: tests written before implementation.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  fetchWaiterCalls,
  acceptCall,
  completeCall,
  cancelCall,
  createClientCall,
  type WaiterCall,
} from '../../src/pwa/_shared/api/waiterCallsApi';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const serverCall = {
  id: 'wc1',
  table_id: 't1',
  table_number: 3,
  session_id: 's1',
  call_type: 'call_waiter',
  status: 'pending',
  accepted_by: null,
  accepted_at: null,
  created_at: '2026-08-01T10:00:00.000Z',
};

describe('fetchWaiterCalls', () => {
  it('GETs calls and normalizes them', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ success: true, calls: [serverCall] }));
    const result = await fetchWaiterCalls('tok-1', fetchMock as unknown as typeof fetch);

    expect(result.ok).toBe(true);
    expect(result.calls).toHaveLength(1);
    const call: WaiterCall = result.calls![0];
    expect(call).toMatchObject({
      id: 'wc1',
      tableId: 't1',
      tableNumber: 3,
      callType: 'call_waiter',
      status: 'pending',
      acceptedBy: null,
      acceptedAt: null,
    });
    expect(fetchMock).toHaveBeenCalledWith('/api/waiter-calls', expect.objectContaining({
      headers: expect.objectContaining({ Authorization: 'Bearer tok-1' }),
    }));
  });

  it('returns empty list on failure', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ success: false, error: 'Error', code: 'WAITER_CALLS_LIST_ERROR' }, 500)
    );
    const result = await fetchWaiterCalls('tok-1', fetchMock as unknown as typeof fetch);
    expect(result.ok).toBe(false);
    expect(result.calls).toEqual([]);
  });
});

describe('acceptCall / completeCall / cancelCall', () => {
  it('accepts a call via PATCH', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ success: true, call: { ...serverCall, status: 'accepted' } })
    );
    const result = await acceptCall('tok-1', 'wc1', fetchMock as unknown as typeof fetch);
    expect(result.ok).toBe(true);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe('PATCH');
    expect(url).toContain('/accept');
  });

  it('completes a call via PATCH /done', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ success: true, call: { ...serverCall, status: 'done' } })
    );
    const result = await completeCall('tok-1', 'wc1', fetchMock as unknown as typeof fetch);
    expect(result.ok).toBe(true);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe('PATCH');
    expect(url).toContain('/done');
  });

  it('cancels a call via DELETE', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ success: true }));
    const result = await cancelCall('wc1', fetchMock as unknown as typeof fetch);
    expect(result.ok).toBe(true);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe('DELETE');
  });
});

describe('createClientCall', () => {
  it('POSTs a client call without auth', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ success: true, call: serverCall }, 201));
    const result = await createClientCall(
      { table_id: 't1', table_number: 3, session_id: 's1', call_type: 'request_bill' },
      fetchMock as unknown as typeof fetch
    );
    expect(result.ok).toBe(true);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({ call_type: 'request_bill', table_number: 3 });
  });

  it('supports the PWA flow: only table_number + session_id (no table_id)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ success: true, call: serverCall }, 201));
    const result = await createClientCall(
      { table_number: 3, session_id: 's1', call_type: 'call_waiter' },
      fetchMock as unknown as typeof fetch
    );
    expect(result.ok).toBe(true);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({ table_number: 3, session_id: 's1', call_type: 'call_waiter' });
    expect(body.table_id).toBeUndefined();
  });
});
