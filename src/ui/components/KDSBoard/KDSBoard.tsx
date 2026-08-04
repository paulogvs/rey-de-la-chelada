/**
 * KDSBoard — Pantalla KDS compartida (cocina y bar) parametrizada por módulo.
 *
 * FASE 1 (KDS separado): un único componente SSOT que sirve a /cocina/
 * (module='cocina') y /bar/ (module='bar'). Cada pantalla:
 *   - fetch inicial GET /api/orders/kds/:module con token (rol kds/admin)
 *   - WebSocket real-time del módulo (useKDSWebSocket)
 *   - filtro defensivo por kds_module (pedidos mixtos → cada área ve lo suyo)
 *   - estados: nuevo → preparando → listo/entregado, rechazo, fullscreen, audio
 *
 * Antes el KDS dependía 100% del WebSocket; el fetch inicial con token
 * arregla el "KDS vacío al refrescar".
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useKDSWebSocket } from '@/pwa/_shared/hooks/useKDSWebSocket';
import { useFullscreen } from '@/pwa/_shared/hooks/useFullscreen';
import { fetchKDSOrders, updateKDSItemStatus } from '@/pwa/_shared/api/kdsApi';
import { orderEngine } from '@/core/engine';
import { KDSOrderCard, KDSOrderCardSkeleton } from '@/ui/components/KDSOrderCard';
import { Badge } from '@/ui/components/Badge';
import { EmptyState } from '@/ui/components/EmptyState';
import { filterItemsByModule, type KDSModule } from './filter';
import type { Order, KDSEvent, KDSStatus } from '@/core/types';
import './KDSBoard.css';

// ---- Audio System (Web Audio API) ----

class KDSAudio {
  private ctx: AudioContext | null = null;

  private getContext(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext();
    }
    return this.ctx;
  }

  private beep(frequency: number, duration: number, type: OscillatorType = 'sine') {
    try {
      const ctx = this.getContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.value = frequency;
      gain.gain.value = 0.15;
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + duration);
    } catch {
      // Audio not available
    }
  }

  newOrder() {
    this.beep(880, 0.15);
    setTimeout(() => this.beep(1100, 0.2), 150);
  }

  urgent() {
    this.beep(440, 0.5, 'square');
  }

  completed() {
    this.beep(660, 0.2);
    setTimeout(() => this.beep(880, 0.3), 200);
  }
}

const kdsAudio = new KDSAudio();

// ---- Component ----

export interface KDSBoardProps {
  /** 'cocina' o 'bar' — determina el fetch, WS y filtro de items */
  module: KDSModule;
  /** Título mostrado en el header */
  title: string;
  /** Icono del header */
  icon: string;
  /** JWT del staff (rol kds/admin) para el fetch inicial */
  token: string | null;
}

