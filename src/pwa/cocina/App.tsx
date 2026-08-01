/**
 * PWA COCINA — Unified KDS (Kitchen Display System)
 *
 * Shows all items from both cocina and bar areas, filtered by area tabs.
 * Each item has its own status (pending → preparing → ready).
 * "Listo" button per item marks as ready → WebSocket broadcast.
 * Full-screen, landscape, no scroll.
 * Auto-sort by urgency (oldest first, urgent highlighted).
 * Sound alert on new order (Web Audio API).
 * Gold pulse flash on new order. Red pulse flash on urgent (>15 min).
 * Touch-friendly tap to mark items.
 * WebSocket connection with auto-reconnect.
 * Offline state indicator.
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { bootstrapPwa } from '../_shared/bootstrap';
import { setCurrentPwaModule } from '../_shared/hooks/useCapability';
import { useKDSWebSocket } from '../_shared/hooks/useKDSWebSocket';
import { PwaLayout } from '../_shared/components/PwaLayout';
import { orderEngine } from '@/core/engine';
import { KDSOrderCard, KDSOrderCardSkeleton } from '@/ui/components/KDSOrderCard';
import { Badge } from '@/ui/components/Badge';
import type { Order, KDSEvent, KDSStatus } from '@/core/types';
import './App.css';

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

// ---- KDS State ----

type AreaFilter = 'all' | 'cocina' | 'bar';

interface KDSState {
  orders: Order[];
  newOrderIds: Set<string>;
  urgentOrderIds: Set<string>;
  audioEnabled: boolean;
  isConnected: boolean;
  areaFilter: AreaFilter;
}

export default function App() {
  setCurrentPwaModule('cocina');
  bootstrapPwa('cocina');

  const [state, setState] = useState<KDSState>({
    orders: [],
    newOrderIds: new Set(),
    urgentOrderIds: new Set(),
    audioEnabled: true,
    isConnected: true,
    areaFilter: 'all',
  });
  const [loading, setLoading] = useState(true);
  const prevOrderIdsRef = useRef<Set<string>>(new Set());
  const loadOrdersRef = useRef<() => void>(() => {});

  // WebSocket — real-time order dispatch + polling fallback.
  const ws = useKDSWebSocket({
    module: 'cocina',
    orderEngine,
    onFallback: () => loadOrdersRef.current(),
  });

  // Load orders from engine
  const loadOrders = useCallback(() => {
    const kdsOrders = orderEngine.getKDSOrders();
    const now = Date.now();

    // Detect new orders
    const currentIds = new Set(kdsOrders.map(o => o.id));
    const prevIds = prevOrderIdsRef.current;
    const newIds = new Set<string>();

    kdsOrders.forEach(order => {
      if (!prevIds.has(order.id)) {
        newIds.add(order.id);
        if (state.audioEnabled) {
          kdsAudio.newOrder();
        }
      }
    });

    // Detect urgent orders (> 15 min)
    const urgentIds = new Set<string>();
    kdsOrders.forEach(order => {
      const elapsed = (now - new Date(order.createdAt).getTime()) / 60000;
      if (elapsed >= 15) {
        urgentIds.add(order.id);
      }
    });

    urgentIds.forEach(id => {
      if (!state.urgentOrderIds.has(id) && state.audioEnabled) {
        kdsAudio.urgent();
      }
    });

    prevOrderIdsRef.current = currentIds;
    setState(prev => ({
      ...prev,
      orders: kdsOrders,
      newOrderIds: newIds,
      urgentOrderIds: urgentIds,
    }));
    setLoading(false);
  }, [state.audioEnabled, state.urgentOrderIds]);

  // Subscribe to engine — keep ref in sync for WebSocket fallback
  loadOrdersRef.current = loadOrders;

  // Keep connection badge in sync with WebSocket state
  useEffect(() => {
    setState(prev =>
      prev.isConnected !== ws.isConnected ? { ...prev, isConnected: ws.isConnected } : prev
    );
  }, [ws.isConnected]);

  // Subscribe to engine
  useEffect(() => {
    loadOrders();
    const unsubscribe = orderEngine.onChange(loadOrders);

    // Polling fallback: only when WebSocket is unavailable/starved.
    let interval: ReturnType<typeof setInterval> | null = null;
    if (ws.shouldFallback) {
      interval = setInterval(loadOrders, 30000);
    }
    return () => {
      unsubscribe();
      if (interval) clearInterval(interval);
    };
  }, [loadOrders, ws.shouldFallback]);

  // Subscribe to KDS events
  useEffect(() => {
    const unsubscribe = orderEngine.onKDSEvent((event: KDSEvent) => {
      if (event.type === 'new_order' && state.audioEnabled) {
        kdsAudio.newOrder();
      }
    });
    return unsubscribe;
  }, [state.audioEnabled]);

  // Handle item status change
  const handleItemStatusChange = useCallback((orderId: string, itemId: string, status: KDSStatus) => {
    const success = orderEngine.updateItemStatus(orderId, itemId, status);
    if (success && status === 'ready') {
      kdsAudio.completed();
    }
  }, []);

  // Handle order acknowledge
  const handleAcknowledge = useCallback((orderId: string) => {
    const order = orderEngine.getOrder(orderId);
    if (order && order.status === 'confirmed') {
      order.items.forEach(item => {
        if (item.status === 'pending') {
          orderEngine.updateItemStatus(orderId, item.id, 'preparing');
        }
      });
      setState(prev => {
        const updated = new Set(prev.newOrderIds);
        updated.delete(orderId);
        return { ...prev, newOrderIds: updated };
      });
    }
  }, []);

  // Handle order reject
  const handleReject = useCallback((orderId: string) => {
    const order = orderEngine.getOrder(orderId);
    if (order) {
      order.items.forEach(item => {
        if (item.status === 'pending') {
          orderEngine.updateItemStatus(orderId, item.id, 'cancelled');
        }
      });
    }
  }, []);

  // Toggle audio
  const toggleAudio = useCallback(() => {
    setState(prev => ({ ...prev, audioEnabled: !prev.audioEnabled }));
  }, []);

  // Filter orders by area
  const filteredOrders = state.areaFilter === 'all'
    ? state.orders
    : state.orders.filter(order =>
        order.items.some(item => {
          // Determine area from item's kds_module or name heuristic
          const module = 'kds_module' in item ? (item as { kds_module?: string }).kds_module : undefined;
          return (module || 'cocina') === state.areaFilter;
        })
      );

  // Sort: urgent first, then by oldest
  const sortedOrders = [...filteredOrders].sort((a, b) => {
    const aUrgent = state.urgentOrderIds.has(a.id);
    const bUrgent = state.urgentOrderIds.has(b.id);
    if (aUrgent && !bUrgent) return -1;
    if (!aUrgent && bUrgent) return 1;
    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  });

  // Count items by area
  const cocinaCount = state.orders.reduce((sum, o) =>
    sum + o.items.filter(i => 'kds_module' in i && (i as { kds_module?: string }).kds_module === 'cocina').length, 0);
  const barCount = state.orders.reduce((sum, o) =>
    sum + o.items.filter(i => 'kds_module' in i && (i as { kds_module?: string }).kds_module === 'bar').length, 0);

  return (
    <PwaLayout title="KDS Unificado">
      <div className="kds-screen">
        {/* Top bar */}
        <header className="kds-header">
          <div className="kds-header__left">
            <h1 className="kds-header__title">KDS Unificado</h1>
            <Badge variant={state.isConnected ? 'ready' : 'cancelled'}>
              {state.isConnected ? 'Conectado' : 'Sin conexión'}
            </Badge>
          </div>
          <div className="kds-header__right">
            {/* Area filter tabs */}
            <div className="kds-header__tabs">
              <button
                className={`kds-header__tab ${state.areaFilter === 'all' ? 'active' : ''}`}
                onClick={() => setState(prev => ({ ...prev, areaFilter: 'all' }))}
              >
                Todos ({state.orders.length})
              </button>
              <button
                className={`kds-header__tab ${state.areaFilter === 'cocina' ? 'active' : ''}`}
                onClick={() => setState(prev => ({ ...prev, areaFilter: 'cocina' }))}
              >
                🍳 Cocina ({cocinaCount})
              </button>
              <button
                className={`kds-header__tab ${state.areaFilter === 'bar' ? 'active' : ''}`}
                onClick={() => setState(prev => ({ ...prev, areaFilter: 'bar' }))}
              >
                🍺 Bar ({barCount})
              </button>
            </div>

            <Badge variant="info" large>
              {filteredOrders.length} pedidos
            </Badge>
            {state.urgentOrderIds.size > 0 && (
              <Badge variant="warning" large>
                {state.urgentOrderIds.size} urgentes
              </Badge>
            )}
            <button
              className={`kds-header__audio-btn ${state.audioEnabled ? 'active' : ''}`}
              onClick={toggleAudio}
              aria-label={state.audioEnabled ? 'Silenciar alertas' : 'Activar alertas'}
            >
              {state.audioEnabled ? '🔊' : '🔇'}
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
            <div className="kds-empty">
              <div className="kds-empty__icon">🍽</div>
              <h2>Todos los pedidos completados</h2>
              <p>Esperando nuevos pedidos...</p>
            </div>
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
                  isUrgent={state.urgentOrderIds.has(order.id)}
                  isNew={state.newOrderIds.has(order.id)}
                  onItemStatusChange={handleItemStatusChange}
                  onAcknowledge={handleAcknowledge}
                  onReject={handleReject}
                  variant="kds"
                />
              ))}
            </div>
          )}
        </main>

        {/* Footer stats */}
        <footer className="kds-footer">
          <span className="kds-footer__stat">
            Activos: {filteredOrders.length}
          </span>
          <span className="kds-footer__stat">
            Urgentes: {state.urgentOrderIds.size}
          </span>
          <span className="kds-footer__stat kds-footer__stat--hint">
            Tap item → cambiar estado
          </span>
        </footer>
      </div>
    </PwaLayout>
  );
}
