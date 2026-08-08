/**
 * useKDSWebSocket — KDS Real-Time WebSocket Hook
 *
 * Connects the client PWAs (cocina / bar / meseros) to the server
 * WebSocket broadcaster (server/services/websocket-broadcaster.js) so
 * orders arrive in real time instead of polling every 30s.
 *
 * Wire protocol (server → client):
 *   { type: 'connected', module, timestamp }            — connection ack
 *   { type: 'new_order', orderId, tableNumber, items, status }
 *   { type: 'status_change', orderId, tableNumber, items, previousStatus, status }
 *   { type: 'item_ready', orderId, tableNumber, items }
 *   { type: 'order_complete', orderId, tableNumber, status }
 *
 * The hook:
 *   - connects to ws(s)://{host}/{module}
 *   - parses + normalizes each message (pure helpers, unit-tested)
 *   - dispatches into the in-memory orderEngine via applyKDSEvent
 *   - auto-reconnects with exponential backoff (1s → 30s)
 *   - falls back to polling (via shouldFallback) when the connection
 *     fails after maxReconnectAttempts — offline mode is not broken
 *   - cleans up on unmount
 *
 * Artículo I:  SSOT — Un solo punto de entrada real-time para el KDS
 * Artículo VI: Observabilidad — isConnected/reconnectAttempts expuestos
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { orderEngine } from '@/core/engine';
import type { KDSIncomingEvent, OrderLineItem, KDSStatus, OrderStatus } from '@/core/types';

// ============================================================
// Pure helpers (no React — unit-testable in node)
// ============================================================

export const KDS_EVENT_TYPES = new Set([
  'new_order',
  'status_change',
  'item_ready',
  'order_complete',
]);

/**
 * Parse a raw WebSocket message into a normalized KDSIncomingEvent.
 * Returns null for malformed JSON, non-object payloads, unknown types,
 * or order events without an orderId.
 */
export function parseKDSMessage(raw: string): KDSIncomingEvent | null {
  if (!raw) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (typeof parsed !== 'object' || parsed === null) return null;

  const msg = parsed as Record<string, unknown>;
  if (typeof msg.type !== 'string' || !KDS_EVENT_TYPES.has(msg.type)) return null;
  if (typeof msg.orderId !== 'string' || msg.orderId === '') return null;

  const event: KDSIncomingEvent = {
    type: msg.type as KDSIncomingEvent['type'],
    orderId: msg.orderId,
  };

  if (typeof msg.tableNumber === 'number') event.tableNumber = msg.tableNumber;
  if (typeof msg.tableId === 'string') event.tableId = msg.tableId;
  if (typeof msg.waiterId === 'string') event.waiterId = msg.waiterId;
  if (typeof msg.waiterName === 'string') event.waiterName = msg.waiterName;
  if (typeof msg.itemId === 'string') event.itemId = msg.itemId;
  if (typeof msg.status === 'string') {
    event.status = msg.status as OrderStatus | KDSStatus;
  }
  if (typeof msg.previousStatus === 'string') event.previousStatus = msg.previousStatus;
  if (typeof msg.timestamp === 'string') event.timestamp = msg.timestamp;

  // Normalize items (server DB snake_case → client camelCase)
  if (Array.isArray(msg.items)) {
    event.items = msg.items
      .map(normalizeServerItem)
      .filter((i): i is OrderLineItem => i !== null);
  }

  return event;
}

/**
 * Exponential backoff in ms: initial * 2^attempt, capped at max.
 */
export function getBackoffDelay(attempt: number, initialMs = 1000, maxMs = 30000): number {
  const safeAttempt = Math.max(0, attempt);
  const delay = initialMs * Math.pow(2, safeAttempt);
  return Math.min(delay, maxMs);
}

/**
 * Build the WebSocket URL for a PWA module.
 *   ws(s)://{host}/{module}
 */
export function buildWsUrl(module: string, baseUrl?: string): string {
  const base = baseUrl || (typeof window !== 'undefined'
    ? `${window.location.protocol}//${window.location.host}`
    : 'http://localhost');
  const cleanBase = base.replace(/\/+$/, '');
  const isSecure = cleanBase.startsWith('https:');
  const wsProtocol = isSecure ? 'wss:' : 'ws:';
  // Replace protocol while keeping host+port+path
  const rest = cleanBase.replace(/^https?:\/\//, '');
  return `${wsProtocol}//${rest}/${module.replace(/^\/+/, '')}`;
}

/**
 * Normalize a server-shaped order item (snake_case) into the client
 * OrderLineItem shape (camelCase). Returns null for invalid entries.
 */
export function normalizeServerItem(raw: unknown): OrderLineItem | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const src = raw as Record<string, unknown>;
  if (typeof src.id !== 'string' || src.id === '') return null;

  const unitPrice = typeof src.unit_price === 'number' ? src.unit_price : 0;
  const quantity = typeof src.quantity === 'number' ? src.quantity : 1;

  // modifiers_json: JSON string of [{groupName, optionName, priceAdjustment}]
  let modifiers: OrderLineItem['modifiers'] = [];
  if (typeof src.modifiers_json === 'string') {
    try {
      const parsed = JSON.parse(src.modifiers_json);
      if (Array.isArray(parsed)) {
        modifiers = parsed.map(m => ({
          groupName: String(m.groupName ?? ''),
          optionName: String(m.optionName ?? ''),
          priceAdjustment: typeof m.priceAdjustment === 'number' ? m.priceAdjustment : 0,
        }));
      }
    } catch {
      // invalid modifiers_json → empty modifiers
    }
  }

  const modTotal = modifiers.reduce((sum, m) => sum + m.priceAdjustment, 0);
  const status = (src.item_status as KDSStatus) || 'pending';

  return {
    id: src.id,
    menuItemId: typeof src.menu_item_id === 'string' ? src.menu_item_id : '',
    menuItemName: typeof src.item_name === 'string' ? src.item_name : 'Item',
    quantity,
    unitPrice,
    modifiers,
    subtotal: Math.round((unitPrice + modTotal) * quantity * 100) / 100,
    status,
    preparationNotes: typeof src.item_notes === 'string' ? src.item_notes : '',
    createdAt: typeof src.created_at === 'string' ? src.created_at : new Date().toISOString(),
    ...(typeof src.kds_module === 'string' ? { kds_module: src.kds_module } : {}),
  };
}

