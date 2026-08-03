/**
 * PWA CLIENTES — App principal
 *
 * "El pedido activo es el permiso"
 *
 * - Menú siempre visible (offline-first)
 * - Draft order → POST /api/client-orders (público, sin JWT)
 * - Seguimiento en vivo: waiting → confirmed → preparing → ready → paid
 * - Gracias tras el pago + reset
 * - Sin necesidad de WiFi, sin IP tracking
 */

import React from 'react';
import { bootstrapPwa } from '../_shared/bootstrap';
import { setCurrentPwaModule } from '../_shared/hooks/useCapability';
import { PwaLayout } from '../_shared/components/PwaLayout';
import { MenuPage } from './pages/MenuPage';
import { OrderTrackingPage } from './pages/OrderTrackingPage';
import { useClientOrder } from './hooks/useClientOrder';
import type { CreateClientOrderInput } from '../_shared/api/clientOrdersApi';

// Inicializar módulo
setCurrentPwaModule('clientes');
bootstrapPwa('clientes');

export default function App() {
  const { phase, order, error, polling, submitOrder, resetOrder } = useClientOrder();

  return (
    <PwaLayout title="Menú Digital">
      {phase === 'tracking' || phase === 'paid' ? (
        order && (
          <OrderTrackingPage
            order={order}
            error={error}
            polling={polling}
            onReset={resetOrder}
          />
        )
      ) : (
        <MenuPage
          onSubmitOrder={(input: CreateClientOrderInput) => void submitOrder(input)}
        />
      )}
    </PwaLayout>
  );
}
