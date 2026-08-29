/**
 * Caja — CollectView (S2-C): pedidos pendientes de cobro
 *
 * v14 (2026-08-28) Opción A: la caja reutiliza el MISMO PaymentPanel que
 * Meseros (pago + cambio editable efectivo/QR con regla simple). Antes tenía
 * su propio formulario de métodos (más simple, sin gestión de cambio) — ahora
 * un solo modelo de cobro para toda la app.
 *
 * La lista de pedidos pendientes (GET /api/orders?pending=1) muestras mesas,
 * estado, items y saldo. Al pulsar "Cobrar" se abre el PaymentPanel con el
 * pedido seleccionado.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { fetchPendingOrders, type Order } from '../_shared/api/ordersApi';
import { PaymentPanel } from '../meseros/PaymentPanel';
import type { Table } from '@/core/types';
import { Card } from '@/ui/components/Card';
import { Button } from '@/ui/components/Button';
import { Badge } from '@/ui/components/Badge';
import { Loader } from '@/ui/components/Loader';
import { EmptyState } from '@/ui/components/EmptyState';
import { PriceDisplay } from '@/ui/components/PriceDisplay';
import { AppIcon } from '@/ui/components/AppIcon/AppIcon';
import { formatMoney } from '../_shared/utils/format';
import './CollectView.css';

interface CollectViewProps {
  token: string;
  refreshTick: number;
  /** Se llama tras un cobro completo (para que App refresque todo) */
  onPaid: (orderId: string) => void;
}

const STATUS_LABELS: Record<string, string> = {
  called: 'Enviado',
  confirmed: 'Confirmado',
  preparing: 'En preparación',
  ready: 'Listo',
  served: 'Servido',
};

const STATUS_VARIANTS: Record<string, 'pending' | 'preparing' | 'ready' | 'paid' | 'info'> = {
  called: 'pending',
  confirmed: 'pending',
  preparing: 'preparing',
  ready: 'ready',
  served: 'paid',
};

/** Saldo pendiente de un pedido (total − pagos completed). SSOT server. */
export function orderRemaining(order: Order): number {
  return Math.max(0, order.total - order.paidAmount); // v11: centavos exactos
}

export function CollectView({ token, refreshTick, onPaid }: CollectViewProps) {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  // v14 (2026-08-28): Opción A — Caja reutiliza el PaymentPanel de Meseros
  // (misma modalidad de cobro: pago + cambio editable efectivo/QR).
  const [payingOrderId, setPayingOrderId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await fetchPendingOrders(token);
      if (!result.ok) {
        setError(result.error || 'No se pudieron cargar los pedidos pendientes');
        return;
      }
      setOrders(result.orders);
      setError(null);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load, refreshTick]);

  const pendingTotal = orders.reduce((sum, o) => sum + orderRemaining(o), 0);

  const handlePaid = useCallback(
    (orderId: string) => {
      setPayingOrderId(null);
      load();
      onPaid(orderId);
    },
    [load, onPaid]
  );

  if (loading && orders.length === 0) {
    return (
      <div className="caja-collect">
        <Loader variant="block" label="Cargando pedidos pendientes…" />
      </div>
    );
  }

  return (
    <div className="caja-collect">
      {/* Resumen */}
      <Card className="caja-collect__summary">
        <div className="caja-collect__summary-label">
          {orders.length === 0
            ? 'Sin pedidos pendientes'
            : `${orders.length} pedido${orders.length === 1 ? '' : 's'} pendiente${orders.length === 1 ? '' : 's'} de cobro`}
        </div>
        <div className="caja-collect__summary-value">
          {orders.length === 0 ? <AppIcon name="check" size="md" /> : formatMoney(pendingTotal)}
        </div>
      </Card>

      {error && (
        <Card className="caja-collect__error">
          <p>{error}</p>
          <Button variant="secondary" size="sm" onClick={load}>Reintentar</Button>
        </Card>
      )}

      {!error && orders.length === 0 && (
        <EmptyState
          icon={<AppIcon name="wallet" size="lg" />}
          message="No hay pedidos esperando cobro. Los pedidos servidos o en preparación aparecerán aquí."
        />
      )}

      <div className="caja-collect__list">
        {orders.map(order => {
          const remaining = orderRemaining(order);
          const isExpanded = expandedId === order.id;
          return (
            <Card key={order.id} padded={false} className="caja-collect__order">
              <button
                className="caja-collect__order-head"
                onClick={() => setExpandedId(isExpanded ? null : order.id)}
                aria-expanded={isExpanded}
              >
                <span className="caja-collect__order-table">Mesa {order.tableNumber}</span>
                <Badge variant={STATUS_VARIANTS[order.status] ?? 'info'}>
                  {STATUS_LABELS[order.status] ?? order.status}
                </Badge>
                <span className="caja-collect__order-items">
                  {order.items.reduce((n, i) => n + i.quantity, 0)} items
                </span>
                <span className="caja-collect__order-amount">
                  {formatMoney(remaining)}
                </span>
                <span className="caja-collect__order-caret" aria-hidden="true">
                  {isExpanded ? <AppIcon name="chevron-up" size="sm" /> : <AppIcon name="chevron-down" size="sm" />}
                </span>
              </button>

              {isExpanded && (
                <div className="caja-collect__order-detail">
                  <div className="caja-collect__order-items-list">
                    {order.items.map(item => (
                      <div key={item.id} className="caja-collect__item">
                        <span className="caja-collect__item-qty">{item.quantity}x</span>
                        <span className="caja-collect__item-name">{item.menuItemName}</span>
                        <span className="caja-collect__item-price">{formatMoney(item.subtotal)}</span>
                      </div>
                    ))}
                  </div>

                  <PriceDisplay
                    priceWithIVA={order.total}
                    showBreakdown
                    className="caja-collect__order-total"
                  />
                  {order.paidAmount > 0 && (
                    <p className="caja-collect__paid-hint">
                      Ya cobrado: {formatMoney(order.paidAmount)} · Saldo: {formatMoney(remaining)}
                    </p>
                  )}

                  {/* Cobro — v14 Opción A: Caja usa el PaymentPanel de Meseros */}
                  <div className="caja-collect__pay">
                    <Button variant="primary" fullWidth onClick={() => setPayingOrderId(order.id)}>
                      Cobrar {formatMoney(remaining)}
                    </Button>
                  </div>
                </div>
              )}
            </Card>
          );
        })}
      </div>

      {/* v14 Opción A: el mismo PaymentPanel de Meseros (cambio editable) */}
      {payingOrderId && orders.some(o => o.id === payingOrderId) && (
        (() => {
          const ord = orders.find(o => o.id === payingOrderId)!;
          const table = {
            id: ord.tableId,
            number: ord.tableNumber,
            capacity: 0,
            status: 'occupied' as const,
          } as Table;
          return (
            <div className="caja-collect__payment-modal">
              <PaymentPanel
                orderId={payingOrderId}
                table={table}
                token={token}
                onPaymentComplete={() => handlePaid(payingOrderId)}
                onBack={() => setPayingOrderId(null)}
              />
            </div>
          );
        })()
      )}
    </div>
  );
}

export default CollectView;