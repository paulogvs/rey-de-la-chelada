/**
 * PWA CLIENTES — App principal
 *
 * "El pedido activo es el permiso"
 *
 * - Menú siempre visible (offline-first)
 * - Llamar mesero: SOLO si hay pedido activo
 * - Pedir cuenta: SOLO si hay pedido activo
 * - Sin necesidad de WiFi, sin IP tracking
 */

import React from 'react';
import { bootstrapPwa, setCurrentPwaModule } from '../_shared/bootstrap';
import { PwaLayout } from '../_shared/components/PwaLayout';
import { MenuPage } from './pages/MenuPage';

// Inicializar módulo
setCurrentPwaModule('clientes');
bootstrapPwa('clientes');

export default function App() {
  return (
    <PwaLayout title="Menú Digital">
      <MenuPage />
    </PwaLayout>
  );
}
