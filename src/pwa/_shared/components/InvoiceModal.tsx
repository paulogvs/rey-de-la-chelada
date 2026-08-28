/**
 * InvoiceModal — Emitir factura de un pedido (v14 2026-08-28).
 *
 * Reemplaza el stub manual de InvoiceView (que pedía ID del pedido escrito a
 * mano). El monto e items salen del pedido seleccionado (server); solo pide
 * NIT + Razón Social del cliente. Un solo botón "Imprimir".
 */

import React, { useState, useCallback, useEffect } from 'react';
import { Button } from '@/ui/components/Button';
import { FormField } from '@/ui/components/FormField';
import { Modal } from '@/ui/components/Modal';
import { AppIcon } from '@/ui/components/AppIcon/AppIcon';
import { formatMoney, formatTableRef } from '../utils/format';
import { printInvoice } from '../api/printApi';

interface InvoiceModalProps {
  open: boolean;
  onClose: () => void;
  token: string;
  order: {
    id: string;
    table_number?: number | null;
    created_at: string;
    total: number;
    subtotal?: number;
    iva_amount?: number;
  } | null;
  onToast: (type: 'success' | 'error' | 'warning', message: string) => void;
}

export function InvoiceModal({ open, onClose, token, order, onToast }: InvoiceModalProps) {
  const [nit, setNit] = useState('');
  const [name, setName] = useState('');
  const [printing, setPrinting] = useState(false);

  // Resetear el form al abrir con un pedido nuevo
  useEffect(() => {
    if (open) {
      setNit('');
      setName('');
    }
  }, [open, order?.id]);

  const handlePrint = useCallback(async () => {
    if (!order) return;
    if (!nit.trim() || !name.trim()) {
      onToast('warning', 'Completa NIT y Razón Social');
      return;
    }
    setPrinting(true);
    try {
      const result = await printInvoice(token, order.id, nit.trim(), name.trim());
      if (result.ok) {
        onToast('success', 'Factura impresa');
        onClose();
      } else {
        onToast('error', result.error || 'No se pudo imprimir la factura');
      }
    } finally {
      setPrinting(false);
    }
  }, [order, nit, name, token, onToast, onClose]);

  if (!order) return null;

  return (
    <Modal open={open} onClose={onClose} title="Emitir Factura">
      <div className="invoice-modal">
        <p className="invoice-modal__order">
          <strong>{formatTableRef(order.table_number)}</strong> · Pedido {order.id.slice(-8)} ·{' '}
          {formatMoney(order.total)}
        </p>

        <div className="invoice-modal__fields">
          <FormField
            label="NIT / CI"
            variant="lg"
            value={nit}
            onChange={e => setNit(e.target.value)}
            placeholder="Ej: 1234567890"
          />
          <FormField
            label="Razón Social / Nombre"
            variant="lg"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Nombre completo o razón social"
          />
        </div>

        <div className="invoice-modal__summary">
          {order.subtotal != null && <div><span>Subtotal</span><span>{formatMoney(order.subtotal)}</span></div>}
          {order.iva_amount != null && <div><span>IVA</span><span>{formatMoney(order.iva_amount)}</span></div>}
          <div className="invoice-modal__total"><span>Total</span><span>{formatMoney(order.total)}</span></div>
        </div>

        <div className="invoice-modal__actions">
          <Button variant="secondary" onClick={onClose} disabled={printing}>Cancelar</Button>
          <Button variant="primary" onClick={handlePrint} loading={printing} disabled={printing}>
            <AppIcon name="printer" size="sm" /> Imprimir factura
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export default InvoiceModal;