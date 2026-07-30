import React from 'react';
import { bootstrapPwa, setCurrentPwaModule } from '../_shared/bootstrap';
import { PwaLayout } from '../_shared/components/PwaLayout';
import { TableGrid } from '../../modules/salon/components/TableGrid';

setCurrentPwaModule('meseros');
bootstrapPwa('meseros');

export default function App() {
  return (
    <PwaLayout title="Meseros">
      <div style={{ padding: '16px', height: 'calc(100vh - 60px)', overflow: 'auto' }}>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--text-3xl)', marginBottom: '24px' }}>
          🪑 Mesas
        </h1>
        <TableGrid onTableSelect={(table) => console.log('Mesa seleccionada:', table.number)} />
      </div>
    </PwaLayout>
  );
}
