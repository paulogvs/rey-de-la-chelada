/**
 * PWA MESEROS — Waiter Management Interface
 *
 * State flow:
 * TableGrid → tap table → OrderPanel (if no order) or ViewOrder (if has order)
 *   OrderPanel → add items → Confirm → KDS gets order
 *   ViewOrder → PaymentPanel → Pay → Table clears
 *
 * Components: TableGrid, OrderPanel, PaymentPanel
 * Touch-friendly: large targets, swipe, long-press
 */

import React, { useState, useCallback } from 'react';
import { bootstrapPwa, setCurrentPwaModule } from '../_shared/bootstrap';
import { PwaLayout } from '../_shared/components/PwaLayout';
import { TableGrid } from '@/modules/salon/components/TableGrid';
import { ForchiBadge } from '@/ui/components/ForchiBadge';
import type { Table, MenuItem, Order, PaymentMethod } from '@/core/types';
import { OrderPanel } from './OrderPanel';
import { PaymentPanel } from './PaymentPanel';
import { ToastProvider, useToast } from '@/ui/components/Toast';
import './App.css';

type ViewState = 'tables' | 'order-panel' | 'payment-panel';

function MeserosApp() {
  const { addToast } = useToast();
  const [view, setView] = useState<ViewState>('tables');
  const [selectedTable, setSelectedTable] = useState<Table | null>(null);
  const [activeOrder, setActiveOrder] = useState<Order | null>(null);

  // Handle table selection from grid
  const handleTableSelect = useCallback((table: Table) => {
    setSelectedTable(table);
    setView('order-panel');
  }, []);

  // Handle back to table grid
  const handleBackToTables = useCallback(() => {
    setSelectedTable(null);
    setActiveOrder(null);
    setView('tables');
  }, []);

  // Handle order placed
  const handleOrderPlaced = useCallback((order: Order) => {
    setActiveOrder(order);
    addToast({
      type: 'success',
      message: `Pedido enviado a cocina — Mesa ${selectedTable?.number}`,
      duration: 3000,
    });
    setView('payment-panel');
  }, [selectedTable, addToast]);

  // Handle view existing order
  const handleViewOrder = useCallback((order: Order) => {
    setActiveOrder(order);
    setView('payment-panel');
  }, []);

  // Handle payment complete
  const handlePaymentComplete = useCallback(() => {
    addToast({
      type: 'success',
      message: `Pago registrado — Mesa ${selectedTable?.number}`,
      duration: 3000,
    });
    handleBackToTables();
  }, [selectedTable, addToast, handleBackToTables]);

  // Handle cancel order
  const handleOrderCancelled = useCallback(() => {
    addToast({
      type: 'warning',
      message: 'Pedido cancelado',
      duration: 3000,
    });
    handleBackToTables();
  }, [addToast, handleBackToTables]);

  return (
    <PwaLayout title="Meseros">
      <div className="meseros-app">
        {/* Navigation Bar */}
        <header className="meseros-header">
          <div className="meseros-header__left">
            {view !== 'tables' && (
              <button className="meseros-header__back" onClick={handleBackToTables}>
                ← Volver
              </button>
            )}
            <h1 className="meseros-header__title">
              {view === 'tables' && 'Mesas'}
              {view === 'order-panel' && `Mesa ${selectedTable?.number} — Nuevo Pedido`}
              {view === 'payment-panel' && `Mesa ${selectedTable?.number} — Pago`}
            </h1>
          </div>
          {selectedTable && view !== 'tables' && (
            <span className="meseros-header__table-badge">
              Mesa {selectedTable.number} · {selectedTable.capacity} pers.
            </span>
          )}
        </header>

        {/* Main Content */}
        <main className="meseros-main">
          {view === 'tables' && (
            <div className="meseros-tables">
              <TableGrid
                onTableSelect={handleTableSelect}
                showConfig={false}
              />
            </div>
          )}

          {view === 'order-panel' && selectedTable && (
            <OrderPanel
              table={selectedTable}
              onOrderPlaced={handleOrderPlaced}
              onCancel={handleOrderCancelled}
              onBack={handleBackToTables}
            />
          )}

          {view === 'payment-panel' && selectedTable && activeOrder && (
            <PaymentPanel
              order={activeOrder}
              table={selectedTable}
              onPaymentComplete={handlePaymentComplete}
              onBack={() => setView('order-panel')}
            />
          )}
        </main>

        <ForchiBadge />
      </div>
    </PwaLayout>
  );
}

export default function App() {
  setCurrentPwaModule('meseros');
  bootstrapPwa('meseros');

  return (
    <ToastProvider>
      <MeserosApp />
    </ToastProvider>
  );
}
