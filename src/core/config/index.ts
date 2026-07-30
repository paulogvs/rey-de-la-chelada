/**
 * ═══════════════════════════════════════════════════════════
 *  CONFIG — Export unificado del SSOT de configuración
 * ═══════════════════════════════════════════════════════════
 *
 *  CUALQUIER módulo PWA importa desde aquí:
 *
 *    import { appConfig, AuthorizationEngine } from '@/core/config';
 *
 *  NUNCA importes directamente de los archivos individuales.
 *  Este barrel file asegura que todo esté tipado y unificado.
 * ═══════════════════════════════════════════════════════════
 */

// App Config (SSOT del restaurante)
export { default as appConfig, AppConfig, DEFAULT_CONFIG } from './app.config';
export type { RestaurantConfig, PwaModule, PwaModuleId, TaxConfig, BusinessHours, ClientModuleConfig } from './app.config';

// PWA Registry
export { PWA_REGISTRY, getPwaRegistration, getAllManifests, getActivePwaModules } from './pwa-registry';
export type { PwaRegistration, PwaManifest, PwaThemeVariant } from './pwa-registry';

// Capabilities
export { AuthorizationEngine, Capability, MODULE_CAPABILITIES } from './capabilities';
export type { Feature } from './capabilities';

// Security
export { default as securityEngine, SecurityEngine } from './security';
export type { QrTokenPayload, ClientSession } from './security';
