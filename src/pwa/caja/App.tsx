/**
 * PWA CAJA — Cash Closing & Financial Dashboard
 *
 * - Daily Summary cards (total sales, IVA breakdown, by payment method)
 * - Cash Closing with reconciliation
 * - Invoice generator (SFE-ready)
 * - Data-dense, mono-font for numbers, green accents for positive
 */

import React, { useState, useEffect, useCallback } from 'react';
import { bootstrapPwa, setCurrentPwaModule } from '../_shared/bootstrap';
import { PwaLayout } from '../_shared/components/PwaLayout';
import { orderEngine } from '@/core/engine';
import { appConfig } from '@/core/config';
import { Card, CardSkeleton } from '@/ui/components/Card';
import { Button } from '@/ui/components/Button';
import { Badge } from '@/ui/components/Badge';
import { ForchiBadge } from '@/ui/components/ForchiBadge';
import { ToastProvider, useToast } from '@/ui/components/Toast';
import type { PaymentMethod } from '@/core/types';
import './App.css';

interface DailySummary {
  date: string;
  totalOrders: number;
  totalSales: number;
  totalIva: number;
  byMethod: Record<string, number>;
  averageTicket: number;
}

interface CashDrawer {
  openingBalance: number;
  expectedCash: number;
  actualCash: number;
  difference: number;
  isReconciled: boolean;
}

