/**
 * Vite Configuration — Multi-PWA Build
 *
 * Cada PWA (cocina, bar, meseros, caja, admin, clientes) es un
 * entry point independiente. Todas comparten el mismo motor SSOT.
 *
 * Build output: dist/[pwa-name]/ con su propio manifest + service worker
 *
 * Artículo I:  SSOT — Un solo build, múltiples PWAs
 * Artículo IV: Simplicidad — Simple rollup input map
 */

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

// ============================================================
// PWA Modules (from our registry — source of truth)
// ============================================================
const PWA_MODULES = [
  { id: 'clientes', base: '/clientes/' },
  { id: 'cocina',   base: '/cocina/' },
  { id: 'bar',      base: '/bar/' },
  { id: 'meseros',  base: '/meseros/' },
  { id: 'caja',     base: '/caja/' },
  { id: 'admin',    base: '/admin/' },
];

// ============================================================
// Rollup Input Map — Generado dinámicamente
// ============================================================
const rollupInput: Record<string, string> = {};
for (const mod of PWA_MODULES) {
  rollupInput[mod.id] = `src/pwa/${mod.id}/index.html`;
}

// ============================================================
// Export Vite Config
// ============================================================
export default defineConfig({
  // Multi-page app: cada PWA es un entry point
  appType: 'mpa',
  root: '.',

  plugins: [
    react(),

    // PWA plugin para cada módulo
    ...PWA_MODULES.map(mod =>
      VitePWA({
        // Scope a este módulo específico
        includeAssets: ['icons/*.png', 'fonts/*.woff2'],
        manifest: false,      // Lo generamos manualmente desde pwa-registry
        registerType: 'autoUpdate',
        workbox: {
          globPatterns: [`${mod.id}/**/*.{js,css,html,png,svg}`],
          navigateFallback: `${mod.id}/offline.html`,
          runtimeCaching: [
            {
              urlPattern: /\/api\//,
              handler: 'NetworkFirst',
              options: { cacheName: `${mod.id}-api` },
            },
            {
              urlPattern: /\/icons\//,
              handler: 'CacheFirst',
              options: { cacheName: `${mod.id}-icons` },
            },
          ],
        },
      })
    ),
  ],

  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },

  build: {
    outDir: 'dist',
    // Genera carpetas separadas por PWA
    rollupOptions: {
      input: rollupInput,
      output: {
        // Cada PWA en su propia carpeta
        entryFileNames: chunkInfo => {
          const mod = PWA_MODULES.find(m => chunkInfo.name.startsWith(m.id));
          return mod ? `${mod.id}/assets/[name]-[hash].js` : `assets/[name]-[hash].js`;
        },
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: assetInfo => {
          if (assetInfo.name?.endsWith('.css')) {
            const mod = PWA_MODULES.find(m => assetInfo.name?.startsWith(m.id));
            return mod ? `${mod.id}/assets/[name]-[hash].css` : `assets/[name]-[hash].css`;
          }
          return 'assets/[name]-[hash][extname]';
        },
      },
    },
  },

  server: {
    port: 3001,
    strictPort: true,
  },
});
