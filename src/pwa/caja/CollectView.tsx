/**
 * Caja — CollectView (S2-C): pedidos pendientes de cobro
 *
 * Flujo primario, última milla: la caja ve los pedidos servidos/activos
 * que esperan cobro, revisa su detalle y cobra con POST /api/payments
 * (mismo contrato que meseros: { order_id, amount, method, received }).
 * FASE 3: sin propina; efectivo con received/change (vuelto al centavo).
 * El server libera la mesa al pagar completo (payments.js processPayment).
 *
 * Datos (SSOT server): GET /api/orders?pending=1 → orders con total,
 * paid_amount e items. La lista se refresca con refreshTick (WS S2-D).
 */

import React, { useState, useEffect, useCallback } from 'react';
import { fetchPendingOrders, type Order } from '../_shared/api/ordersApi';
import { processPayment } from '../_shared/api/paymentsApi';
import { Card } from '@/ui/components/Card';
import { Button } from '@/ui/components/Button';
import { Badge } from '@/ui/components/Badge';
import { Loader } from '@/ui/components/Loader';
import { EmptyState } from '@/ui/components/EmptyState';
import { PriceDisplay } from '@/ui/components/PriceDisplay';
import { SegmentedControl, type SegmentedOption } from '@/ui/components/SegmentedControl';
import { useToast } from '@/ui/components/Toast';
import { METHOD_LABELS, METHOD_ICONS, PAYMENT_METHODS } from '../_shared/utils/paymentMethods';
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

/** Método de pago como opciones del SegmentedControl (Premium Minimal). */
const PAYMENT_OPTIONS: SegmentedOption[] = PAYMENT_METHODS.map(m => ({
  value: m,
  label: `${METHOD_ICONS[m]} ${METHOD_LABELS[m]}`,
}));

/** Saldo pendiente de un pedido (total − pagos completed). SSOT server. */
export function orderRemaining(order: Order): number {
  return Math.max(0, Math.round((order.total - order.paidAmount) * 100) / 100);
}

export function CollectView({ token, refreshTick, onPaid }: CollectViewProps) {
  const { addToast } = useToast();

  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [method, setMethod] = useState<(typeof PAYMENT_METHODS)[number]>('cash');
  const [received, setReceived] = useState(0);
  const [paying, setPaying] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const result = await fetchPendingOrders(token);
    if (!result.ok) {
      setError(result.error || 'No se pudieron cargar los pedidos pendientes');
      setLoading(false);
      return;
    }
    setOrders(result.orders);
    setError(null);
    setLoading(false);
  }, [token]);

  useEffect(() => {
    load();
  }, [load, refreshTick]);

  const pendingTotal = orders.reduce((sum, o) => sum + orderRemaining(o), 0);

  const handlePay = useCallback(
    async (order: Order) => {
      setPaying(true);
      try {
        const remaining = orderRemaining(order);
        if (remaining <= 0) {
          addToast({ type: 'warning', message: 'El pedido ya está cubierto', duration: 3000 });
          return;
        }
        const result = await processPayment(token, {
          order_id: order.id,
          amount: remaining,
          method,
          received: method === 'cash' && received > 0 ? received : undefined,
        });
        if (!result.ok) {
          addToast({ type: 'error', message: result.error || 'Error al procesar el pago', duration: 5000 });
          return;
        }
        if (result.fullyPaid) {
          addToast({
            type: 'success',
            message: `Mesa ${order.tableNumber} cobrada ✓`,
            duration: 3000,
          });
          onPaid(order.id);
          setExpandedId(null);
        } else {
          addToast({
            type: 'info',
            message: `Pago parcial — restante Bs. ${result.remaining.toFixed(2)}`,
            duration: 3000,
          });
        }
        load();
      } catch (err) {
        console.error('[CollectView] pay error:', err);
        addToast({ type: 'error', message: 'Error al procesar el pago', duration: 5000 });
      } finally {
        setPaying(false);
      }
    },
    [token, method, received, addToast, onPaid, load]
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
          {orders.length === 0 ? '🎉' : `Bs. ${pendingTotal.toFixed(2)}`}
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
          icon="💰"
          message="No hay pedidos esperando cobro. Los pedidos servidos o en preparación aparecerán aquí."
        />
      )}

      <div className="caja-collect__list">
        {orders.map(order => {
          const remaining = orderRemaining(order);
          const isExpanded = expandedId === order.id;
          const change = method === 'cash' && received > remaining
            ? Math.round((received - remaining) * 100) / 100
            : 0;
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
                  Bs. {remaining.toFixed(2)}
                </span>
                <span className="caja-collect__order-caret" aria-hidden="true">
                  {isExpanded ? '▴' : '▾'}
                </span>
              </button>

              {isExpanded && (
                <div className="caja-collect__order-detail">
                  <div className="caja-collect__order-items-list">
                    {order.items.map(item => (
                      <div key={item.id} className="caja-collect__item">
                        <span className="caja-collect__item-qty">{item.quantity}x</span>
                        <span className="caja-collect__item-name">{item.menuItemName}</span>
                        <span className="caja-collect__item-price">Bs. {item.subtotal.toFixed(2)}</span>
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
                      Ya cobrado: Bs. {order.paidAmount.toFixed(2)} · Saldo: Bs. {remaining.toFixed(2)}
                    </p>
                  )}

                  {/* Cobro */}
                  <div className="caja-collect__pay">
                    <div className="caja-collect__pay-field">
                      <span className="caja-collect__pay-label" id={`method-label-${order.id}`}>Método</span>
                      <SegmentedControl
                        className="caja-collect__pay-method"
                        options={PAYMENT_OPTIONS}
                        value={method}
                        onChange={v => setMethod(v as (typeof PAYMENT_METHODS)[number])}
                      />
                    </div>

                    {method === 'cash' && (
                      <div className="caja-collect__pay-field">
                        <label htmlFor={`received-${order.id}`}>Efectivo recibido</label>
                        <input
                          id={`received-${order.id}`}
                          type="number"
                          className="caja-collect__received"
                          value={received || ''}
                          min={remaining}
                          step={0.01}
                          placeholder="Bs."
                          onChange={e => setReceived(parseFloat(e.target.value) || 0)}
                        />
                        {change > 0 && (
                          <p className="caja-collect__change">
                            Cambio: <strong>Bs. {change.toFixed(2)}</strong>
                          </p>
                        )}
                      </div>
                    )}

                    <Button
                      variant="primary"
                      fullWidth
                      loading={paying}
                      disabled={paying}
                      onClick={() => handlePay(order)}
                    >
                      Cobrar Bs. {remaining.toFixed(2)}
                    </Button>
                  </div>
                </div>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}

export default CollectView;
