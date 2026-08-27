import React, { useCallback, useEffect, useState } from 'react';
import { Card } from '@/ui/components/Card';
import { Badge } from '@/ui/components/Badge';
import { Loader } from '@/ui/components/Loader';
import { EmptyState } from '@/ui/components/EmptyState';
import { AppIcon } from '@/ui/components/AppIcon/AppIcon';
import { Modal } from '@/ui/components/Modal';
import { useToast } from '@/ui/components/Toast';
import { formatMoney, formatTableRef } from '../utils/format';
import { localDateTimeStr } from '../utils/localDate';
import { loadProofImage } from '../api/paymentsApi';
import { fetchOrderHistory, type OrderHistoryRow, type OrderHistoryPayment } from '../api/reportsApi';
import './OrderHistoryView.css';

interface OrderHistoryViewProps {
  token: string;
  businessDay: string;
  title?: string;
  refreshTick?: number;
}

export function OrderHistoryView({ token, businessDay, title = 'Pedidos cobrados', refreshTick = 0 }: OrderHistoryViewProps) {
  const { addToast } = useToast();
  const [orders, setOrders] = useState<OrderHistoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // MEJORA 2 (2026-08-27): vista previa del comprobante — lightbox modal.
  // Se abre al hacer clic en "Ver comprobante" de un pago QR con `proof_photo`.
  const [previewId, setPreviewId] = useState<{ id: string; alt: string } | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchOrderHistory(token, businessDay);
      if (result.ok) setOrders(result.orders);
      else setError(result.error || 'No se pudo cargar el historial');
    } finally {
      setLoading(false);
    }
  }, [token, businessDay]);

  useEffect(() => { load(); }, [load, refreshTick]);

  // Carga la imagen del comprobante (auth Bearer → fetch + blob + object URL)
  // y la muestra en el lightbox. No hay `<img src>` directo porque el endpoint
  // requiere el header Authorization (no token en query).
  const openProof = useCallback(async (payment: OrderHistoryPayment) => {
    const alt = `Comprobante del pago QR por ${formatMoney(payment.amount)}`;
    setPreviewId({ id: payment.id, alt });
    setPreviewUrl(null);
    setPreviewLoading(true);
    try {
      const url = await loadProofImage(token, payment.id);
      setPreviewUrl(url);
    } catch {
      addToast({ type: 'error', message: 'No se pudo cargar el comprobante', duration: 4000 });
    } finally {
      setPreviewLoading(false);
    }
  }, [token, addToast]);

  const closePreview = useCallback(() => {
    setPreviewUrl(u => { if (u) URL.revokeObjectURL(u); return null; });
    setPreviewId(null);
    setPreviewLoading(false);
  }, []);

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
                    <strong>{formatTableRef(order.table_number)}</strong>
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
                        <div className="order-history__payment" key={payment.id}>
                          <span className="order-history__payment-text">
                            {payment.method === 'cash' ? 'Efectivo' : 'QR'}: {formatMoney(payment.amount)}
                            {payment.method === 'cash' && payment.change > 0 ? ` · Vuelto ${formatMoney(payment.change)}` : ''}
                          </span>
                          {/* MEJORA 2: solo pagos QR con comprobante → botón de vista previa */}
                          {payment.method === 'qr' && payment.proof_photo && (
                            <button type="button" className="order-history__proof-btn"
                              onClick={() => openProof(payment)}
                              aria-label={`Ver comprobante del pago QR ${formatMoney(payment.amount)}`}>
                              <AppIcon name="camera" size="sm" />
                              <span>Ver comprobante</span>
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {/* MEJORA 2: lightbox del comprobante — imagen GRANDE para comparar con la transacción */}
      <Modal open={!!previewId} onClose={closePreview} title="Comprobante de pago">
        {previewUrl ? (
          <div className="order-history__proof-modal">
            <img src={previewUrl} alt={previewId?.alt ?? 'Comprobante de pago'} className="order-history__proof-image" />
            {previewId?.alt && <p className="order-history__proof-alt">{previewId.alt}</p>}
          </div>
        ) : (
          <div className="order-history__proof-loading">
            {previewLoading ? 'Cargando comprobante…' : 'El comprobante no está disponible'}
          </div>
        )}
      </Modal>
    </section>
  );
}

export default OrderHistoryView;
