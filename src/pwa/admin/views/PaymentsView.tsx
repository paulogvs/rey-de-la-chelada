import React, { useCallback, useEffect, useState } from 'react';
import { Card } from '@/ui/components/Card';
import { Badge } from '@/ui/components/Badge';
import { Button } from '@/ui/components/Button';
import { Loader } from '@/ui/components/Loader';
import { fetchPaymentProof, fetchPayments, type PaymentProofMetadata, type ServerPayment } from '../../_shared/api/paymentsApi';
import { formatMoney } from '../../_shared/utils/format';

export function PaymentsView({ token, onToast }: { token: string; onToast: (type: 'success' | 'error' | 'warning', message: string) => void }) {
  const [payments, setPayments] = useState<ServerPayment[]>([]);
  const [proofs, setProofs] = useState<Record<string, PaymentProofMetadata | null>>({});
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await fetchPayments(token);
      if (!result.ok) onToast('error', result.error || 'No se pudieron cargar los pagos');
      setPayments(result.payments);
    } finally {
      setLoading(false);
    }
  }, [token, onToast]);

  useEffect(() => { load(); }, [load]);

  const loadProof = async (paymentId: string) => {
    const result = await fetchPaymentProof(token, paymentId);
    if (result.ok) setProofs(current => ({ ...current, [paymentId]: result.data?.proof ?? null }));
    else setProofs(current => ({ ...current, [paymentId]: null }));
  };

  return (
    <div className="admin-view">
      <div className="admin-toolbar"><Badge variant="info">{payments.length} pago(s)</Badge><Button variant="secondary" size="sm" onClick={load} loading={loading}>Refrescar</Button></div>
      <Card className="admin-section">
        {loading ? <Loader label="Cargando pagos…" /> : payments.length === 0 ? <p className="admin-muted">No hay pagos registrados.</p> : payments.map(payment => (
          <div key={payment.id} className="admin-closing-row">
            <div className="admin-closing-row__head"><strong>{payment.method === 'cash' ? 'Efectivo' : 'QR'}</strong><Badge variant={payment.status === 'completed' ? 'paid' : 'pending'}>{payment.status}</Badge></div>
            <div className="admin-closing-row__nums"><span>{formatMoney(payment.amount)}</span><span>Pedido {payment.order_id.slice(0, 8)}</span>{payment.reference && <span>Ref. {payment.reference}</span>}</div>
            {payment.method === 'qr' && <>
              <Button variant="secondary" size="sm" onClick={() => loadProof(payment.id)}>Ver metadata proof</Button>
              {proofs[payment.id] && <div className="admin-closing-row__meta">{proofs[payment.id]?.mime} · {proofs[payment.id]?.size} bytes · {proofs[payment.id]?.status} · SHA-256 {proofs[payment.id]?.hash}</div>}
              {proofs[payment.id] === null && <div className="admin-closing-row__meta">Sin comprobante registrado.</div>}
            </>}
          </div>
        ))}
      </Card>
    </div>
  );
}
