/**
 * ═══════════════════════════════════════════════════════════
 *  PWA REGISTRY — Catálogo de todos los módulos PWA
 * ═══════════════════════════════════════════════════════════
 *
 *  Artículo I: SSOT — Aquí se define qué PWAs existen.
 *  Cada PWA es una "mini-app" que comparte el mismo motor (SSOT).
 *
 *  Para agregar un nuevo PWA:
 *  1.  Agrégalo a PwaModuleId en app.config.ts
 *  2.  Agrega su entrada en activeModules
 *  3.  Define sus capacidades en capabilities.ts
 *  4.  Crea su carpeta en src/pwa/[id]/
 *  5.  El manifest se genera automáticamente desde aquí
 * ═══════════════════════════════════════════════════════════
 */

import { appConfig, type PwaModule, type PwaModuleId } from './app.config';

// ============================================================
// MANIFEST GENERATOR
// ============================================================

export interface PwaManifest {
  name: string;
  short_name: string;
  description: string;
  start_url: string;
  scope: string;
  display: 'standalone' | 'fullscreen' | 'minimal-ui';
  orientation: 'any' | 'portrait' | 'landscape';
  background_color: string;
  theme_color: string;
  categories: string[];
  icons: Array<{ src: string; sizes: string; type: string }>;
}

export type PwaThemeVariant = 'default' | 'kds' | 'touch' | 'minimal';

export interface PwaRegistration {
  moduleId: PwaModuleId;
  manifest: PwaManifest;
  themeVariant: PwaThemeVariant;
  serviceWorker: {
    cachePrefix: string;
    precacheAssets: string[];
    networkFirst: string[];
    cacheFirst: string[];
    offlineFallback: string;
  };
}

// ============================================================
// REGISTRO
// ============================================================

const brandName = appConfig.all.business.name;

