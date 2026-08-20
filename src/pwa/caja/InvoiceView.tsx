/**
 * Caja — InvoiceView (SFE-ready stub)
 *
 * Generates a manual invoice record. SFE (SIN Bolivia) integration is
 * config-driven (appConfig.invoicing) — when disabled, acts as a manual stub.
 */

import React, { useState, useCallback } from 'react';
import { appConfig } from '@/core/config';
import { Card } from '@/ui/components/Card';
import { Button } from '@/ui/components/Button';
import { FormField } from '@/ui/components/FormField';
import { MoneyInput } from '@/ui/components/MoneyInput/MoneyInput';
import { useToast } from '@/ui/components/Toast';
import { AppIcon } from '@/ui/components/AppIcon/AppIcon';
import { PrintReceipt } from '../_shared/components/PrintReceipt';
import { formatMoney } from '../_shared/utils/format';

export function InvoiceView() {
  const { addToast } = useToast();
  const config = appConfig.all;

  const [invoiceNit, setInvoiceNit] = useState('');
  const [invoiceName, setInvoiceName] = useState('');
  const [invoiceOrderId, setInvoiceOrderId] = useState('');
  const [invoiceAmount, setInvoiceAmount] = useState(0);
  const [printOpen, setPrintOpen] = useState(false);
  const [printData, setPrintData] = useState<{ nit: string; name: string; orderId: string; amount: number } | null>(null);

  const handleGenerateInvoice = useCallback(() => {
    if (!invoiceNit || !invoiceName || invoiceAmount <= 0) {
      addToast({ type: 'warning', message: 'Completa NIT, Razón Social y monto', duration: 3000 });
      return;
    }

    addToast({
      type: 'success',
      message: `Factura generada: ${invoiceNit} — ${formatMoney(invoiceAmount)}`,
      duration: 4000,
    });
  }, [invoiceNit, invoiceName, invoiceAmount, addToast]);

  const handlePrintInvoice = useCallback(() => {
    if (!invoiceNit || !invoiceName || invoiceAmount <= 0) {
      addToast({ type: 'warning', message: 'Completa NIT, Razón Social y monto', duration: 3000 });
      return;
    }
    setPrintData({ nit: invoiceNit, name: invoiceName, orderId: invoiceOrderId, amount: invoiceAmount });
    setPrintOpen(true);
  }, [invoiceNit, invoiceName, invoiceOrderId, invoiceAmount, addToast]);

  return (
    <div className="caja-invoice">
      <Card className="caja-invoice__card">
        <h3>Generar Factura</h3>
        <p className="caja-invoice__info">
          {config.invoicing.enabled
            ? 'Sistema de Facturación Electrónica (SFE) conectado'
            : 'Factura manual — SIN no configurado'}
        </p>

        <div className="caja-invoice__fields">
          <div className="caja-invoice__field">
            <label>NIT / CI</label>
            <FormField
              type="text"
              variant="lg"
              value={invoiceNit}
              onChange={e => setInvoiceNit(e.target.value)}
              placeholder="Ej: 1234567890"
            />
          </div>

          <div className="caja-invoice__field">
            <label>Razón Social / Nombre</label>
            <FormField
              type="text"
              variant="lg"
              value={invoiceName}
              onChange={e => setInvoiceName(e.target.value)}
              placeholder="Nombre completo o razón social"
            />
          </div>

          <div className="caja-invoice__field">
            <label>Nº de Pedido</label>
            <FormField
              type="text"
              variant="lg"
              value={invoiceOrderId}
              onChange={e => setInvoiceOrderId(e.target.value)}
              placeholder="ID del pedido"
            />
          </div>

          <div className="caja-invoice__field">
            <label>Monto (Bs)</label>
            <MoneyInput
              variant="lg"
              className="form-input--mono"
              value={invoiceAmount}
              onChange={setInvoiceAmount}
              placeholder="0,00"
            />
          </div>
        </div>

        <div className="caja-invoice__actions">
          <Button variant="secondary" onClick={handlePrintInvoice} fullWidth>
            <AppIcon name="printer" size="sm" /> Imprimir factura
          </Button>
          <Button variant="primary" onClick={handleGenerateInvoice} fullWidth>
            Generar Factura
          </Button>
        </div>

        {config.invoicing.enabled && (
          <div className="caja-invoice__sfe">
            <h4>Datos SFE</h4>
            <div className="caja-invoice__sfe-row">
              <span>CUIS:</span>
              <span className="caja-invoice__sfe-value">{config.invoicing.cuis || '---'}</span>
            </div>
            <div className="caja-invoice__sfe-row">
              <span>CUFD:</span>
              <span className="caja-invoice__sfe-value">{config.invoicing.cufd || '---'}</span>
            </div>
            <div className="caja-invoice__sfe-row">
              <span>Nº Autorización:</span>
              <span className="caja-invoice__sfe-value">{config.invoicing.authorizationNumber || '---'}</span>
            </div>
            <div className="caja-invoice__sfe-row">
              <span>Sucursal:</span>
              <span className="caja-invoice__sfe-value">{config.invoicing.branchCode}</span>
            </div>
            <div className="caja-invoice__sfe-row">
              <span>Punto de Venta:</span>
              <span className="caja-invoice__sfe-value">{config.invoicing.pointOfSaleCode}</span>
            </div>
          </div>
        )}
      </Card>

      {/* Print invoice */}
      <PrintReceipt
        open={printOpen}
        onClose={() => setPrintOpen(false)}
        kind="invoice"
        receipt={{
          businessName: 'El Rey de la Chelada',
          nit: printData?.nit ?? '',
          customerName: printData?.name ?? '',
          orderId: printData?.orderId || '—',
          amount: printData?.amount ?? 0,
          ivaAmount: Math.round((printData?.amount ?? 0) * 0.13), // v11: centavos (semántica previa: IVA display)
          date: new Date().toISOString(),
        }}
        label="Factura"
      />
    </div>
  );
}

export default InvoiceView;
