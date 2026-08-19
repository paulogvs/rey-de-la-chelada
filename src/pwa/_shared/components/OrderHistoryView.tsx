import React, { useCallback, useEffect, useState } from 'react';
import { Card } from '@/ui/components/Card';
import { Badge } from '@/ui/components/Badge';
import { Loader } from '@/ui/components/Loader';
import { EmptyState } from '@/ui/components/EmptyState';
import { AppIcon } from '@/ui/components/AppIcon/AppIcon';
import { formatMoney } from '../utils/format';
import { localDateTimeStr } from '../utils/localDate';
import { fetchOrderHistory, type OrderHistoryRow } from '../api/reportsApi';
import './OrderHistoryView.css';

interface OrderHistoryViewProps {
  token: string;
  businessDay: string;
  title?: string;
  refreshTick?: number;
}

export function OrderHistoryView({ token, businessDay, title = 'Pedidos cobrados', refreshTick = 0 }: OrderHistoryViewProps) {
  const [orders, setOrders] = useState<OrderHistoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const result = await fetchOrderHistory(token, businessDay);
    if (result.ok) setOrders(result.orders);
    else setError(result.error || 'No se pudo cargar el historial');
    setLoading(false);
  }, [token, businessDay]);

  useEffect(() => { load(); }, [load, refreshTick]);

  return (
    <section className="order-history">
      <div className="order-history__header">
        <div>
          <h2>{title}</h2>
          <p>Día laboral {businessDay} · pedidos pagados</p>
        </div>
        <button className="order-history__refresh" onClick={load} aria-label="Actualizar historial">
          <AppIcon name="refresh" size="sm" />
        </button>
      </div>
      {loading && <Loader block label="Cargando pedidos…" />}
      {!loading && error && <p className="order-history__error">{error}</p>}
      {!loading && !error && orders.length === 0 && <EmptyState compact icon={<AppIcon name="receipt" size="lg" />} message="No hay pedidos cobrados en este día laboral" />}
      {!loading && !error && orders.length > 0 && (
        <div className="order-history__list">
          {orders.map(order => {
            const expanded = expandedId === order.id;
            const methods = order.payment_summary.map(p => `${p.method === 'cash' ? 'Efectivo' : 'QR'} ${formatMoney(p.total)}`).join(' · ');
            return (
              <Card key={order.id} className={`order-history__card${expanded ? ' order-history__card--expanded' : ''}`}>
                <button className="order-history__row" onClick={() => setExpandedId(expanded ? null : order.id)} aria-expanded={expanded}>
                  <span className="order-history__main">
                    <strong>Mesa {order.table_number ?? '—'}</strong>
                    <span>{localDateTimeStr(new Date(order.created_at))}</span>
                  </span>
                  <span className="order-history__summary">
                    <span>{order.items.reduce((sum, item) => sum + item.quantity, 0)} unidades · {methods || 'Pago registrado'}</span>
                    <strong>{formatMoney(order.total)}</strong>
                  </span>
                  <AppIcon name={expanded ? 'chevron-down' : 'chevron-right'} size="sm" />
                </button>
                {expanded && (
                  <div className="order-history__detail">
                    <div className="order-history__detail-meta">
                      <Badge variant="paid">Pagado</Badge>
                      {order.waiter_name && <span>Mesero: {order.waiter_name}</span>}
                    </div>
                    {order.items.map(item => (
                      <div className="order-history__item" key={item.id}>
                        <span>{item.quantity}x {item.menu_item_name}</span>
                        <strong>{formatMoney(item.subtotal)}</strong>
                        {item.promo_label && <small>{item.promo_label}</small>}
                        {item.notes && <small>{item.notes}</small>}
                      </div>
                    ))}
                    <div className="order-history__payments">
                      <strong>Pagos</strong>
                      {order.payments.filter(p => p.status === 'completed').map(payment => (
                        <span key={payment.id}>
                          {payment.method === 'cash' ? 'Efectivo' : 'QR'}: {formatMoney(payment.amount)}
                          {payment.method === 'cash' && payment.change > 0 ? ` · Vuelto ${formatMoney(payment.change)}` : ''}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </section>
  );
}

export default OrderHistoryView;
