/**
 * ═══════════════════════════════════════════════════════════
 *  WebSocket Broadcaster — KDS Real-Time Event Dispatcher
 *
 *  SSOT for all WebSocket broadcasts in Rey de la Chelada.
 *  Replaces the naive relay-loop in server/index.js with a
 *  module-aware broadcaster that:
 *    - tracks clients by PWA module (cocina / bar / meseros)
 *    - supports targeted broadcasts (per module or per set)
 *    - never throws (one bad socket must not break the others)
 *    - serializes payloads exactly once per send
 *
 *  Eventos del dominio (KDSEventType):
 *    new_order        → un pedido nuevo entra a KDS
 *    status_change    → cambio de status del pedido
 *    item_ready       → un item pasó a ready
 *    order_complete   → todos los items del pedido están ready
 *
 *  Ruteo por defecto:
 *    new_order, status_change, item_ready → cocina + bar
 *    order_complete                       → meseros
 *
 *  Artículo I:  SSOT — Un solo broadcaster, un solo API.
 *  Artículo VI: Observabilidad — Fail loud (logs) pero nunca tirar.
 * ═══════════════════════════════════════════════════════════
 */

export const KDSEventType = Object.freeze({
  NEW_ORDER: 'new_order',
  STATUS_CHANGE: 'status_change',
  ITEM_READY: 'item_ready',
  ORDER_COMPLETE: 'order_complete',
  MODULE_READY: 'module_ready',
});

/** WebSocket readyState.OPEN === 1 */
const WS_OPEN = 1;

class WebSocketBroadcaster {
  constructor() {
    /** @type {Map<object, {module: string, url: string, registeredAt: number}>} */
    this._clients = new Map();
  }

  /**
   * Attach to a WebSocketServer instance — wires up the connection handler.
   * Idempotent: a second attach replaces the previous handler.
   */
  attach(wss) {
    if (!wss || typeof wss.on !== 'function') {
      throw new Error('[Broadcaster] attach() requires a WebSocketServer');
    }
    this._wss = wss;
    this._wss.on('connection', (ws, req) => {
      const url = (req && req.url) || '';
      const module = this._moduleFromUrl(url);
      this.registerClient(ws, url, module);
    });
  }

  /**
   * Resolve the PWA module from a connection URL.
   * Order matters: more-specific paths first.
   */
  _moduleFromUrl(url) {
    if (url.startsWith('/cocina')) return 'cocina';
    if (url.startsWith('/bar')) return 'bar';
    if (url.startsWith('/meseros')) return 'meseros';
    if (url.startsWith('/caja')) return 'caja';
    return 'unknown';
  }

  /**
   * Register a client connection with its module.
   */
  registerClient(ws, url, module) {
    if (!ws) return;
    this._clients.set(ws, {
      module: module || 'unknown',
      url: url || '',
      registeredAt: Date.now(),
    });
  }

  /**
   * Remove a client connection. Safe to call for unknown clients.
   */
  unregisterClient(ws) {
    if (!ws) return;
    this._clients.delete(ws);
  }

  /**
   * Send an event to ALL connected clients (regardless of module).
   */
  broadcast(payload) {
    const serialized = this._serialize(payload);
    for (const [ws] of this._clients) {
      this._safeSend(ws, serialized);
    }
  }

  /**
   * Send an event to clients of a single module.
   */
  broadcastToModule(module, payload) {
    const serialized = this._serialize(payload);
    for (const [ws, meta] of this._clients) {
      if (meta.module === module) {
        this._safeSend(ws, serialized);
      }
    }
  }

  /**
   * Send an event to clients of multiple modules.
   */
  broadcastToModules(modules, payload) {
    if (!Array.isArray(modules) || modules.length === 0) {
      this.broadcast(payload);
      return;
    }
    const serialized = this._serialize(payload);
    const target = new Set(modules);
    for (const [ws, meta] of this._clients) {
      if (target.has(meta.module)) {
        this._safeSend(ws, serialized);
      }
    }
  }

  /**
   * Shorthand: send a KDS event to cocina + bar (the kitchen teams).
   */
  broadcastKDS(payload) {
    this.broadcastToModules(['cocina', 'bar'], payload);
  }

  /**
   * Shorthand: send an event to meseros only.
   */
  broadcastMeseros(payload) {
    this.broadcastToModule('meseros', payload);
  }

  /**
   * Count connected clients, optionally filtered by module.
   */
  getClientCount(module) {
    if (!module) return this._clients.size;
    let n = 0;
    for (const [, meta] of this._clients) {
      if (meta.module === module) n++;
    }
    return n;
  }

  /**
   * Serialize the payload once. Returns the JSON string.
   */
  _serialize(payload) {
    return JSON.stringify(payload);
  }

  /**
   * Send a serialized payload to a single client.
   * Swallows errors so one dead socket doesn't break the broadcast.
   */
  _safeSend(ws, serialized) {
    try {
      if (ws.readyState === WS_OPEN) {
        ws.send(serialized);
      }
    } catch (err) {
      // Fail loud in logs but never throw to caller
      console.warn(`[Broadcaster] Send failed for module=${this._clients.get(ws)?.module}: ${err.message}`);
    }
  }
}

/**
 * Build a KDS event with the canonical shape:
 *   { type, orderId, tableNumber, timestamp, ...extra }
 *
 * Always includes an ISO 8601 timestamp.
 */
function buildKDSEvent(type, fields = {}) {
  return {
    type,
    timestamp: new Date().toISOString(),
    ...fields,
  };
}

// Singleton — one broadcaster per process
const broadcaster = new WebSocketBroadcaster();

export { WebSocketBroadcaster, broadcaster, buildKDSEvent };
export default broadcaster;
