/**
 * Staff API — tables module (pure, injectable fetch)
 *
 * TDD: tests written before implementation.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  fetchTables,
  fetchTableById,
  updateTableStatus,
  type ServerTable,
} from '../../src/pwa/_shared/api/tablesApi';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('fetchTables', () => {
  it('maps snake_case server tables to camelCase Table[]', async () => {
    const serverTable: ServerTable = {
      id: 't1',
      number: 3,
      capacity: 4,
      status: 'free',
      current_order_id: null,
      assigned_waiter_id: null,
      section: 'interior',
      position: 0,
      notes: '',
    };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ success: true, tables: [serverTable] }));

    const result = await fetchTables('tok-1', fetchMock as unknown as typeof fetch);

    expect(result.ok).toBe(true);
    expect(result.tables).toHaveLength(1);
    expect(result.tables![0]).toMatchObject({
      id: 't1',
      number: 3,
      capacity: 4,
      status: 'free',
      currentOrderId: null,
      assignedWaiterId: null,
      section: 'interior',
    });
    expect(fetchMock).toHaveBeenCalledWith('/api/tables', expect.objectContaining({
      headers: expect.objectContaining({ Authorization: 'Bearer tok-1' }),
    }));
  });

  it('returns empty list + error on failure', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ success: false, error: 'Error', code: 'TABLES_LIST_ERROR' }, 500)
    );
    const result = await fetchTables('tok-1', fetchMock as unknown as typeof fetch);
    expect(result.ok).toBe(false);
    expect(result.tables).toEqual([]);
  });
});

describe('updateTableStatus', () => {
  it('PATCHes the table status and returns the updated table', async () => {
    const serverTable: ServerTable = {
      id: 't1', number: 3, capacity: 4, status: 'occupied',
      current_order_id: 'o1', assigned_waiter_id: 'w1',
      section: 'interior', position: 0, notes: '',
    };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ success: true, table: serverTable }));

    const result = await updateTableStatus('tok-1', 't1', 'occupied', fetchMock as unknown as typeof fetch);

    expect(result.ok).toBe(true);
    expect(result.table?.status).toBe('occupied');
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body as string)).toEqual({ status: 'occupied' });
  });
});

describe('fetchTableById', () => {
  it('returns a single normalized table', async () => {
    const serverTable: ServerTable = {
      id: 't2', number: 7, capacity: 6, status: 'free',
      current_order_id: null, assigned_waiter_id: null,
      section: 'terraza', position: 1, notes: '',
    };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ success: true, table: serverTable }));
    const result = await fetchTableById('tok-1', 't2', fetchMock as unknown as typeof fetch);
    expect(result.ok).toBe(true);
    expect(result.table?.number).toBe(7);
    expect(result.table?.section).toBe('terraza');
  });
});
