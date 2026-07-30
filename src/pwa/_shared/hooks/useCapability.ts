/**
 * useCapability — Hook para verificar capabilities en el PWA actual
 *
 * Uso:
 *   const canCallWaiter = useCapability(Capability.CALL_WAITER);
 *   if (!canCallWaiter) return <ReadOnlyMenu />;
 */

import { useMemo } from 'react';
import { AuthorizationEngine } from '@/core/config/capabilities';
import type { Capability, PwaModuleId } from '@/core/config';

let _currentModule: PwaModuleId | null = null;

export function setCurrentPwaModule(moduleId: PwaModuleId): void {
  _currentModule = moduleId;
}

export function getCurrentPwaModule(): PwaModuleId | null {
  return _currentModule;
}

export function useCapability(capability: Capability): boolean {
  return useMemo(() => {
    if (!_currentModule) return false;
    return AuthorizationEngine.hasCapability(_currentModule, capability);
  }, [capability]);
}

export function useCapabilities(): Capability[] {
  return useMemo(() => {
    if (!_currentModule) return [];
    return AuthorizationEngine.getCapabilities(_currentModule);
  }, []);
}
