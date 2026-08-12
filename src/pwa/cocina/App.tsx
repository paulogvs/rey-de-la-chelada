/**
 * PWA COCINA — KDS de cocina (solo area='cocina').
 *
 * FASE 1 (KDS separado): usa el componente compartido KDSBoard con
 * module='cocina'. Muestra SOLO items de comidas (mi.area='cocina').
 * Auth: rol 'kds' (PIN 2222) o 'admin' (PIN 0000) — ver MODULE_ROLES.
 */

import React from 'react';
import { bootstrapPwa } from '../_shared/bootstrap';
import { setCurrentPwaModule } from '../_shared/hooks/useCapability';
import { useStaffAuth } from '../_shared/hooks/useStaffAuth';
import { LoginScreen } from '../_shared/components/LoginScreen';
import { PwaLayout } from '../_shared/components/PwaLayout';
import { Loader } from '@/ui/components/Loader';
import { KDSBoard } from '@/ui/components/KDSBoard';

export default function App() {
  setCurrentPwaModule('cocina');
  bootstrapPwa('cocina');

  const { isAuthenticated, token, login, restoring } = useStaffAuth('cocina', ['admin', 'kds']);

  if (restoring) {
    return (
      <PwaLayout title="Cocina">
        <Loader block label="Cargando…" />
      </PwaLayout>
    );
  }

  if (!isAuthenticated || !token) {
    return (
      <PwaLayout title="Cocina">
        <LoginScreen title="Cocina" busy={restoring} onLogin={login} />
      </PwaLayout>
    );
  }

  return <KDSBoard module="cocina" title="Cocina" icon="🍳" token={token} />;
}