// ============================================================
// Hook options & result
// ============================================================

export interface UseKDSWebSocketOptions {
  /** PWA module for the WS path: /cocina, /bar, /meseros, /caja (default: 'cocina') */
  module?: 'cocina' | 'bar' | 'meseros' | 'caja';
  /** Override the server base URL (default: window.location) */
  baseUrl?: string;
  /** Initial backoff delay in ms (default 1000) */
  initialBackoffMs?: number;
  /** Max backoff delay in ms (default 30000) */
  maxBackoffMs?: number;
  /** Reconnect attempts before falling back to polling (default 5) */
  maxReconnectAttempts?: number;
  /** Disable the connection entirely (default: enabled) */
  enabled?: boolean;
  /** Called for every parsed KDS event (for UI alerts, logging) */
  onEvent?: (event: KDSIncomingEvent) => void;
  /** Called when the connection falls back to polling */
  onFallback?: () => void;
}

export interface UseKDSWebSocketResult {
  /** True while the WebSocket is open */
  isConnected: boolean;
  /** Current reconnect attempt count (0 = first connection) */
  reconnectAttempts: number;
  /** True once maxReconnectAttempts is exceeded → caller should poll */
  shouldFallback: boolean;
  /** Force-reconnect (useful after going back online) */
  reconnect: () => void;
}

// ============================================================
// Hook
// ============================================================

export function useKDSWebSocket(options: UseKDSWebSocketOptions = {}): UseKDSWebSocketResult {
  const {
    module = 'cocina',
    baseUrl,
    initialBackoffMs = 1000,
    maxBackoffMs = 30000,
    maxReconnectAttempts = 5,
    enabled = true,
    onEvent,
    onFallback,
  } = options;

  const [isConnected, setIsConnected] = useState(false);
  const [reconnectAttempts, setReconnectAttempts] = useState(0);
  const [shouldFallback, setShouldFallback] = useState(false);
  const [reconnectTick, setReconnectTick] = useState(0);

  const wsRef = useRef<WebSocket | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onEventRef = useRef(onEvent);
  const onFallbackRef = useRef(onFallback);

  onEventRef.current = onEvent;
  onFallbackRef.current = onFallback;

  const reconnect = useCallback(() => {
    setReconnectTick(t => t + 1);
  }, []);

  useEffect(() => {
    if (!enabled || typeof window === 'undefined' || typeof WebSocket === 'undefined') {
      return undefined;
    }

    let disposed = false;
    let attempts = 0;
    const url = buildWsUrl(module, baseUrl);

    const clearTimer = () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };

    const dispatch = (event: KDSIncomingEvent) => {
      orderEngine.applyKDSEvent(event);
      onEventRef.current?.(event);
    };

    const connect = () => {
      if (disposed) return;

      let ws: WebSocket;
      try {
        ws = new WebSocket(url);
      } catch {
        // URL invalid — schedule retry
        scheduleReconnect();
        return;
      }
      wsRef.current = ws;

      ws.onopen = () => {
        if (disposed) return;
        attempts = 0;
        setIsConnected(true);
        setReconnectAttempts(0);
        setShouldFallback(false);
      };

      ws.onmessage = (ev: MessageEvent) => {
        const event = parseKDSMessage(typeof ev.data === 'string' ? ev.data : '');
        if (event) dispatch(event);
      };

      ws.onerror = () => {
        // onclose will follow — handled there to avoid double-schedule
      };

      ws.onclose = () => {
        if (disposed) return;
        setIsConnected(false);
        scheduleReconnect();
      };
    };

    const scheduleReconnect = () => {
      if (disposed) return;
      attempts += 1;
      setReconnectAttempts(attempts);

      if (attempts >= maxReconnectAttempts) {
        setShouldFallback(true);
        onFallbackRef.current?.();
      }

      const delay = getBackoffDelay(attempts - 1, initialBackoffMs, maxBackoffMs);
      clearTimer();
      timerRef.current = setTimeout(connect, delay);
    };

    connect();

    return () => {
      disposed = true;
      clearTimer();
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.onmessage = null;
        wsRef.current.onerror = null;
        wsRef.current.close();
        wsRef.current = null;
      }
    };
    // reconnectTick triggers a manual reconnect
  }, [module, baseUrl, enabled, reconnectTick, initialBackoffMs, maxBackoffMs, maxReconnectAttempts]);

  return { isConnected, reconnectAttempts, shouldFallback, reconnect };
}

export default useKDSWebSocket;
