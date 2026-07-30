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
import themeManager from '@/ui/tokens/theme';

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
  const capabilities = Object.values(require('@/core/config/capabilities').MODULE_CAPABILITIES[moduleId] || []);

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

  // 4. Log environment (Artículo VI: Observabilidad)
  console.log(`[PWA] Bootstrapped: ${moduleId}`, {
    basePath: env.basePath,
    capabilities: env.capabilities,
    theme: config.theme.defaultTheme,
    variant: reg.themeVariant,
  });

  return env;
}
