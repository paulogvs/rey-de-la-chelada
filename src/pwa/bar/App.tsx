import React from 'react';
import { bootstrapPwa, setCurrentPwaModule } from '../_shared/bootstrap';
import { PwaLayout } from '../_shared/components/PwaLayout';

setCurrentPwaModule('bar');
bootstrapPwa('bar');

export default function App() {
  return (
    <PwaLayout title="Bar">
      <div className="kds-screen" style={{ padding: '24px', height: 'calc(100vh - 60px)' }}>
        <h1>🍺 Barra</h1>
        <p style={{ color: 'var(--text-muted)', fontSize: 'var(--text-lg)' }}>
          Órdenes de barra en tiempo real.
        </p>
      </div>
    </PwaLayout>
  );
}
