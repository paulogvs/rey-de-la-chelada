/**
 * PrintReceipt — Clean printable receipt overlay.
 *
 * Renders a receipt (order / closing / invoice) into a full-screen overlay
 * with an "Imprimir" button that calls window.print().
 *
 * PRINT CSS (`@media print` in PrintReceipt.css):
 *   - Only the `.print-receipt` area prints; the toolbar + rest of the app
 *     are hidden via `body * { visibility: hidden }` + targeted visibility.
 *   - Thermal 80mm guidance: content width ~72mm, small monospace font.
 *
 * Tokens-based: colors come from CSS variables (theme.js SSOT).
 */

import React, { useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '@/ui/components/Button';
import { ForchiBadge } from '@/ui/components/ForchiBadge';
import {
  formatBs,
  formatReceiptDate,
  DEFAULT_BUSINESS_NAME,
  DEFAULT_THANKS,
} from '../utils/receipt';
import type { ReceiptData, ClosingReceiptData, InvoiceReceiptData } from '../utils/receipt';
import './PrintReceipt.css';

// ============================================================
// Types
// ============================================================

export type PrintKind = 'order' | 'closing' | 'invoice';

export interface PrintReceiptProps {
  open: boolean;
  onClose: () => void;
  kind: PrintKind;
  receipt: ReceiptData | ClosingReceiptData | InvoiceReceiptData;
  /** Optional subtitle shown in the toolbar, e.g. "Pedido 1234" */
  label?: string;
}

// ============================================================
// Body scroll lock while the overlay is open
// ============================================================

function useBodyLock(open: boolean) {
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);
}

// ============================================================
// Receipt content per kind
// ============================================================

function OrderReceiptBody({ receipt }: { receipt: ReceiptData }) {
  return (
    <div className="print-receipt print-receipt--order">
      <div className="print-receipt__header">
        <div className="print-receipt__title">{receipt.businessName || DEFAULT_BUSINESS_NAME}</div>
        <div className="print-receipt__sub">Comprobante de pedido</div>
      </div>

      <div className="print-receipt__meta">
        <div className="print-receipt__meta-row">
          <span>Pedido:</span>
          <span>{receipt.receiptCode || receipt.orderId}</span>
        </div>
        {receipt.tableNumber != null && (
          <div className="print-receipt__meta-row">
            <span>Mesa:</span>
            <span>{receipt.tableNumber}</span>
          </div>
        )}
        <div className="print-receipt__meta-row">
          <span>Fecha:</span>
          <span>{formatReceiptDate(receipt.createdAt)}</span>
        </div>
        {receipt.paymentMethod && (
          <div className="print-receipt__meta-row">
            <span>Pago:</span>
            <span>{receipt.paymentMethod}</span>
          </div>
        )}
      </div>

      <div className="print-receipt__divider" />

      <div className="print-receipt__items">
        {receipt.items.map((item, idx) => (
          <div key={idx} className="print-receipt__item">
            <div className="print-receipt__item-line">
              <span className="print-receipt__item-name">
                {item.quantity} x {item.name}
              </span>
              <span className="print-receipt__item-total">{formatBs(item.lineTotal)}</span>
            </div>
            {item.modifiers && <div className="print-receipt__item-mods">{item.modifiers}</div>}
          </div>
        ))}
      </div>

      <div className="print-receipt__divider" />

      <div className="print-receipt__totals">
        <div className="print-receipt__total-row">
          <span>Subtotal</span>
          <span>{formatBs(receipt.subtotal)}</span>
        </div>
        <div className="print-receipt__total-row">
          <span>IVA (13%)</span>
          <span>{formatBs(receipt.ivaAmount)}</span>
        </div>
        <div className="print-receipt__total-row print-receipt__total-row--grand">
          <span>TOTAL</span>
          <span>{formatBs(receipt.total)}</span>
        </div>
      </div>

      <div className="print-receipt__footer">
        <div>{DEFAULT_THANKS}</div>
        <ForchiBadge />
      </div>
    </div>
  );
}