export function KDSBoard({ module, title, icon, token }: KDSBoardProps) {
  const { isFullscreen, toggleFullscreen } = useFullscreen();

  const [orders, setOrders] = useState<Order[]>([]);
  const [newOrderIds, setNewOrderIds] = useState<Set<string>>(new Set());
  const [urgentOrderIds, setUrgentOrderIds] = useState<Set<string>>(new Set());
  const [audioEnabled, setAudioEnabled] = useState(true);
  const [isConnected, setIsConnected] = useState(true);
  const [loading, setLoading] = useState(true);

  const prevOrderIdsRef = useRef<Set<string>>(new Set());
  const prevUrgentRef = useRef<Set<string>>(new Set());
  const loadOrdersRef = useRef<() => void>(() => {});
  const audioRef = useRef(true);

  audioRef.current = audioEnabled;

  // WebSocket — real-time del módulo + polling fallback.
  const ws = useKDSWebSocket({
    module,
    onFallback: () => loadOrdersRef.current(),
  });

  // Snapshot inicial con token — arregla el KDS vacío al refrescar.
  useEffect(() => {
    if (!token) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      const result = await fetchKDSOrders(token, module);
      if (cancelled) return;
      if (result.ok) {
        result.orders.forEach(order => orderEngine.importOrder(order));
        loadOrdersRef.current();
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [token, module]);

  // Load orders from engine + detect new/urgent
  const loadOrders = useCallback(() => {
    const rawOrders = orderEngine.getKDSOrders();
    const now = Date.now();

    // Filtro defensivo: solo items del módulo (SSOT del área)
    const moduleOrders = filterItemsByModule(rawOrders, module);

    const currentIds = new Set(moduleOrders.map(o => o.id));
    const newIds = new Set<string>();
    moduleOrders.forEach(order => {
      if (!prevOrderIdsRef.current.has(order.id)) {
        newIds.add(order.id);
        if (audioRef.current) kdsAudio.newOrder();
      }
    });

    const urgentIds = new Set<string>();
    moduleOrders.forEach(order => {
      const elapsed = (now - new Date(order.createdAt).getTime()) / 60000;
      if (elapsed >= 15) urgentIds.add(order.id);
    });

    urgentIds.forEach(id => {
      if (!prevUrgentRef.current.has(id) && audioRef.current) {
        kdsAudio.urgent();
      }
    });

    prevOrderIdsRef.current = currentIds;
    prevUrgentRef.current = urgentIds;
    setOrders(moduleOrders);
    setNewOrderIds(newIds);
    setUrgentOrderIds(urgentIds);
    setLoading(false);
  }, [module]);

  loadOrdersRef.current = loadOrders;

  // Keep connection badge in sync
  useEffect(() => {
    setIsConnected(ws.isConnected);
  }, [ws.isConnected]);

  // Subscribe to engine changes + polling fallback
  useEffect(() => {
    loadOrders();
    const unsubscribe = orderEngine.onChange(loadOrders);

    let interval: ReturnType<typeof setInterval> | null = null;
    if (ws.shouldFallback) {
      interval = setInterval(loadOrders, 30000);
    }
    return () => {
      unsubscribe();
      if (interval) clearInterval(interval);
    };
  }, [loadOrders, ws.shouldFallback]);

  // Subscribe to KDS events (audio alerts)
  useEffect(() => {
    const unsubscribe = orderEngine.onKDSEvent((event: KDSEvent) => {
      if (event.type === 'new_order' && audioRef.current) {
        kdsAudio.newOrder();
      }
    });
    return unsubscribe;
  }, []);

  // Handle item status change — FASE 2: optimista local + persistencia
  // server-side (PATCH item status) para que el circuito cerrado funcione:
  // el servidor guarda y hace broadcast a meseros/otros KDS.
  const handleItemStatusChange = useCallback((orderId: string, itemId: string, status: KDSStatus) => {
    const success = orderEngine.updateItemStatus(orderId, itemId, status);
    if (!success) return;
    if (status === 'ready') {
      kdsAudio.completed();
    }
    if (token) {
      void updateKDSItemStatus(token, orderId, itemId, status).then(result => {
        if (!result.ok) {
          console.warn(`[KDS] Item status persist failed (${itemId} → ${status}): ${result.code}`);
        }
      });
    }
  }, [token]);

  // Handle order acknowledge (confirmed → preparing)
  const handleAcknowledge = useCallback((orderId: string) => {
    const order = orderEngine.getOrder(orderId);
    if (order && order.status === 'confirmed') {
      order.items.forEach(item => {
        if (item.status === 'pending') {
          orderEngine.updateItemStatus(orderId, item.id, 'preparing');
        }
      });
      setNewOrderIds(prev => {
        const updated = new Set(prev);
        updated.delete(orderId);
        return updated;
      });
    }
  }, []);

  // Handle order reject (pending → cancelled) — FASE 2: persistir igual
  const handleReject = useCallback((orderId: string) => {
    const order = orderEngine.getOrder(orderId);
    if (!order) return;
    order.items.forEach(item => {
      if (item.status === 'pending') {
        orderEngine.updateItemStatus(orderId, item.id, 'cancelled');
        if (token) {
          void updateKDSItemStatus(token, orderId, item.id, 'cancelled').then(result => {
            if (!result.ok) {
              console.warn(`[KDS] Item reject persist failed (${item.id}): ${result.code}`);
            }
          });
        }
      }
    });
  }, [token]);

  // Toggle audio
  const toggleAudio = useCallback(() => {
    setAudioEnabled(prev => !prev);
  }, []);

  // Sort: urgent first, then oldest
  const sortedOrders = [...orders].sort((a, b) => {
    const aUrgent = urgentOrderIds.has(a.id);
    const bUrgent = urgentOrderIds.has(b.id);
    if (aUrgent && !bUrgent) return -1;
    if (!aUrgent && bUrgent) return 1;
    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  });

  return (
    <div className="kds-screen">
      {/* Top bar */}
      <header className="kds-header">
        <div className="kds-header__left">
          <h1 className="kds-header__title">
            <span aria-hidden="true">{icon}</span> {title}
          </h1>
          <Badge variant={isConnected ? 'ready' : 'cancelled'}>
            {isConnected ? 'Conectado' : 'Sin conexión'}
          </Badge>
        </div>
        <div className="kds-header__right">
          <Badge variant="info" large>
            {sortedOrders.length} pedidos
          </Badge>
          {urgentOrderIds.size > 0 && (
            <Badge variant="warning" large>
              {urgentOrderIds.size} urgentes
            </Badge>
          )}
          <button
            type="button"
            className={`kds-header__audio-btn ${audioEnabled ? 'active' : ''}`}
            onClick={toggleAudio}
            aria-label={audioEnabled ? 'Silenciar alertas' : 'Activar alertas'}
          >
            {audioEnabled ? '🔊' : '🔇'}
          </button>
          <button
            type="button"
            className={`kds-header__audio-btn ${isFullscreen ? 'active' : ''}`}
            onClick={toggleFullscreen}
            aria-label={isFullscreen ? 'Salir de pantalla completa' : 'Entrar en pantalla completa'}
            title={isFullscreen ? 'Salir de pantalla completa' : 'Pantalla completa'}
          >
            {isFullscreen ? '⤢' : '⛶'}
          </button>
        </div>
      </header>

      {/* Orders grid */}
      <main className="kds-orders">
        {loading && (
          <div className="kds-orders__grid">
            {[1, 2, 3, 4, 5, 6].map(i => (
              <KDSOrderCardSkeleton key={i} />
            ))}
          </div>
        )}

        {!loading && sortedOrders.length === 0 && (
          <EmptyState
            icon={icon}
            title="Todos los pedidos completados"
            message="Esperando nuevos pedidos..."
          />
        )}

        {!loading && sortedOrders.length > 0 && (
          <div
            className="kds-orders__grid"
            style={{
              gridTemplateColumns: `repeat(${Math.min(sortedOrders.length, 4)}, 1fr)`,
            }}
          >
            {sortedOrders.map(order => (
              <KDSOrderCard
                key={order.id}
                order={order}
                isUrgent={urgentOrderIds.has(order.id)}
                isNew={newOrderIds.has(order.id)}
                onItemStatusChange={handleItemStatusChange}
                onAcknowledge={handleAcknowledge}
                onReject={handleReject}
                variant={module}
              />
            ))}
          </div>
        )}
      </main>

      {/* Footer stats */}
      <footer className="kds-footer">
        <span className="kds-footer__stat">
          Activos: {sortedOrders.length}
        </span>
        <span className="kds-footer__stat">
          Urgentes: {urgentOrderIds.size}
        </span>
        <span className="kds-footer__stat kds-footer__stat--hint">
          Tap item → cambiar estado
        </span>
      </footer>
    </div>
  );
}

export default KDSBoard;
