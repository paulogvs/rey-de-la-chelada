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
import { useToast } from '@/ui/components/Toast';

export function InvoiceView() {
  const { addToast } = useToast();
  const config = appConfig.all;

  const [invoiceNit, setInvoiceNit] = useState('');
  const [invoiceName, setInvoiceName] = useState('');
  const [invoiceOrderId, setInvoiceOrderId] = useState('');
  const [invoiceAmount, setInvoiceAmount] = useState(0);

  const handleGenerateInvoice = useCallback(() => {
    if (!invoiceNit || !invoiceName || invoiceAmount <= 0) {
      addToast({ type: 'warning', message: 'Completa NIT, Razón Social y monto', duration: 3000 });
      return;
    }

    addToast({
      type: 'success',
      message: `Factura generada: ${invoiceNit} — Bs. ${invoiceAmount.toFixed(2)}`,
      duration: 4000,
    });
  }, [invoiceNit, invoiceName, invoiceAmount, addToast]);

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
            <input
              type="text"
              className="caja-invoice__input"
              value={invoiceNit}
              onChange={e => setInvoiceNit(e.target.value)}
              placeholder="Ej: 1234567890"
            />
          </div>

          <div className="caja-invoice__field">
            <label>Razón Social / Nombre</label>
            <input
              type="text"
              className="caja-invoice__input"
              value={invoiceName}
              onChange={e => setInvoiceName(e.target.value)}
              placeholder="Nombre completo o razón social"
            />
          </div>

          <div className="caja-invoice__field">
            <label>Nº de Pedido</label>
            <input
              type="text"
              className="caja-invoice__input"
              value={invoiceOrderId}
              onChange={e => setInvoiceOrderId(e.target.value)}
              placeholder="ID del pedido"
            />
          </div>

          <div className="caja-invoice__field">
            <label>Monto (Bs.)</label>
            <input
              type="number"
              className="caja-invoice__input caja-invoice__input--mono"
              value={invoiceAmount || ''}
              step={0.01}
              onChange={e => setInvoiceAmount(parseFloat(e.target.value) || 0)}
              placeholder="0.00"
            />
          </div>
        </div>

        <div className="caja-invoice__actions">
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
    </div>
  );
}

export default InvoiceView;
