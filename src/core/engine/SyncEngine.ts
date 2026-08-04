/**
 * SyncEngine — Offline Sync Orchestrator
 *
 * Orquesta la sincronización offline del lado cliente:
 *
 *   1. Pull:  al iniciar (POST /api/sync/pull) con el lastSync de localStorage
 *   2. Flush: al reconectar (cola → POST /api/sync/push)
 *   3. Guarda lastSync tras cada pull exitoso
 *
 * Eventos emitidos (subscribers):
 *   { type: 'online-changed', isOnline }
 *   { type: 'pulled', timestamp, data }
 *   { type: 'pull-failed', error }
 *   { type: 'queue-flushed', processed, failed }
 *   { type: 'enqueued', item } | { type: 'failed', item, error } | { type: 'cleared', count }
 *
 * Artículo I:  SSOT — Único orquestador de sync en todas las PWAs
 * Artículo VI: Observabilidad — Eventos para feedback de UI
 */

import { SyncQueue, getBackoffDelay, type SyncAction, type SyncQueueItem, type SyncFlushResult } from './SyncQueue';
import { isBrowserOnline, subscribeOnlineStatus } from '@/pwa/_shared/hooks/useOnlineStatus';
import { TOKEN_KEY_PREFIX } from '@/pwa/_shared/api/apiFetch';

// ============================================================
// Constantes y tipos
// ============================================================

export const LAST_SYNC_STORAGE_KEY = 'rdlc:lastSync';

export interface PullResult {
  timestamp: string;
  data: Record<string, unknown>;
  stats?: Record<string, number>;
}

export type SyncEngineEvent =
  | { type: 'online-changed'; isOnline: boolean }
  | { type: 'pulled'; timestamp: string; data: Record<string, unknown> }
  | { type: 'pull-failed'; error: string }
  | { type: 'queue-flushed'; processed: number; failed: number }
  | { type: 'enqueued'; item: SyncQueueItem }
  | { type: 'failed'; item: SyncQueueItem; error: string }
  | { type: 'cleared'; count: number };

/** Abstracción de storage (localStorage inyectable para tests) */
interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Monitor de red inyectable (para tests) */
export interface NetworkMonitor {
  isOnline(): boolean;
  onChange(cb: (online: boolean) => void): () => void;
}

/** Monitor de red por defecto (navegador) */
const browserNetwork: NetworkMonitor = {
  isOnline: isBrowserOnline,
  onChange: subscribeOnlineStatus,
};

export interface SyncEngineOptions {
  /** Storage para lastSync (default: localStorage) */
  storage?: StorageLike;
  /** Monitor de red (default: navegador) */
  network?: NetworkMonitor;
  /** fetch (default: globalThis.fetch) */
  fetchImpl?: typeof fetch;
  /** Provee el JWT para Authorization (default: localStorage rdlc-token:{moduleId}) */
  tokenProvider?: () => string | null;
  /** Nombre de la base IndexedDB de la cola */
  dbName?: string;
  /** Módulo PWA para leer el token por-módulo (SSOT con apiFetch). */
  moduleId?: string;
}

// ============================================================
// SyncEngine
// ============================================================

export class SyncEngine {
  private queue: SyncQueue;
  private storage: StorageLike;
  private network: NetworkMonitor;
  private fetchImpl: typeof fetch;
  private tokenProvider: () => string | null;
  private online: boolean;
  private started = false;
  private unsubscribeNetwork: (() => void) | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private lastSync: string | null = null;
  private listeners = new Set<(event: SyncEngineEvent) => void>();

  constructor(options: SyncEngineOptions = {}) {
    this.queue = new SyncQueue(options.dbName ?? 'rdlc-sync-queue');
    this.storage = options.storage ?? this.defaultStorage();
    this.network = options.network ?? browserNetwork;
    this.fetchImpl = options.fetchImpl ?? this.defaultFetch();
    // SSOT: el token por defecto se lee con la MISMA clave que apiFetch
    // (rdlc-token:{moduleId}). Antes leía `rdlc:authToken` (clave que nada
    // escribía) → sync nunca llevaba Authorization.
    this.tokenProvider = options.tokenProvider ?? this.defaultTokenProvider(options.moduleId ?? 'staff');
    this.online = this.network.isOnline();
    // Restaurar lastSync desde storage (independiente de start())
    this.restoreLastSync();

    // Reenviar eventos de la cola a los listeners del engine
    this.queue.subscribe(event => {
      if (event.type === 'enqueued' && event.item) {
        this.emit({ type: 'enqueued', item: event.item });
      } else if (event.type === 'failed' && event.item && event.error) {
        this.emit({ type: 'failed', item: event.item, error: event.error });
      } else if (event.type === 'cleared' && event.count !== undefined) {
        this.emit({ type: 'cleared', count: event.count });
      }
    });
  }

  // ── Dependencias por defecto ─────────────────────────────

  private defaultStorage(): StorageLike {
    return {
      getItem: key => (typeof localStorage !== 'undefined' ? localStorage.getItem(key) : null),
      setItem: (key, value) => {
        if (typeof localStorage !== 'undefined') localStorage.setItem(key, value);
      },
    };
  }

  private defaultFetch(): typeof fetch {
    return typeof fetch !== 'undefined' ? fetch.bind(globalThis) : (async () => {
      throw new Error('fetch is not available in this environment');
    }) as typeof fetch;
  }

