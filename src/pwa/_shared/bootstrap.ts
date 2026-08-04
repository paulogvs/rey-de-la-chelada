/**
 * PWA Bootstrap — shared setup for every PWA module
 *
 * Cada PWA llama a bootstrapPwa() al iniciar:
 *
 *   import { bootstrapPwa } from '../_shared/bootstrap';
 *   bootstrapPwa('cocina');
 *
 * Esto configura:
 * - Theme (dark mode default, palette desde config)
 * - Service Worker scope
 * - Capacidades permitidas
 * - Routing base
 */

import { appConfig, type PwaModuleId } from '@/core/config';
import { PWA_REGISTRY } from '@/core/config/pwa-registry';
import { MODULE_CAPABILITIES } from '@/core/config/capabilities';
import themeManager from '@/ui/tokens/theme';
import { registerServiceWorkerWithAutoUpdate } from './serviceWorkerAutoUpdate';

export interface PwaEnv {
  moduleId: PwaModuleId;
  basePath: string;
  capabilities: string[];
  isKds: boolean;
  isTouchOptimized: boolean;
  isMinimal: boolean;
}

export function bootstrapPwa(moduleId: PwaModuleId): PwaEnv {
  const reg = PWA_REGISTRY[moduleId];
  if (!reg) {
    throw new Error(`PWA module "${moduleId}" not found in registry`);
  }

  // 1. Apply theme
  const config = appConfig.all;
  themeManager.setPalette(config.theme.defaultPalette);
  themeManager.setTheme(config.theme.defaultTheme);

  // 2. Determine env info
  const capabilities = Object.values(MODULE_CAPABILITIES[moduleId] || []);

  const env: PwaEnv = {
    moduleId,
    basePath: reg.manifest.scope,
    capabilities: capabilities as string[],
    isKds: reg.themeVariant === 'kds',
    isTouchOptimized: reg.themeVariant === 'touch',
    isMinimal: reg.themeVariant === 'minimal',
  };

  // 3. Set HTML class for CSS targeting
  document.documentElement.dataset.pwa = moduleId;
  document.documentElement.dataset.themeVariant = reg.themeVariant;

  // 4. Service Worker — registro por módulo (FASE 3) + auto-actualización
  //    Solo en producción: sw.js vive en /[pwa]/sw.js con scope /[pwa]/
  //    Auto-update: si hay un SW nuevo (build reciente), activarlo de inmediato
  //    y recargar una vez — evita la "pantalla café" de SW viejo con hashes
  //    antiguos que ya no existen en el servidor. Lógica en módulo testeado.
  if (import.meta.env.PROD && 'serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      registerServiceWorkerWithAutoUpdate(moduleId, navigator.serviceWorker, window).catch(err =>
        console.error(`[PWA] SW registration failed (${moduleId}):`, err)
      );
    });
  }

  // 5. Log environment (Artículo VI: Observabilidad)
  console.log(`[PWA] Bootstrapped: ${moduleId}`, {
    basePath: env.basePath,
    capabilities: env.capabilities,
    theme: config.theme.defaultTheme,
    variant: reg.themeVariant,
  });

  return env;
}
