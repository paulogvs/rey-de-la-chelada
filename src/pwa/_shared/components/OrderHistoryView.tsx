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
import { loadProofImage, fetchPaymentProof } from '../api/paymentsApi';
import { InvoiceModal } from './InvoiceModal';
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

  // MEJORA 2 (2026-08-27) + v14 (2026-08-29): vista previa de comprobantes.
  // Ahora soporta VARIOS comprobantes por pago QR (lightbox con navegación).
  const [previewId, setPreviewId] = useState<{ id: string; alt: string } | null>(null);
  const [previewUrls, setPreviewUrls] = useState<string[]>([]);
  const [previewIndex, setPreviewIndex] = useState(0);
  const [previewLoading, setPreviewLoading] = useState(false);

  // v14 (2026-08-28): factura — pedido seleccionado para emitir factura.
  const [invoiceOrder, setInvoiceOrder] = useState<OrderHistoryRow | null>(null);

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

  // Carga TODOS los comprobantes del pago QR (auth Bearer → fetch + blob) y
  // los muestra en un lightbox con navegación ‹ ›.
  const openProof = useCallback(async (payment: OrderHistoryPayment) => {
    const alt = `Comprobante del pago QR por ${formatMoney(payment.amount)}`;
    setPreviewId({ id: payment.id, alt });
    setPreviewIndex(0);
    setPreviewLoading(true);
    try {
      const result = await fetchPaymentProof(token, payment.id);
      const proofList = result.ok && Array.isArray(result.data?.proofs) && result.data.proofs.length > 0
        ? result.data.proofs
        : (result.ok && result.data?.proof ? [result.data.proof] : []);
      const urls: string[] = [];
      for (const proof of proofList) {
        try {
          const url = await loadProofImage(token, payment.id, undefined, undefined, proof.id);
          urls.push(url);
        } catch { /* saltar los que no carguen */ }
      }
      if (urls.length === 0) {
        addToast({ type: 'error', message: 'No se pudo cargar ningún comprobante', duration: 4000 });
      }
      setPreviewUrls(urls);
    } catch {
      addToast({ type: 'error', message: 'No se pudieron cargar los comprobantes', duration: 4000 });
    } finally {
      setPreviewLoading(false);
    }
  }, [token, addToast]);

  const closePreview = useCallback(() => {
    setPreviewUrls(prev => { prev.forEach(u => URL.revokeObjectURL(u)); return []; });
    setPreviewId(null);
    setPreviewIndex(0);
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
                      <button
                        type="button"
                        className="order-history__invoice-btn"
                        onClick={() => setInvoiceOrder(order)}
                        title="Emitir factura de este pedido"
                      >
                        <AppIcon name="receipt" size="sm" /> Emitir factura
                      </button>
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
                              aria-label={`Ver comprobantes del pago QR ${formatMoney(payment.amount)}`}>
                              <AppIcon name="camera" size="sm" />
                              <span>Ver comprobantes</span>
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

      {/* MEJORA 2 + v14: lightbox de comprobantes — navegación entre TODOS */}
      <Modal open={!!previewId} onClose={closePreview} title="Comprobantes de pago QR">
        {previewLoading ? (
          <div className="order-history__proof-loading">Cargando comprobantes…</div>
        ) : previewUrls.length === 0 ? (
          <div className="order-history__proof-loading">El comprobante no está disponible</div>
        ) : (
          <div className="order-history__proof-modal">
            <img src={previewUrls[previewIndex] ?? ''} alt={previewId?.alt ?? 'Comprobante de pago'} className="order-history__proof-image" />
            {previewId?.alt && <p className="order-history__proof-alt">{previewId.alt}</p>}
            {previewUrls.length > 1 && (
              <div className="order-history__proof-nav">
                <button type="button" className="order-history__proof-nav-btn"
                  onClick={() => setPreviewIndex(i => (i - 1 + previewUrls.length) % previewUrls.length)}
                  aria-label="Comprobante anterior">
                  ‹ Anterior
                </button>
                <span className="order-history__proof-counter">
                  {previewIndex + 1} de {previewUrls.length}
                </span>
                <button type="button" className="order-history__proof-nav-btn"
                  onClick={() => setPreviewIndex(i => (i + 1) % previewUrls.length)}
                  aria-label="Comprobante siguiente">
                  Siguiente ›
                </button>
              </div>
            )}
          </div>
        )}
      </Modal>
      {/* v14: modal de factura — monto/items del pedido, solo pide NIT + Razón Social */}
      {invoiceOrder && (
        <InvoiceModal
          open={!!invoiceOrder}
          onClose={() => setInvoiceOrder(null)}
          token={token}
          order={invoiceOrder}
          onToast={(type, message) => addToast({ type, message, duration: 4000 })}
        />
      )}
    </section>
  );
}

export default OrderHistoryView;