export const PWA_REGISTRY: Record<PwaModuleId, PwaRegistration> = {
  // ==========================================================
  // COCINA — Kitchen Display System
  // ==========================================================
  cocina: {
    moduleId: 'cocina',
    manifest: {
      name: `${brandName} · Cocina`,
      short_name: 'RdlC · Cocina',
      description: 'KDS — Kitchen Display System para cocina. Pedidos en tiempo real con alertas.',
      start_url: '/cocina/',
      scope: '/cocina/',
      display: 'fullscreen',
      orientation: 'landscape',
      background_color: '#0A0A0A',
      theme_color: '#D4AF37',
      categories: ['business', 'food', 'restaurant'],
      icons: [
        { src: '/icons/cocina-192.png', sizes: '192x192', type: 'image/png' },
        { src: '/icons/cocina-512.png', sizes: '512x512', type: 'image/png' },
      ],
    },
    themeVariant: 'kds',
    serviceWorker: {
      cachePrefix: 'rdlc-cocina',
      precacheAssets: ['/cocina/', '/cocina/index.html'],
      networkFirst: ['/api/kds/', '/socket.io/'],
      cacheFirst: ['/icons/', '/fonts/'],
      offlineFallback: '/cocina/offline.html',
    },
  },

  // ==========================================================
  // BAR — Bar Display
  // ==========================================================
  bar: {
    moduleId: 'bar',
    manifest: {
      name: `${brandName} · Bar`,
      short_name: 'RdlC · Bar',
      description: 'Órdenes de barra en tiempo real para bartenders.',
      start_url: '/bar/',
      scope: '/bar/',
      display: 'standalone',
      orientation: 'landscape',
      background_color: '#14100C',
      theme_color: '#E08B27',
      categories: ['business', 'food', 'restaurant'],
      icons: [
        { src: '/icons/bar-192.png', sizes: '192x192', type: 'image/png' },
        { src: '/icons/bar-512.png', sizes: '512x512', type: 'image/png' },
      ],
    },
    themeVariant: 'kds',
    serviceWorker: {
      cachePrefix: 'rdlc-bar',
      precacheAssets: ['/bar/', '/bar/index.html'],
      networkFirst: ['/api/kds/bar/', '/socket.io/'],
      cacheFirst: ['/icons/', '/fonts/'],
      offlineFallback: '/bar/offline.html',
    },
  },

  // ==========================================================
  // MESEROS — Waiter Tablet
  // ==========================================================
  meseros: {
    moduleId: 'meseros',
    manifest: {
      name: `${brandName} · Meseros`,
      short_name: 'RdlC · Meseros',
      description: 'Gestión de mesas, pedidos y cobros para meseros.',
      start_url: '/meseros/',
      scope: '/meseros/',
      display: 'standalone',
      orientation: 'any',
      background_color: '#14100C',
      theme_color: '#D4AF37',
      categories: ['business', 'restaurant'],
      icons: [
        { src: '/icons/meseros-192.png', sizes: '192x192', type: 'image/png' },
        { src: '/icons/meseros-512.png', sizes: '512x512', type: 'image/png' },
      ],
    },
    themeVariant: 'touch',
    serviceWorker: {
      cachePrefix: 'rdlc-meseros',
      precacheAssets: ['/meseros/', '/meseros/index.html'],
      networkFirst: ['/api/orders/', '/api/tables/', '/api/payments/'],
      cacheFirst: ['/icons/', '/fonts/', '/images/menu/'],
      offlineFallback: '/meseros/offline.html',
    },
  },

  // ==========================================================
  // CAJA — Cashier
  // ==========================================================
  caja: {
    moduleId: 'caja',
    manifest: {
      name: `${brandName} · Caja`,
      short_name: 'RdlC · Caja',
      description: 'Corte de caja, facturación y reportes del día.',
      start_url: '/caja/',
      scope: '/caja/',
      display: 'standalone',
      orientation: 'any',
      background_color: '#14100C',
      theme_color: '#0D5C3A',
      categories: ['business', 'finance', 'restaurant'],
      icons: [
        { src: '/icons/caja-192.png', sizes: '192x192', type: 'image/png' },
        { src: '/icons/caja-512.png', sizes: '512x512', type: 'image/png' },
      ],
    },
    themeVariant: 'default',
    serviceWorker: {
      cachePrefix: 'rdlc-caja',
      precacheAssets: ['/caja/', '/caja/index.html'],
      networkFirst: ['/api/reports/', '/api/payments/'],
      cacheFirst: ['/icons/', '/fonts/'],
      offlineFallback: '/caja/offline.html',
    },
  },

  // ==========================================================
  // ADMIN — Administration
  // ==========================================================
  admin: {
    moduleId: 'admin',
    manifest: {
      name: `${brandName} · Admin`,
      short_name: 'RdlC · Admin',
      description: 'Panel de administración: configuración, reportes.',
      start_url: '/admin/',
      scope: '/admin/',
      display: 'standalone',
      orientation: 'any',
      background_color: '#14100C',
      theme_color: '#D4AF37',
      categories: ['business', 'administration'],
      icons: [
        { src: '/icons/admin-192.png', sizes: '192x192', type: 'image/png' },
        { src: '/icons/admin-512.png', sizes: '512x512', type: 'image/png' },
      ],
    },
    themeVariant: 'default',
    serviceWorker: {
      cachePrefix: 'rdlc-admin',
      precacheAssets: ['/admin/', '/admin/index.html'],
      networkFirst: ['/api/admin/', '/api/reports/'],
      cacheFirst: ['/icons/', '/fonts/'],
      offlineFallback: '/admin/offline.html',
    },
  },

  // ==========================================================
  // CLIENTES — Digital Menu (Public)
  // ==========================================================
  clientes: {
    moduleId: 'clientes',
    manifest: {
      name: `${brandName} · Menú Digital`,
      short_name: 'RdlC · Menú',
      description: 'Menú digital del restaurante. Ver productos, llamar mesero, pedir cuenta.',
      start_url: '/clientes/',
      scope: '/clientes/',
      display: 'standalone',
      orientation: 'portrait',
      background_color: '#14100C',
      theme_color: '#D4AF37',
      categories: ['food', 'restaurant', 'lifestyle'],
      icons: [
        { src: '/icons/clientes-192.png', sizes: '192x192', type: 'image/png' },
        { src: '/icons/clientes-512.png', sizes: '512x512', type: 'image/png' },
      ],
    },
    themeVariant: 'minimal',
    serviceWorker: {
      cachePrefix: 'rdlc-clientes',
      precacheAssets: ['/clientes/', '/clientes/index.html'],
      networkFirst: ['/api/clientes/', '/api/menu/'],
      cacheFirst: ['/icons/', '/fonts/', '/images/menu/'],
      offlineFallback: '/clientes/offline.html',
    },
  },
};

// ============================================================
// HELPERS
// ============================================================

/** Obtén el registro PWA para un módulo */
export function getPwaRegistration(id: PwaModuleId): PwaRegistration {
  return PWA_REGISTRY[id];
}

/** Obtén todos los manifests para generarlos en build */
export function getAllManifests(): Record<string, PwaManifest> {
  const manifests: Record<string, PwaManifest> = {};
  for (const [id, reg] of Object.entries(PWA_REGISTRY)) {
    manifests[`${id}/manifest.json`] = reg.manifest;
  }
  return manifests;
}

/** Obtén los módulos PWA activos como lista plana */
export function getActivePwaModules(): PwaModule[] {
  return appConfig.all.activeModules;
}