function ClosingReceiptBody({ receipt }: { receipt: ClosingReceiptData }) {
  const methodRows = Object.entries(receipt.byMethod).filter(([, v]) => v > 0);
  return (
    <div className="print-receipt print-receipt--closing">
      <div className="print-receipt__header">
        <div className="print-receipt__title">{receipt.businessName || DEFAULT_BUSINESS_NAME}</div>
        <div className="print-receipt__sub">Cierre de caja</div>
      </div>

      <div className="print-receipt__meta">
        <div className="print-receipt__meta-row">
          <span>Fecha:</span>
          <span>{formatReceiptDate(receipt.date)}</span>
        </div>
        <div className="print-receipt__meta-row">
          <span>Pedidos:</span>
          <span>{receipt.totalOrders}</span>
        </div>
      </div>

      <div className="print-receipt__divider" />

      <div className="print-receipt__totals">
        <div className="print-receipt__total-row">
          <span>Total ventas</span>
          <span>{formatBs(receipt.totalSales)}</span>
        </div>
        <div className="print-receipt__total-row">
          <span>IVA total</span>
          <span>{formatBs(receipt.totalIva)}</span>
        </div>
        {methodRows.map(([method, amount]) => (
          <div key={method} className="print-receipt__total-row">
            <span>{method}</span>
            <span>{formatBs(amount)}</span>
          </div>
        ))}
      </div>

      <div className="print-receipt__divider" />

      <div className="print-receipt__totals">
        <div className="print-receipt__total-row">
          <span>Efectivo esperado</span>
          <span>{formatBs(receipt.expectedCash)}</span>
        </div>
        <div className="print-receipt__total-row">
          <span>Efectivo real</span>
          <span>{formatBs(receipt.actualCash)}</span>
        </div>
        <div className="print-receipt__total-row">
          <span>Diferencia</span>
          <span>{formatBs(receipt.difference)}</span>
        </div>
        <div className="print-receipt__total-row print-receipt__total-row--grand">
          <span>{receipt.reconciled ? 'Conciliado' : 'SIN CONCILIAR'}</span>
          <span>{receipt.reconciled ? '✓' : '⚠'}</span>
        </div>
      </div>

      {receipt.notes && <div className="print-receipt__notes">Notas: {receipt.notes}</div>}

      <div className="print-receipt__footer">
        <div>{DEFAULT_THANKS}</div>
        <ForchiBadge />
      </div>
    </div>
  );
}

function InvoiceReceiptBody({ receipt }: { receipt: InvoiceReceiptData }) {
  return (
    <div className="print-receipt print-receipt--invoice">
      <div className="print-receipt__header">
        <div className="print-receipt__title">{receipt.businessName || DEFAULT_BUSINESS_NAME}</div>
        <div className="print-receipt__sub">Factura</div>
      </div>

      <div className="print-receipt__meta">
        <div className="print-receipt__meta-row">
          <span>NIT / CI:</span>
          <span>{receipt.nit}</span>
        </div>
        <div className="print-receipt__meta-row">
          <span>Razón Social:</span>
          <span>{receipt.customerName}</span>
        </div>
        <div className="print-receipt__meta-row">
          <span>Pedido:</span>
          <span>{receipt.orderId}</span>
        </div>
        <div className="print-receipt__meta-row">
          <span>Fecha:</span>
          <span>{formatReceiptDate(receipt.date)}</span>
        </div>
      </div>

      <div className="print-receipt__divider" />

      <div className="print-receipt__totals">
        <div className="print-receipt__total-row">
          <span>Subtotal</span>
          <span>{formatBs(Math.round((receipt.amount - receipt.ivaAmount) * 100) / 100)}</span>
        </div>
        <div className="print-receipt__total-row">
          <span>IVA (13%)</span>
          <span>{formatBs(receipt.ivaAmount)}</span>
        </div>
        <div className="print-receipt__total-row print-receipt__total-row--grand">
          <span>TOTAL</span>
          <span>{formatBs(receipt.amount)}</span>
        </div>
      </div>

      <div className="print-receipt__footer">
        <div>{DEFAULT_THANKS}</div>
        <ForchiBadge />
      </div>
    </div>
  );
}

// ============================================================
// Main component
// ============================================================

export function PrintReceipt({ open, onClose, kind, receipt, label }: PrintReceiptProps) {
  useBodyLock(open);

  const handlePrint = useCallback(() => {
    window.print();
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const body =
    kind === 'closing'
      ? <ClosingReceiptBody receipt={receipt as ClosingReceiptData} />
      : kind === 'invoice'
        ? <InvoiceReceiptBody receipt={receipt as InvoiceReceiptData} />
        : <OrderReceiptBody receipt={receipt as ReceiptData} />;

  return createPortal(
    <div className="print-overlay" role="dialog" aria-modal="true" aria-label="Impresión">
      <div className="print-overlay__toolbar">
        <div className="print-overlay__label">{label || 'Impresión'}</div>
        <div className="print-overlay__actions">
          <Button variant="primary" onClick={handlePrint}>
            🖨️ Imprimir
          </Button>
          <Button variant="secondary" onClick={onClose}>
            Cerrar
          </Button>
        </div>
      </div>
      <div className="print-overlay__paper">{body}</div>
    </div>,
    document.body
  );
}

export default PrintReceipt;
