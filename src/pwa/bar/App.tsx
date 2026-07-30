/**
 * PWA BAR — Bar Display System
 *
 * Similar to KDS but for bar orders
 * Amber accent instead of gold
 * Distinguish bar items from kitchen items
 * Audio alerts, urgency system
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { bootstrapPwa, setCurrentPwaModule } from '../_shared/bootstrap';
import { PwaLayout } from '../_shared/components/PwaLayout';
import { orderEngine } from '@/core/engine';
import { KDSOrderCard, KDSOrderCardSkeleton } from '@/ui/components/KDSOrderCard';
import { Badge } from '@/ui/components/Badge';
import type { Order, KDSEvent, KDSStatus } from '@/core/types';
import { ForchiBadge } from '@/ui/components/ForchiBadge';
import './App.css';

// ---- Bar Audio ----

class BarAudio {
  private ctx: AudioContext | null = null;

  private getContext(): AudioContext {
    if (!this.ctx) this.ctx = new AudioContext();
    return this.ctx;
  }

  private beep(freq: number, dur: number) {
    try {
      const ctx = this.getContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.value = 0.12;
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + dur);
    } catch { /* ignore */ }
  }

  newOrder() {
    this.beep(660, 0.15);
    setTimeout(() => this.beep(880, 0.2), 150);
  }

  urgent() {
    this.beep(440, 0.4, 'square');
  }
}

const barAudio = new BarAudio();

export default function App() {
  setCurrentPwaModule('bar');
  bootstrapPwa('bar');

  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [audioEnabled, setAudioEnabled] = useState(true);
  const [urgentIds, setUrgentIds] = useState<Set<string>>(new Set());
  const prevIdsRef = useRef<Set<string>>(new Set());

  const loadOrders = useCallback(() => {
    const all = orderEngine.getKDSOrders();
    const now = Date.now();
    const currentIds = new Set(all.map(o => o.id));
    const prevIds = prevIdsRef.current;

    // Detect new
    all.forEach(o => {
      if (!prevIds.has(o.id) && audioEnabled) {
        barAudio.newOrder();
      }
    });

    // Detect urgent (> 15 min)
    const urgent = new Set<string>();
    all.forEach(o => {
      const elapsed = (now - new Date(o.createdAt).getTime()) / 60000;
      if (elapsed >= 15) urgent.add(o.id);
    });

    // Play urgent alert for new urgent orders
    urgent.forEach(id => {
      if (!urgentIds.has(id) && audioEnabled) barAudio.urgent();
    });

    prevIdsRef.current = currentIds;
    setOrders(all);
    setUrgentIds(urgent);
    setLoading(false);
  }, [audioEnabled, urgentIds]);

  useEffect(() => {
    loadOrders();
    const unsub = orderEngine.onChange(loadOrders);
    const interval = setInterval(loadOrders, 30000);
    return () => { unsub(); clearInterval(interval); };
  }, [loadOrders]);

  useEffect(() => {
    return orderEngine.onKDSEvent((event: KDSEvent) => {
      if (event.type === 'new_order' && audioEnabled) barAudio.newOrder();
    });
  }, [audioEnabled]);

  const handleItemStatusChange = useCallback((orderId: string, itemId: string, status: KDSStatus) => {
    orderEngine.updateItemStatus(orderId, itemId, status);
  }, []);

  const handleAcknowledge = useCallback((orderId: string) => {
    const order = orderEngine.getOrder(orderId);
    if (order && order.status === 'confirmed') {
      order.items.forEach(item => {
        if (item.status === 'pending') orderEngine.updateItemStatus(orderId, item.id, 'preparing');
      });
    }
  }, []);

  const handleReject = useCallback((orderId: string) => {
    const order = orderEngine.getOrder(orderId);
    if (order) {
      order.items.forEach(item => {
        if (item.status === 'pending') orderEngine.updateItemStatus(orderId, item.id, 'cancelled');
      });
    }
  }, []);

  const sortedOrders = [...orders].sort((a, b) => {
    const aU = urgentIds.has(a.id);
    const bU = urgentIds.has(b.id);
    if (aU && !bU) return -1;
    if (!aU && bU) return 1;
    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  });

  return (
    <PwaLayout title="Bar">
      <div className="bar-screen">
        <header className="bar-header">
          <div className="bar-header__left">
            <h1>🍺 Barra</h1>
            <Badge variant="info">{orders.length} pedidos</Badge>
          </div>
          <div className="bar-header__right">
            {urgentIds.size > 0 && (
              <Badge variant="warning">{urgentIds.size} urgentes</Badge>
            )}
            <button
              className="bar-header__audio"
              onClick={() => setAudioEnabled(!audioEnabled)}
            >
              {audioEnabled ? '🔊' : '🔇'}
            </button>
          </div>
        </header>

        <main className="bar-orders">
          {loading && (
            <div className="bar-orders__grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
              {[1, 2, 3].map(i => <KDSOrderCardSkeleton key={i} />)}
            </div>
          )}

          {!loading && sortedOrders.length === 0 && (
            <div className="bar-empty">
              <div className="bar-empty__icon">🍻</div>
              <h2>Todos servidos</h2>
              <p>Esperando órdenes de barra...</p>
            </div>
          )}

          {!loading && sortedOrders.length > 0 && (
            <div
              className="bar-orders__grid"
              style={{
                gridTemplateColumns: `repeat(${Math.min(sortedOrders.length, 3)}, 1fr)`,
              }}
            >
              {sortedOrders.map(order => (
                <KDSOrderCard
                  key={order.id}
                  order={order}
                  isUrgent={urgentIds.has(order.id)}
                  isNew={false}
                  onItemStatusChange={handleItemStatusChange}
                  onAcknowledge={handleAcknowledge}
                  onReject={handleReject}
                  variant="bar"
                />
              ))}
            </div>
          )}
        </main>

        <footer className="bar-footer">
          <span>Pedidos: {orders.length}</span>
          <span>Urgentes: {urgentIds.size}</span>
          <span className="bar-footer__hint">Tap item → cambiar estado</span>
        </footer>
      </div>
    </PwaLayout>
  );
}
