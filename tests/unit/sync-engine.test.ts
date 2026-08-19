/**
 * SyncEngine Tests — offline sync orchestrator
 *
 * Pull en startup + flush al reconectar + lastSync en storage.
 */

import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SyncEngine, LAST_SYNC_STORAGE_KEY } from '../../src/core/engine/SyncEngine';
import { SyncQueue } from '../../src/core/engine/SyncQueue';

const TEST_DB = 'rdlc-sync-engine-test';

/** Storage en memoria (reemplaza localStorage) */
function createMemoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => { map.set(k, v); },
  };
}

/** Monitor de red manual (inyectable) */
function createManualNetwork(initial = true) {
  let online = initial;
  const listeners = new Set<(o: boolean) => void>();
  return {
    isOnline: () => online,
    onChange: (cb: (o: boolean) => void) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    set: (o: boolean) => {
      online = o;
      for (const cb of [...listeners]) cb(o);
    },
  };
}

/** Mock fetch que devuelve una respuesta JSON */
function jsonResponse(body: unknown, ok = true, status = ok ? 200 : 500) {
  return { ok, status, json: async () => body } as Response;
}

describe('SyncEngine', () => {
  let storage: ReturnType<typeof createMemoryStorage>;
  let network: ReturnType<typeof createManualNetwork>;
  let fetchMock: ReturnType<typeof vi.fn>;

  function createEngine() {
    return new SyncEngine({
      storage: storage as Storage,
      network,
      fetchImpl: fetchMock as typeof fetch,
      tokenProvider: () => 'test-token',
      dbName: TEST_DB,
    });
  }

  beforeEach(async () => {
    storage = createMemoryStorage();
    network = createManualNetwork(true);
    fetchMock = vi.fn();
    // fake-indexeddb persiste entre tests — limpiar la cola
    await new SyncQueue(TEST_DB).clear();
  });

  describe('pull', () => {
    it('should POST last_sync and store the server timestamp', async () => {
      fetchMock.mockResolvedValue(jsonResponse({
        success: true,
        timestamp: '2026-07-30T12:00:00.000Z',
        data: { tables: [] },
      }));
      const engine = createEngine();

      await engine.pull();

      expect(fetchMock).toHaveBeenCalledWith('/api/sync/pull', expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ last_sync: null }),
      }));
      expect(engine.getLastSync()).toBe('2026-07-30T12:00:00.000Z');
      expect(storage.getItem(LAST_SYNC_STORAGE_KEY)).toBe('2026-07-30T12:00:00.000Z');
    });

    it('should send the previous lastSync timestamp on the next pull', async () => {
      storage.setItem(LAST_SYNC_STORAGE_KEY, '2026-07-29T10:00:00.000Z');
      fetchMock.mockResolvedValue(jsonResponse({ success: true, timestamp: '2026-07-30T12:00:00.000Z' }));
      const engine = createEngine();

      await engine.pull();

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('/api/sync/pull');
      expect(JSON.parse((init as RequestInit).body as string)).toEqual({
        last_sync: '2026-07-29T10:00:00.000Z',
      });
    });

    it('should emit "pulled" with the new timestamp', async () => {
      fetchMock.mockResolvedValue(jsonResponse({ success: true, timestamp: '2026-07-30T12:00:00.000Z' }));
      const engine = createEngine();
      const spy = vi.fn();
      engine.subscribe(spy);

      await engine.pull();

      expect(spy).toHaveBeenCalledWith(expect.objectContaining({ type: 'pulled', timestamp: '2026-07-30T12:00:00.000Z' }));
    });

    it('should emit "pull-failed" and keep lastSync on HTTP error', async () => {
      storage.setItem(LAST_SYNC_STORAGE_KEY, '2026-07-29T10:00:00.000Z');
      fetchMock.mockResolvedValue(jsonResponse({ success: false }, false, 500));
      const engine = createEngine();
      const spy = vi.fn();
      engine.subscribe(spy);

      await expect(engine.pull()).rejects.toThrow();

      expect(spy).toHaveBeenCalledWith(expect.objectContaining({ type: 'pull-failed' }));
      expect(engine.getLastSync()).toBe('2026-07-29T10:00:00.000Z');
    });
  });

  describe('flush (push)', () => {
    it('should push queued items with auth header and remove them on success', async () => {
      fetchMock.mockResolvedValue(jsonResponse({ success: true }));
      const engine = createEngine();
      await engine.enqueue('create_order', { table_id: 1, total: 30 });

      const result = await engine.flush();

      expect(result.processed).toBe(1);
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('/api/sync/push');
      expect((init as RequestInit).headers).toEqual(expect.objectContaining({
        Authorization: 'Bearer test-token',
      }));
      const body = JSON.parse((init as RequestInit).body as string);
      expect(body.orders).toEqual([{ action: 'create_order', table_id: 1, total: 30 }]);
      expect(await engine.getPending()).toEqual([]);
    });

    it('should keep the item and emit "failed" when the server rejects', async () => {
      fetchMock.mockResolvedValue(jsonResponse({ success: false, error: 'Invalid order' }, false, 400));
      const engine = createEngine();
      const spy = vi.fn();
      engine.subscribe(spy);
      await engine.enqueue('update_status', { id: 7, status: 'listo' });

      const result = await engine.flush();

      expect(result.failed).toBe(1);
      const pending = await engine.getPending();
      expect(pending).toHaveLength(1);
      expect(pending[0].attempts).toBe(1);
      expect(pending[0].lastError).toContain('Invalid order');
      expect(spy).toHaveBeenCalledWith(expect.objectContaining({ type: 'failed' }));
    });
  });

  describe('start', () => {
    it('should pull + flush when starting online', async () => {
      fetchMock
        .mockResolvedValueOnce(jsonResponse({ success: true, timestamp: '2026-07-30T12:00:00.000Z' }))
        .mockResolvedValueOnce(jsonResponse({ success: true }));
      const engine = createEngine();
      await engine.enqueue('create_payment', { id: 1 });
      fetchMock.mockClear();

      await engine.start();

      const urls = fetchMock.mock.calls.map(c => c[0]);
      expect(urls[0]).toBe('/api/sync/pull');
      expect(urls[1]).toBe('/api/sync/push');
      expect(engine.getLastSync()).toBe('2026-07-30T12:00:00.000Z');
    });

    it('should NOT pull when starting offline', async () => {
      network.set(false);
      fetchMock.mockResolvedValue(jsonResponse({ success: true, timestamp: 'x' }));
      const engine = createEngine();

      await engine.start();

      expect(fetchMock).not.toHaveBeenCalled();
      expect(engine.isOnline).toBe(false);
    });
  });

  describe('reconnection', () => {
    it('should flush queued items when the network comes back online', async () => {
      network.set(false);
      fetchMock.mockResolvedValue(jsonResponse({ success: true }));
      const engine = createEngine();
      await engine.start();
      await engine.enqueue('create_order', { table_id: 2 });
      fetchMock.mockClear();

      network.set(true);

      // El engine reacciona asíncronamente (pull + flush con IndexedDB). En vez
      // de un sleep fijo (flaky bajo carga de la suite), esperamos de forma
      // determinista a que el push quede registrado y la cola se vacíe.
      await vi.waitFor(() => {
        const urls = fetchMock.mock.calls.map(c => c[0]);
        expect(urls).toContain('/api/sync/push');
      });
      await vi.waitFor(async () => {
        expect(await engine.getPending()).toEqual([]);
      });
    });

    it('should emit online-changed events', async () => {
      fetchMock.mockResolvedValue(jsonResponse({ success: true, timestamp: 'x' }));
      const engine = createEngine();
      const spy = vi.fn();
      engine.subscribe(spy);
      await engine.start();
      spy.mockClear();

      network.set(false);
      network.set(true);

      expect(spy).toHaveBeenCalledWith({ type: 'online-changed', isOnline: false });
      expect(spy).toHaveBeenCalledWith({ type: 'online-changed', isOnline: true });
    });
  });

  describe('lifecycle', () => {
    it('should stop reacting to network changes after stop()', async () => {
      fetchMock.mockResolvedValue(jsonResponse({ success: true }));
      const engine = createEngine();
      await engine.start();
      engine.stop();

      network.set(false);
      network.set(true);

      // sin pull/flush nuevos
      await new Promise(resolve => setTimeout(resolve, 10));
      const pulls = fetchMock.mock.calls.filter(c => c[0] === '/api/sync/pull').length;
      expect(pulls).toBe(1); // solo el pull inicial de start()
    });
  });
});
