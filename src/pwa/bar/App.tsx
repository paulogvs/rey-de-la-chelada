/**
 * PWA BAR — KDS de barra (solo area='bar').
 *
 * FASE 1 (KDS separado): usa el componente compartido KDSBoard con
 * module='bar'. Muestra SOLO items de bebidas/micheladas (mi.area='bar').
 * Auth: rol 'kds' (PIN 2222) o 'admin' (PIN 0000) — ver MODULE_ROLES.
 *
 * Reemplaza el antiguo redirect a /cocina/ (KDS unificado).
 */

import React from 'react';
import { bootstrapPwa } from '../_shared/bootstrap';
import { setCurrentPwaModule } from '../_shared/hooks/useCapability';
import { useStaffAuth } from '../_shared/hooks/useStaffAuth';
import { LoginScreen } from '../_shared/components/LoginScreen';
import { PwaLayout } from '../_shared/components/PwaLayout';
import { Loader } from '@/ui/components/Loader';
import { KDSBoard } from '@/ui/components/KDSBoard';
import { AppIcon } from '@/ui/components/AppIcon/AppIcon';

export default function App() {
  setCurrentPwaModule('bar');
  bootstrapPwa('bar');

  const { isAuthenticated, token, login, restoring } = useStaffAuth('bar', ['admin', 'kds']);

  if (restoring) {
    return (
      <PwaLayout title="Bar">
        <Loader block label="Cargando…" />
      </PwaLayout>
    );
  }

  if (!isAuthenticated || !token) {
    return (
      <PwaLayout title="Bar">
        <LoginScreen title="Barra" busy={restoring} onLogin={login} />
      </PwaLayout>
    );
  }

  return <KDSBoard module="bar" title="Barra" icon={<AppIcon name="beer" size="lg" />} token={token} />;
}
