import React from 'react';
import { bootstrapPwa, setCurrentPwaModule } from '../_shared/bootstrap';
import { PwaLayout } from '../_shared/components/PwaLayout';

setCurrentPwaModule('cocina');
bootstrapPwa('cocina');

export default function App() {
  return (
    <PwaLayout title="Cocina">
      <div className="kds-screen" style={{ padding: '24px', height: 'calc(100vh - 60px)' }}>
        <h1>🍳 KDS — Cocina</h1>
        <p style={{ color: 'var(--text-muted)', fontSize: 'var(--text-lg)' }}>
          Pedidos en tiempo real aparecerán aquí.
        </p>
      </div>
    </PwaLayout>
  );
}