  private defaultTokenProvider(moduleId: string): () => string | null {
    return () => {
      if (typeof localStorage === 'undefined') return null;
      return localStorage.getItem(`${TOKEN_KEY_PREFIX}${moduleId}`);
    };
  }

  // ── Subscribers ──────────────────────────────────────────

  subscribe(listener: (event: SyncEngineEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: SyncEngineEvent): void {
    for (const listener of [...this.listeners]) {
      listener(event);
    }
  }

  // ── Getters ──────────────────────────────────────────────

  get isOnline(): boolean {
    return this.online;
  }

  getLastSync(): string | null {
    return this.lastSync;
  }

  async getPending(): Promise<SyncQueueItem[]> {
    return this.queue.getPending();
  }

  async getPendingCount(): Promise<number> {
    return this.queue.count();
  }

  // ── Ciclo de vida ────────────────────────────────────────

  /**
   * Inicia el engine: restaura lastSync, escucha la red y,
   * si está online, hace pull + flush inicial.
   */
  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;

    this.restoreLastSync();

    this.unsubscribeNetwork = this.network.onChange(online => {
      this.online = online;
      this.emit({ type: 'online-changed', isOnline: online });
      if (online) {
        void this.syncNow();
      }
    });

    this.online = this.network.isOnline();
    if (this.online) {
      await this.syncNow();
    }
  }

  /** Detiene el engine y limpia timers/suscripciones */
  stop(): void {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    if (this.unsubscribeNetwork) {
      this.unsubscribeNetwork();
      this.unsubscribeNetwork = null;
    }
    this.started = false;
  }

  // ── Operaciones ──────────────────────────────────────────

  /** Encola una acción offline */
  async enqueue(action: SyncAction, payload: Record<string, unknown>): Promise<SyncQueueItem> {
    // El evento 'enqueued' llega vía forwarding de la cola
    return this.queue.enqueue(action, payload);
  }

  /** Descarga cambios del servidor y guarda lastSync */
  async pull(): Promise<PullResult> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const token = this.tokenProvider();
    if (token) headers.Authorization = `Bearer ${token}`;

    const res = await this.fetchImpl('/api/sync/pull', {
      method: 'POST',
      headers,
      body: JSON.stringify({ last_sync: this.lastSync }),
    });

    const json = (await res.json().catch(() => ({}))) as {
      success?: boolean;
      timestamp?: string;
      data?: Record<string, unknown>;
      stats?: Record<string, number>;
      error?: string;
    };

    if (!res.ok || json.success === false) {
      const error = json.error || `Pull failed: HTTP ${res.status}`;
      this.emit({ type: 'pull-failed', error });
      throw new Error(error);
    }

    this.setLastSync(json.timestamp || new Date().toISOString());
    this.emit({
      type: 'pulled',
      timestamp: this.lastSync as string,
      data: json.data || {},
    });
    return { timestamp: this.lastSync as string, data: json.data || {}, stats: json.stats };
  }

  /** Envía la cola pendiente al servidor (POST /api/sync/push) */
  async flush(): Promise<SyncFlushResult> {
    const result = await this.queue.flush(this.transport.bind(this));
    this.emit({ type: 'queue-flushed', processed: result.processed, failed: result.failed });

    // Programar reintento con backoff máximo de los items fallidos
    if (result.failed > 0 && this.online) {
      this.scheduleRetry(result);
    }
    return result;
  }

  /** Vacía la cola (útil para logout/limpieza manual) */
  async clearQueue(): Promise<number> {
    // El evento 'cleared' llega vía forwarding de la cola
    return this.queue.clear();
  }

  // ── Internos ─────────────────────────────────────────────

  /** Pull + flush (usado en startup y al reconectar) */
  private async syncNow(): Promise<void> {
    try {
      await this.pull();
    } catch {
      // 'pull-failed' ya fue emitido — continuar con el flush igualmente
    }
    await this.flush();
  }

  private restoreLastSync(): void {
    this.lastSync = this.storage.getItem(LAST_SYNC_STORAGE_KEY);
  }

  private setLastSync(timestamp: string): void {
    this.lastSync = timestamp;
    this.storage.setItem(LAST_SYNC_STORAGE_KEY, timestamp);
  }

  /** Transport para SyncQueue: envía un item a POST /api/sync/push */
  private async transport(action: SyncAction, payload: Record<string, unknown>): Promise<unknown> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const token = this.tokenProvider();
    if (token) headers.Authorization = `Bearer ${token}`;

    const res = await this.fetchImpl('/api/sync/push', {
      method: 'POST',
      headers,
      body: JSON.stringify({ orders: [{ action, ...payload }] }),
    });

    const json = (await res.json().catch(() => ({}))) as { success?: boolean; error?: string };
    if (!res.ok || json.success === false) {
      throw new Error(json.error || `Push failed: HTTP ${res.status}`);
    }
    return json;
  }

  /** Programa el reintento con backoff exponencial */
  private scheduleRetry(result: SyncFlushResult): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);

    const failedItems = result.results.filter(r => !r.ok).map(r => r.item);
    if (failedItems.length === 0) return;

    // Backoff máximo entre los items fallidos (exponencial)
    const delays = failedItems.map(item => getBackoffDelay(item));
    const delay = Math.max(...delays);

    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (this.online) {
        void this.flush();
      }
    }, delay);
  }
}

export default SyncEngine;
