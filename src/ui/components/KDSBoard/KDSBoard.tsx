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
import { fetchKDSOrders } from '@/pwa/_shared/api/kdsApi';
import { kdsSetStatus } from '@/pwa/_shared/api/ordersApi';
import { orderEngine } from '@/core/engine';
import { KDSOrderCard, KDSOrderCardSkeleton } from '@/ui/components/KDSOrderCard';
import { Badge } from '@/ui/components/Badge';
import { EmptyState } from '@/ui/components/EmptyState';
import { filterItemsByModule, type KDSModule } from './filter';
import type { Order, KDSEvent } from '@/core/types';
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
  // Capa 2: init honesto en false — antes mentía "Conectado" aunque el WS
  // nunca abriera (el badge se corregía solo tras el primer evento WS).
  const [isConnected, setIsConnected] = useState(false);
  const [loading, setLoading] = useState(true);

  const prevOrderIdsRef = useRef<Set<string>>(new Set());
  const prevUrgentRef = useRef<Set<string>>(new Set());
  const loadOrdersRef = useRef<() => void>(() => {});
  const audioRef = useRef(true);

  audioRef.current = audioEnabled;

  // WebSocket — real-time del módulo (inmediatez) + polling 10s SIEMPRE
  // activo como red de seguridad (ver useEffect de polling abajo).
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

  // Subscribe to engine changes + polling PERIÓDICO SIEMPRE ACTIVO (10s).
  // Capa 1: el WS es el canal de inmediatez, pero puede fallar EN SILENCIO
  // (firewall bloqueando el upgrade, idle-timeout del router sin keep-alive)
  // mientras el badge muestra "Conectado". El poll incondicional trae datos
  // frescos del server cada 10s SIEMPRE — es la red de seguridad que antes
  // solo se activaba tras 5 fallos de conexión (shouldFallback), que no
  // detecta "conectado pero sin mensajes".
  // El flag `fetching` evita solapar requests si uno tarda más de 10s.
  useEffect(() => {
    loadOrders();
    const unsubscribe = orderEngine.onChange(loadOrders);

    let fetching = false;
    const interval = setInterval(async () => {
      if (!token || fetching) return;
      fetching = true;
      try {
        const result = await fetchKDSOrders(token, module);
        if (result.ok) {
          result.orders.forEach(order => orderEngine.importOrder(order));
          // importOrder dispara onChange → loadOrders síncrono; el call
          // explícito cubre cualquier caso sin doble audio (prevOrderIdsRef
          // ya quedó actualizado por la primera invocación).
          loadOrders();
        }
      } catch {
        // Silencioso — el engine conserva el último snapshot; el próximo
        // tick reintenta.
      } finally {
        fetching = false;
      }
    }, 10000);

    return () => {
      unsubscribe();
      clearInterval(interval);
    };
  }, [loadOrders, token, module]);

  // Subscribe to KDS events (audio alerts)
  useEffect(() => {
    const unsubscribe = orderEngine.onKDSEvent((event: KDSEvent) => {
      if (event.type === 'new_order' && audioRef.current) {
        kdsAudio.newOrder();
      }
    });
    return unsubscribe;
  }, []);

  // FASE 4C — Click 1: "▶ Iniciar" → toda la tarjeta (módulo+ronda) a
  // 'preparing'. Optimista en el engine + persistencia server (kds-status).
  const handleStart = useCallback((orderId: string, round: number) => {
    const order = orderEngine.getOrder(orderId);
    if (!order) return;
    // Optimista local: todos los items pending del módulo+ronda → preparing
    order.items
      .filter(i => (i.kds_module || 'cocina') === module && (i.round ?? 1) === round && i.status === 'pending')
      .forEach(i => orderEngine.updateItemStatus(orderId, i.id, 'preparing'));
    setNewOrderIds(prev => {
      const updated = new Set(prev);
      updated.delete(orderId);
      return updated;
    });
    // Persistir + broadcast (el server recalcula status derivado)
    if (token) {
      void kdsSetStatus(token, orderId, { status: 'preparing', module, round }).then(result => {
        if (!result.ok) {
          console.warn(`[KDS] Iniciar persist failed (${orderId} r${round}): ${result.code}`);
        }
      });
    }
  }, [token, module]);

  // FASE 4C — Click 2: "✓ Listo" → toda la tarjeta a 'ready' → llama al
  // mesero (module_ready / order_complete del server).
  const handleReady = useCallback((orderId: string, round: number) => {
    const order = orderEngine.getOrder(orderId);
    if (!order) return;
    order.items
      .filter(i => (i.kds_module || 'cocina') === module && (i.round ?? 1) === round && ['pending', 'preparing'].includes(i.status))
      .forEach(i => orderEngine.updateItemStatus(orderId, i.id, 'ready'));
    if (audioRef.current) kdsAudio.completed();
    if (token) {
      void kdsSetStatus(token, orderId, { status: 'ready', module, round }).then(result => {
        if (!result.ok) {
          console.warn(`[KDS] Listo persist failed (${orderId} r${round}): ${result.code}`);
        }
      });
    }
  }, [token, module, audioRef]);

  // Toggle audio
  const toggleAudio = useCallback(() => {
    setAudioEnabled(prev => !prev);
  }, []);

  // FASE 4B: estado de una tarjeta (derivado de sus items)
  const cardState = useCallback((items: Order['items']) => {
    if (items.some(i => i.status === 'pending')) return 'pending';
    if (items.some(i => i.status === 'preparing')) return 'preparing';
    return 'ready';
  }, []);

  // FASE 4B: dividir cada pedido en TARJETAS POR RONDA (solo rondas con
  // trabajo activo: pending/preparing/ready — las entregadas desaparecen).
  const buildRoundCards = useCallback((orders: Order[]) => {
    const cards: Array<{ order: Order; round: number }> = [];
    for (const order of orders) {
      const moduleItems = order.items.filter(i => (i.kds_module || 'cocina') === module);
      const rounds = [...new Set(moduleItems.map(i => i.round ?? 1))].sort((a, b) => a - b);
      for (const round of rounds) {
        const items = moduleItems.filter(i => (i.round ?? 1) === round);
        const active = items.some(i => ['pending', 'preparing', 'ready'].includes(i.status));
        if (!active) continue;
        cards.push({ order: { ...order, items }, round });
      }
    }
    return cards;
  }, [module]);

  // Prioridad (FASE 4B): urgente primero → no-iniciado (pending) → preparando
  // → listo; dentro del mismo estado, RONDA MÁS ALTA primero (lo nuevo).
  const roundCards = buildRoundCards(orders);
  const sortedCards = [...roundCards].sort((a, b) => {
    const aUrgent = urgentOrderIds.has(a.order.id);
    const bUrgent = urgentOrderIds.has(b.order.id);
    if (aUrgent && !bUrgent) return -1;
    if (!aUrgent && bUrgent) return 1;
    const aState = cardState(a.order.items);
    const bState = cardState(b.order.items);
    const rank = { pending: 1, preparing: 2, ready: 3 } as const;
    if (rank[aState] !== rank[bState]) return rank[aState] - rank[bState];
    if (a.round !== b.round) return b.round - a.round; // ronda nueva primero
    return new Date(a.order.createdAt).getTime() - new Date(b.order.createdAt).getTime();
  });

  return (
    <div className="kds-screen">
      {/* Top bar */}
      <header className="kds-header">
        <div className="kds-header__left">
          <h1 className="kds-header__title">
            <span aria-hidden="true">{icon}</span> {title}
          </h1>
          <Badge variant={isConnected && !ws.shouldFallback ? 'ready' : 'cancelled'}>
            {isConnected && !ws.shouldFallback ? 'Conectado' : 'Sin conexión (polling 10s)'}
          </Badge>
        </div>
        <div className="kds-header__right">
          <Badge variant="info" large>
            {sortedCards.length} pedidos
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

        {!loading && sortedCards.length === 0 && (
          <EmptyState
            icon={icon}
            title="Todos los pedidos completados"
            message="Esperando nuevos pedidos..."
          />
        )}

        {!loading && sortedCards.length > 0 && (
          <div
            className="kds-orders__grid"
            style={{
              gridTemplateColumns: `repeat(${Math.min(sortedCards.length, 4)}, 1fr)`,
            }}
          >
            {sortedCards.map(card => (
              <KDSOrderCard
                key={`${card.order.id}-r${card.round}`}
                order={card.order}
                round={card.round}
                isUrgent={urgentOrderIds.has(card.order.id)}
                isNew={newOrderIds.has(card.order.id)}
                onStart={handleStart}
                onReady={handleReady}
                variant={module}
              />
            ))}
          </div>
        )}
      </main>

      {/* Footer stats */}
      <footer className="kds-footer">
        <span className="kds-footer__stat">
          Activos: {sortedCards.length}
        </span>
        <span className="kds-footer__stat">
          Urgentes: {urgentOrderIds.size}
        </span>
        <span className="kds-footer__stat kds-footer__stat--hint">
          Iniciar → Listo (por pedido)
        </span>
      </footer>
    </div>
  );
}

export default KDSBoard;
