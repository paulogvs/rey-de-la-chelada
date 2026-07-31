/**
 * PWA BAR — Redirect to Unified KDS
 *
 * Since KDS is now unified (cocina+bar merged), this PWA
 * redirects to the unified KDS at /cocina/.
 * Keeps the bar PWA entry point for backward compatibility.
 */

import React, { useEffect } from 'react';
import { bootstrapPwa } from '../_shared/bootstrap';
import { setCurrentPwaModule } from '../_shared/hooks/useCapability';
import { PwaLayout } from '../_shared/components/PwaLayout';

export default function App() {
  setCurrentPwaModule('bar');
  bootstrapPwa('bar');

  useEffect(() => {
    // Redirect to unified KDS after a brief moment
    const timer = setTimeout(() => {
      window.location.href = '/cocina/';
    }, 1500);
    return () => clearTimeout(timer);
  }, []);

  return (
    <PwaLayout title="Bar — Redirigiendo">
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '60vh',
        gap: 'var(--space-4)',
        textAlign: 'center',
        padding: 'var(--space-4)',
      }}>
        <div style={{ fontSize: '48px' }}>🍺</div>
        <h2>KDS Unificado</h2>
        <p style={{ color: 'var(--text-muted)' }}>
          Bar y cocina ahora comparten el mismo KDS.
        </p>
        <p style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>
          Redirigiendo a /cocina/...
        </p>
        <a
          href="/cocina/"
          style={{
            background: 'var(--dorado-rey)',
            color: 'var(--madera-oscura)',
            padding: 'var(--space-3) var(--space-5)',
            borderRadius: 'var(--radius-md)',
            fontWeight: 700,
            textDecoration: 'none',
          }}
        >
          Ir a KDS Unificado
        </a>
      </div>
    </PwaLayout>
  );
}
