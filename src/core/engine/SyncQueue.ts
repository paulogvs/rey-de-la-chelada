/**
 * SyncQueue — IndexedDB Offline Queue
 *
 * Cola de sincronización persistente basada en IndexedDB (dexie).
 * Cuando no hay conexión, las acciones se encolan aquí y se envían
 * cuando se restaura la conexión vía POST /api/sync/push.
 *
 * Artículo I:  SSOT — Único motor de cola para todas las PWAs
 * Artículo VI: Observabilidad — Emite eventos para feedback de UI
 *
 * Eventos emitidos (subscribers):
 *   { type: 'enqueued', item }
 *   { type: 'flushed',  processed, failed, results }
 *   { type: 'failed',   item, error }
 *   { type: 'cleared',  count }
 */

import Dexie, { type Table } from 'dexie';

// ============================================================
// Tipos
// ============================================================

export type SyncAction = 'create_order' | 'update_status' | 'create_payment';

export interface SyncQueueItem {
  /** Auto-increment ID */
  id?: number;
  action: SyncAction;
  payload: Record<string, unknown>;
  /** Epoch ms cuando se encoló */
  timestamp: number;
  /** Intentos de envío fallidos */
  attempts: number;
  /** Último error registrado */
  lastError: string | null;
}

export interface SyncQueueEvent {
  type: 'enqueued' | 'flushed' | 'failed' | 'cleared';
  item?: SyncQueueItem;
  processed?: number;
  failed?: number;
  count?: number;
  error?: string;
}

export interface SyncFlushResult {
  processed: number;
  failed: number;
  results: Array<{ item: SyncQueueItem; ok: boolean; error?: string }>;
}

export type SyncTransport = (
  action: SyncAction,
  payload: Record<string, unknown>,
) => Promise<unknown>;

// ============================================================
// Constantes de reintento
// ============================================================

/** Máximo de intentos antes de dejar el item en cola */
export const MAX_RETRY_ATTEMPTS = 3;

/** Base del backoff exponencial (ms) */
export const BACKOFF_BASE_MS = 1000;

/** Techo de duplicaciones del backoff */
const BACKOFF_MAX_DOUBLINGS = 5;

/** Backoff exponencial según intentos fallidos */
export function getBackoffDelay(item: Pick<SyncQueueItem, 'attempts'>): number {
  const doublings = Math.min(item.attempts, BACKOFF_MAX_DOUBLINGS);
  return BACKOFF_BASE_MS * 2 ** doublings;
}

/** ¿Ya pasó la ventana de backoff para reintentar? */
export function isRetryDue(
  item: Pick<SyncQueueItem, 'attempts' | 'timestamp'>,
  now: number = Date.now(),
): boolean {
  return now >= item.timestamp + getBackoffDelay(item);
}

// ============================================================
// Dexie database
// ============================================================

class SyncQueueDatabase extends Dexie {
  queue!: Table<SyncQueueItem, number>;

  constructor(name: string) {
    super(name);
    this.version(1).stores({
      queue: '++id, action, timestamp, attempts',
    });
  }
}

// ============================================================
// SyncQueue
// ============================================================

export class SyncQueue {
  private db: SyncQueueDatabase;
  private listeners = new Set<(event: SyncQueueEvent) => void>();

  constructor(dbName: string = 'rdlc-sync-queue') {
    this.db = new SyncQueueDatabase(dbName);
  }

  // ── Subscribers (UI feedback) ────────────────────────────

  /** Suscríbete a eventos de la cola. Devuelve función de limpieza. */
  subscribe(listener: (event: SyncQueueEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: SyncQueueEvent): void {
    for (const listener of [...this.listeners]) {
      listener(event);
    }
  }

  // ── API ──────────────────────────────────────────────────

  /** Encola una acción para envío posterior */
  async enqueue(action: SyncAction, payload: Record<string, unknown>): Promise<SyncQueueItem> {
    const item: SyncQueueItem = {
      action,
      payload,
      timestamp: Date.now(),
      attempts: 0,
      lastError: null,
    };
    const id = await this.db.queue.add(item);
    const stored = { ...item, id };
    this.emit({ type: 'enqueued', item: stored });
    return stored;
  }

  /** Items pendientes ordenados FIFO (más antiguos primero) */
  async getPending(): Promise<SyncQueueItem[]> {
    return this.db.queue.orderBy('timestamp').toArray();
  }

  /** Vacía la cola. Devuelve cuántos items se eliminaron. */
  async clear(): Promise<number> {
    const count = await this.db.queue.count();
    if (count > 0) {
      await this.db.queue.clear();
      this.emit({ type: 'cleared', count });
    }
    return count;
  }

  /**
   * Envía los items pendientes vía transport.
   *
   * - Éxito: el item se elimina de la cola.
   * - Falla: attempts++, se registra lastError y el item se conserva
   *   (hasta MAX_RETRY_ATTEMPTS, después se abandona).
   */
  async flush(
    transport: SyncTransport,
    now: number = Date.now(),
  ): Promise<SyncFlushResult> {
    const pending = await this.getPending();
    const results: SyncFlushResult['results'] = [];
    let processed = 0;
    let failed = 0;

    for (const item of pending) {
      // Agotó reintentos — abandonar sin volver a intentar
      if (item.attempts >= MAX_RETRY_ATTEMPTS) {
        continue;
      }

      // Respetar backoff: si aún no toca reintentar, saltar
      if (item.attempts > 0 && !isRetryDue(item, now)) {
        continue;
      }

      try {
        await transport(item.action, item.payload);
        await this.db.queue.delete(item.id as number);
        processed += 1;
        results.push({ item, ok: true });
      } catch (err) {
        const error = err instanceof Error ? err.message : 'Unknown sync error';
        const attempts = item.attempts + 1;
        failed += 1;
        await this.db.queue.update(item.id as number, { attempts, lastError: error });
        const updated: SyncQueueItem = { ...item, attempts, lastError: error };
        results.push({ item: updated, ok: false, error });
        this.emit({ type: 'failed', item: updated, error });
      }
    }

    this.emit({ type: 'flushed', processed, failed, results });
    return { processed, failed, results };
  }

  /** Número de items pendientes */
  async count(): Promise<number> {
    return this.db.queue.count();
  }
}

export default SyncQueue;
