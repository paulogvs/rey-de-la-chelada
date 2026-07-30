import React from 'react';
import { bootstrapPwa, setCurrentPwaModule } from '../_shared/bootstrap';
import { PwaLayout } from '../_shared/components/PwaLayout';

setCurrentPwaModule('admin');
bootstrapPwa('admin');

export default function App() {
  return (
    <PwaLayout title="Admin">
      <div style={{ padding: '24px', height: 'calc(100vh - 60px)', overflow: 'auto' }}>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--text-3xl)' }}>
          ⚙️ Administración
        </h1>
        <p style={{ color: 'var(--text-muted)', fontSize: 'var(--text-lg)' }}>
          Configuración, reportes, inventario, personal.
        </p>
      </div>
    </PwaLayout>
  );
}