function CajaApp() {
  const { addToast } = useToast();
  const config = appConfig.all;
  const today = new Date().toISOString().split('T')[0];

  const [summary, setSummary] = useState<DailySummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<'summary' | 'close' | 'invoice'>('summary');
  const [cashDrawer, setCashDrawer] = useState<CashDrawer>({
    openingBalance: 500, // Default opening cash
    expectedCash: 0,
    actualCash: 0,
    difference: 0,
    isReconciled: false,
  });
  const [closingNotes, setClosingNotes] = useState('');

  // Invoice state
  const [invoiceNit, setInvoiceNit] = useState('');
  const [invoiceName, setInvoiceName] = useState('');
  const [invoiceOrderId, setInvoiceOrderId] = useState('');
  const [invoiceAmount, setInvoiceAmount] = useState(0);

  // Load daily summary
  const loadSummary = useCallback(() => {
    setLoading(true);
    try {
      const daily = orderEngine.getDailySummary(today);
      setSummary(daily);

      // Calculate expected cash from cash payments
      const cashSales = daily.byMethod['cash'] || 0;
      setCashDrawer(prev => ({
        ...prev,
        expectedCash: Math.round((prev.openingBalance + cashSales) * 100) / 100,
        difference: Math.round((prev.actualCash - (prev.openingBalance + cashSales)) * 100) / 100,
      }));
    } catch (err) {
      console.error('[Caja] Error loading summary:', err);
    } finally {
      setLoading(false);
    }
  }, [today]);

  useEffect(() => {
    loadSummary();
    const interval = setInterval(loadSummary, 30000);
    return () => clearInterval(interval);
  }, [loadSummary]);

  // Update actual cash
  const updateActualCash = useCallback((value: number) => {
    setCashDrawer(prev => {
      const expected = prev.openingBalance + (summary?.byMethod['cash'] || 0);
      return {
        ...prev,
        actualCash: value,
        expectedCash: Math.round(expected * 100) / 100,
        difference: Math.round((value - expected) * 100) / 100,
      };
    });
  }, [summary]);

  // Close cash day
  const handleCloseDay = useCallback(() => {
    if (!cashDrawer.isReconciled && Math.abs(cashDrawer.difference) > 0.01) {
      addToast({
        type: 'warning',
        message: `Diferencia de Bs. ${cashDrawer.difference.toFixed(2)}. Verifica antes de cerrar.`,
        duration: 5000,
      });
      return;
    }

    addToast({
      type: 'success',
      message: 'Cierre de caja completado. Día cerrado.',
      duration: 4000,
    });
  }, [cashDrawer, addToast]);

  // Generate invoice stub
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

  const methodLabels: Record<string, string> = {
    cash: 'Efectivo',
    qr_yape: 'Yape',
    qr_simple: 'QR Simple',
    card: 'Tarjeta',
    transfer: 'Transferencia',
  };

  const methodIcons: Record<string, string> = {
    cash: '💵',
    qr_yape: '📱',
    qr_simple: '📱',
    card: '💳',
    transfer: '🏦',
  };

  return (
    <PwaLayout title="Caja">
      <div className="caja-app">
        {/* Header */}
        <header className="caja-header">
          <h1 className="caja-header__title">Caja</h1>
          <div className="caja-header__nav">
            <button
              className={`caja-header__nav-btn ${view === 'summary' ? 'active' : ''}`}
              onClick={() => setView('summary')}
            >
              Resumen
            </button>
            <button
              className={`caja-header__nav-btn ${view === 'close' ? 'active' : ''}`}
              onClick={() => setView('close')}
            >
              Cierre
            </button>
            <button
              className={`caja-header__nav-btn ${view === 'invoice' ? 'active' : ''}`}
              onClick={() => setView('invoice')}
            >
              Facturación
            </button>
          </div>
          <Badge variant="info" large>{today}</Badge>
        </header>

        <main className="caja-main">
          {/* ---- SUMMARY VIEW ---- */}
          {view === 'summary' && (
            <div className="caja-summary">
              {loading ? (
                <div className="caja-summary__grid">
                  {[1, 2, 3, 4].map(i => <CardSkeleton key={i} />)}
                </div>
              ) : summary ? (
                <>
                  <div className="caja-summary__grid">
                    {/* Total Sales */}
                    <Card status="paid" className="caja-metric">
                      <div className="caja-metric__label">Ventas del día</div>
                      <div className="caja-metric__value caja-metric__value--gross">
                        Bs. {summary.totalSales.toFixed(2)}
                      </div>
                      <div className="caja-metric__detail">
                        <span>{summary.totalOrders} pedidos</span>
                        <span>IVA: Bs. {summary.totalIva.toFixed(2)}</span>
                      </div>
                    </Card>

                    {/* Average Ticket */}
                    <Card className="caja-metric">
                      <div className="caja-metric__label">Ticket promedio</div>
                      <div className="caja-metric__value">
                        Bs. {summary.averageTicket.toFixed(2)}
                      </div>
                      <div className="caja-metric__detail">
                        <span>Sin IVA: Bs. {(summary.averageTicket - summary.totalIva / (summary.totalOrders || 1)).toFixed(2)}</span>
                      </div>
                    </Card>

                    {/* IVA */}
                    <Card className="caja-metric">
                      <div className="caja-metric__label">IVA 13%</div>
                      <div className="caja-metric__value caja-metric__value--iva">
                        Bs. {summary.totalIva.toFixed(2)}
                      </div>
                      <div className="caja-metric__detail">
                        <span>Base imponible: Bs. {(summary.totalSales - summary.totalIva).toFixed(2)}</span>
                      </div>
                    </Card>

                    {/* Orders Count */}
                    <Card className="caja-metric">
                      <div className="caja-metric__label">Pedidos</div>
                      <div className="caja-metric__value caja-metric__value--orders">
                        {summary.totalOrders}
                      </div>
                      <div className="caja-metric__detail">
                        <span>Hoy</span>
                      </div>
                    </Card>
                  </div>

                  {/* Sales by payment method */}
                  <Card className="caja-methods">
                    <h3>Ventas por método de pago</h3>
                    <div className="caja-methods__list">
                      {Object.entries(summary.byMethod).map(([method, amount]) => (
                        <div key={method} className="caja-methods__item">
                          <span className="caja-methods__label">
                            {methodIcons[method]} {methodLabels[method] || method}
                          </span>
                          <div className="caja-methods__bar">
                            <div
                              className="caja-methods__bar-fill"
                              style={{
                                width: `${summary.totalSales > 0 ? (amount / summary.totalSales) * 100 : 0}%`,
                              }}
                            />
                          </div>
                          <span className="caja-methods__amount">
                            Bs. {amount.toFixed(2)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </Card>
                </>
              ) : (
                <Card className="caja-empty">
                  <p>No hay datos de ventas para hoy</p>
                </Card>
              )}
            </div>
          )}

          {/* ---- CASH CLOSING VIEW ---- */}
          {view === 'close' && (
            <div className="caja-close">
              <Card className="caja-close__card">
                <h3>Cierre de Caja</h3>

                <div className="caja-close__fields">
                  <div className="caja-close__field">
                    <label>Saldo inicial</label>
                    <input
                      type="number"
                      className="caja-close__input"
                      value={cashDrawer.openingBalance}
                      step={0.01}
                      onChange={e => setCashDrawer(prev => ({ ...prev, openingBalance: parseFloat(e.target.value) || 0 }))}
                    />
                  </div>

                  <div className="caja-close__field">
                    <label>Efectivo esperado (saldo inicial + ventas efectivo)</label>
                    <div className="caja-close__value">
                      Bs. {cashDrawer.expectedCash.toFixed(2)}
                    </div>
                  </div>

                  <div className="caja-close__field">
                    <label>Efectivo real en caja</label>
                    <input
                      type="number"
                      className="caja-close__input"
                      value={cashDrawer.actualCash}
                      step={0.01}
                      onChange={e => updateActualCash(parseFloat(e.target.value) || 0)}
                    />
                  </div>

                  <div className="caja-close__field">
                    <label>Diferencia</label>
                    <div className={`caja-close__diff ${cashDrawer.difference >= 0 ? 'positive' : 'negative'}`}>
                      {cashDrawer.difference >= 0 ? '+' : ''}Bs. {cashDrawer.difference.toFixed(2)}
                    </div>
                  </div>

                  <div className="caja-close__field">
                    <label>Notas</label>
                    <textarea
                      className="caja-close__textarea"
                      value={closingNotes}
                      onChange={e => setClosingNotes(e.target.value)}
                      placeholder="Observaciones del cierre..."
                      rows={3}
                    />
                  </div>
                </div>

                <div className="caja-close__actions">
                  <Button
                    variant="secondary"
                    onClick={() => setCashDrawer(prev => ({
                      ...prev,
                      isReconciled: !prev.isReconciled,
                    }))}
                  >
                    {cashDrawer.isReconciled ? 'Diferencia no conciliada' : 'Conciliar diferencia'}
                  </Button>
                  <Button
                    variant="primary"
                    onClick={handleCloseDay}
                    fullWidth
                  >
                    Cerrar Día
                  </Button>
                </div>
              </Card>

              {/* Today's cash movements */}
              <Card className="caja-close__history">
                <h3>Resumen de cierre</h3>
                <div className="caja-close__history-list">
                  <div className="caja-close__history-item">
                    <span>Total ventas</span>
                    <span className="caja-close__history-value">
                      Bs. {summary?.totalSales.toFixed(2) || '0.00'}
                    </span>
                  </div>
                  <div className="caja-close__history-item">
                    <span>IVA total</span>
                    <span className="caja-close__history-value">
                      Bs. {summary?.totalIva.toFixed(2) || '0.00'}
                    </span>
                  </div>
                  <div className="caja-close__history-item">
                    <span>Total pedidos</span>
                    <span className="caja-close__history-value">
                      {summary?.totalOrders || 0}
                    </span>
                  </div>
                  <div className="caja-close__history-item">
                    <span>Ventas efectivo</span>
                    <span className="caja-close__history-value">
                      Bs. {(summary?.byMethod['cash'] || 0).toFixed(2)}
                    </span>
                  </div>
                  <div className="caja-close__history-item">
                    <span>Ventas QR</span>
                    <span className="caja-close__history-value">
                      Bs. {((summary?.byMethod['qr_yape'] || 0) + (summary?.byMethod['qr_simple'] || 0)).toFixed(2)}
                    </span>
                  </div>
                  <div className="caja-close__history-item">
                    <span>Ventas tarjeta</span>
                    <span className="caja-close__history-value">
                      Bs. {(summary?.byMethod['card'] || 0).toFixed(2)}
                    </span>
                  </div>
                  <div className="caja-close__history-item">
                    <span>Ventas transferencia</span>
                    <span className="caja-close__history-value">
                      Bs. {(summary?.byMethod['transfer'] || 0).toFixed(2)}
                    </span>
                  </div>
                </div>
              </Card>
            </div>
          )}

          {/* ---- INVOICE VIEW ---- */}
          {view === 'invoice' && (
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
          )}
        </main>

        <ForchiBadge />
      </div>
    </PwaLayout>
  );
}

export default function App() {
  setCurrentPwaModule('caja');
  bootstrapPwa('caja');

  return (
    <ToastProvider>
      <CajaApp />
    </ToastProvider>
  );
}
