/**
 * SyncQueue Tests
 *
 * Artículo III: TDD — Pruebas antes de producción.
 *
 * IndexedDB-backed offline queue. Runs in node with fake-indexeddb.
 */

import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SyncQueue, MAX_RETRY_ATTEMPTS, BACKOFF_BASE_MS, FLUSH_BATCH_SIZE, getBackoffDelay, isRetryDue } from '../../src/core/engine/SyncQueue';

describe('SyncQueue', () => {
  let queue: SyncQueue;

  beforeEach(async () => {
    queue = new SyncQueue('rdlc-test-sync-queue');
    // fake-indexeddb persiste entre tests del mismo archivo — limpiar
    await queue.clear();
  });

  describe('enqueue', () => {
    it('should add an item with defaults', async () => {
      const item = await queue.enqueue('create_order', { table_id: 3, total: 25 });
      expect(item.id).toBeDefined();
      expect(item.action).toBe('create_order');
      expect(item.payload).toEqual({ table_id: 3, total: 25 });
      expect(item.timestamp).toBeGreaterThan(0);
      expect(item.attempts).toBe(0);
      expect(item.lastError).toBeNull();
    });

    it('should emit an "enqueued" event', async () => {
      const spy = vi.fn();
      queue.subscribe(spy);
      await queue.enqueue('update_status', { id: 1 });
      expect(spy).toHaveBeenCalledWith(expect.objectContaining({ type: 'enqueued' }));
    });
  });

  describe('getPending', () => {
    it('should return items ordered by timestamp (FIFO)', async () => {
      const first = await queue.enqueue('create_order', { n: 1 });
      const second = await queue.enqueue('create_payment', { n: 2 });

      // Force ordering: first has earlier timestamp
      const pending = await queue.getPending();
      expect(pending).toHaveLength(2);
      expect(pending[0].id).toBe(first.id);
      expect(pending[1].id).toBe(second.id);
    });

    it('should return empty array when queue is empty', async () => {
      expect(await queue.getPending()).toEqual([]);
    });
  });

  describe('clear', () => {
    it('should remove all items and emit a "cleared" event', async () => {
      await queue.enqueue('create_order', {});
      await queue.enqueue('create_order', {});
      const spy = vi.fn();
      queue.subscribe(spy);
      const count = await queue.clear();
      expect(count).toBe(2);
      expect(await queue.getPending()).toEqual([]);
      expect(spy).toHaveBeenCalledWith(expect.objectContaining({ type: 'cleared', count: 2 }));
    });
  });

  describe('flush', () => {
    it('should send each pending item through the transport and remove it on success', async () => {
      const transport = vi.fn(async (action: string, payload: Record<string, unknown>) => ({ ok: true }));
      await queue.enqueue('create_order', { table_id: 1 });
      await queue.enqueue('create_payment', { id: 2 });

      const result = await queue.flush(transport);

      expect(transport).toHaveBeenCalledTimes(2);
      expect(transport).toHaveBeenCalledWith('create_order', { table_id: 1 });
      expect(transport).toHaveBeenCalledWith('create_payment', { id: 2 });
      expect(result.processed).toBe(2);
      expect(result.failed).toBe(0);
      expect(await queue.getPending()).toEqual([]);
    });

    it('should increment attempts and keep the item when transport throws', async () => {
      const transport = vi.fn(async () => { throw new Error('network down'); });
      const item = await queue.enqueue('create_order', { table_id: 5 });

      const result = await queue.flush(transport);

      expect(result.processed).toBe(0);
      expect(result.failed).toBe(1);
      const pending = await queue.getPending();
      expect(pending).toHaveLength(1);
      expect(pending[0].attempts).toBe(1);
      expect(pending[0].lastError).toContain('network down');
      expect(item.id).toBe(pending[0].id);
    });

    it('should emit a "failed" event on transport error', async () => {
      const transport = vi.fn(async () => { throw new Error('boom'); });
      const spy = vi.fn();
      queue.subscribe(spy);
      await queue.enqueue('create_order', {});
      await queue.flush(transport);
      expect(spy).toHaveBeenCalledWith(expect.objectContaining({ type: 'failed' }));
    });

    it('should not retry an item that has reached MAX_RETRY_ATTEMPTS', async () => {
      const transport = vi.fn(async () => { throw new Error('nope'); });
      await queue.enqueue('create_order', {});
      let now = Date.now();

      // Burn all retries, advancing past each exponential backoff window
      for (let i = 0; i < MAX_RETRY_ATTEMPTS; i++) {
        now += BACKOFF_BASE_MS * 2 ** i + 10;
        await queue.flush(transport, now);
      }
      expect(transport).toHaveBeenCalledTimes(MAX_RETRY_ATTEMPTS);

      // A further flush (even past backoff) must NOT touch the exhausted item
      now += BACKOFF_BASE_MS * 2 ** 5 + 10;
      const result = await queue.flush(transport, now);
      expect(transport).toHaveBeenCalledTimes(MAX_RETRY_ATTEMPTS);
      expect(result.processed).toBe(0);

      const pending = await queue.getPending();
      expect(pending[0].attempts).toBe(MAX_RETRY_ATTEMPTS);
    });

    it('should not call transport when queue is empty', async () => {
      const transport = vi.fn();
      const result = await queue.flush(transport);
      expect(transport).not.toHaveBeenCalled();
      expect(result.processed).toBe(0);
    });
  });

  describe('flush batch (P2-1)', () => {
    it('should not process more than FLUSH_BATCH_SIZE items per call', async () => {
      const transport = vi.fn(async () => ({ ok: true }));
      // 60 items con timestamps crecientes → FIFO
      for (let i = 0; i < FLUSH_BATCH_SIZE + 10; i++) {
        await queue.enqueue('create_order', { n: i });
      }

      const first = await queue.flush(transport);
      expect(first.processed).toBe(FLUSH_BATCH_SIZE);
      // Los 10 restantes siguen pendientes
      expect(await queue.getPending()).toHaveLength(10);

      const second = await queue.flush(transport);
      expect(second.processed).toBe(10);
      expect(await queue.getPending()).toHaveLength(0);
    });
  });

  describe('pruneAbandoned (P2-1)', () => {
    /** Helper: retrocede el timestamp de un item en la DB */
    async function setTimestamp(id: number, ts: number): Promise<void> {
      const db = (queue as unknown as { db: { queue: { update: (id: number, mods: object) => Promise<number> } } }).db;
      await db.queue.update(id, { timestamp: ts });
    }

    /** Abandona un item: lo quema hasta MAX_RETRY_ATTEMPTS fallos */
    async function abandonItem(now: number): Promise<number> {
      const item = await queue.enqueue('create_order', { doomed: true });
      const transport = vi.fn(async () => { throw new Error('nope'); });
      // El timestamp del item ≈ ahora real; el backoff es relativo a ese
      // timestamp, así que avanzamos t por ENCIMA de cada ventana.
      let t = now;
      for (let i = 0; i < MAX_RETRY_ATTEMPTS; i++) {
        t += BACKOFF_BASE_MS * 2 ** i + 10;
        await queue.flush(transport, t);
      }
      return item.id as number;
    }

    it('borra abandonados viejos y conserva los vivos pendientes', async () => {
      const now = Date.now();
      // 1) Abandonado VIEJO (8 días) → debe purgarse
      const oldId = await abandonItem(now);
      await setTimestamp(oldId, now - 8 * 24 * 60 * 60 * 1000);
      // 2) Item vivo reciente → debe conservarse
      const live = await queue.enqueue('create_order', { live: true });

      const removed = await queue.pruneAbandoned(7 * 24 * 60 * 60 * 1000, now);

      expect(removed).toBe(1);
      const pending = await queue.getPending();
      expect(pending.map(i => i.id)).toContain(live.id);
      expect(pending.map(i => i.id)).not.toContain(oldId);
    });

    it('conserva abandonados RECIENTES (dentro de maxAgeMs)', async () => {
      const now = Date.now();
      const recentId = await abandonItem(now); // timestamp ≈ ahora
      const removed = await queue.pruneAbandoned(7 * 24 * 60 * 60 * 1000, now);
      expect(removed).toBe(0);
      expect((await queue.getPending()).map(i => i.id)).toContain(recentId);
    });

    it('emite evento "cleared" cuando purga items', async () => {
      const now = Date.now();
      const spy = vi.fn();
      queue.subscribe(spy);
      const oldId = await abandonItem(now);
      await setTimestamp(oldId, now - 8 * 24 * 60 * 60 * 1000);

      await queue.pruneAbandoned(7 * 24 * 60 * 60 * 1000, now);

      expect(spy).toHaveBeenCalledWith(expect.objectContaining({ type: 'cleared', count: 1 }));
    });

    it('no emite "cleared" cuando no hay nada que purgar', async () => {
      const now = Date.now();
      const spy = vi.fn();
      queue.subscribe(spy);
      await queue.pruneAbandoned(7 * 24 * 60 * 60 * 1000, now);
      expect(spy).not.toHaveBeenCalled();
    });
  });

  describe('retry backoff helpers', () => {
    it('should compute exponential backoff based on attempts', () => {
      expect(getBackoffDelay({ attempts: 0 } as never)).toBe(BACKOFF_BASE_MS * 2 ** 0);
      expect(getBackoffDelay({ attempts: 1 } as never)).toBe(BACKOFF_BASE_MS * 2 ** 1);
      expect(getBackoffDelay({ attempts: 2 } as never)).toBe(BACKOFF_BASE_MS * 2 ** 2);
    });

    it('should cap backoff at 5 doublings', () => {
      expect(getBackoffDelay({ attempts: 9 } as never)).toBe(BACKOFF_BASE_MS * 2 ** 5);
    });

    it('should consider an item retryable once its backoff window has passed', () => {
      const item = { attempts: 1, timestamp: 1000 } as never;
      const delay = getBackoffDelay(item);
      expect(isRetryDue(item, 1000 + delay - 1)).toBe(false);
      expect(isRetryDue(item, 1000 + delay)).toBe(true);
    });
  });
});
