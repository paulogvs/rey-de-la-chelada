/**
 * Vite Configuration — Multi-PWA Build
 *
 * Cada PWA (cocina, bar, meseros, caja, admin, clientes) es un
 * entry point independiente. Todas comparten el mismo motor SSOT.
 *
 * FASE 3 fixes:
 * - injectRegister: 'inline' → sin registerSW.js compartido (evita overwrite)
 * - base/scope por módulo → cada PWA registra su propio sw.js en su ruta
 * - runtimeCaching por método HTTP: GET NetworkFirst(60s), write NetworkOnly, estáticos CacheFirst
 * - Post-build: mueve index.html/offline.html/sw.js a dist/[pwa]/ y
 *   genera manifest.json desde PWA_REGISTRY (SSOT — Artículo I)
 *
 * Build output: dist/[pwa-name]/ con su propio manifest + service worker
 *
 * Artículo I:  SSOT — Un solo build, múltiples PWAs
 * Artículo IV: Simplicidad — Simple rollup input map
 */

import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { PWA_REGISTRY } from './src/core/config/pwa-registry';

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
// Helpers
// ============================================================

/** Hash de contenido (para revisiones de precache) */
function contentHash(filePath: string): string {
  try {
    return crypto.createHash('md5').update(fs.readFileSync(filePath)).digest('hex').slice(0, 10);
  } catch {
    return String(Date.now());
  }
}

/** Entrada de precache con revision para index.html/offline.html */
function precacheEntry(modId: string, fileName: string): { url: string; revision: string } | null {
  const srcFile = path.resolve(__dirname, 'src', 'pwa', modId, fileName);
  if (!fs.existsSync(srcFile)) return null;
  return { url: `${modId}/${fileName}`, revision: contentHash(srcFile) };
}

// ============================================================
// Plugin post-build: estructura final de dist/
// ============================================================
function multiPwaOutput(): Plugin {
  return {
    name: 'rdlc-multi-pwa-output',
    enforce: 'post',
    apply: 'build',
    // sequential: true → corre DESPUÉS de que vite-plugin-pwa (también
    // sequential + post) haya generado los sw.js en closeBundle
    closeBundle: {
      sequential: true,
      handler() {
        const distRoot = path.resolve(__dirname, 'dist');

        // ── 1. Mover HTML + offline.html a dist/[pwa]/ ─────────
        const srcPwaRoot = path.join(distRoot, 'src', 'pwa');
        for (const mod of PWA_MODULES) {
          const destDir = path.join(distRoot, mod.id);
          const srcHtml = path.join(srcPwaRoot, mod.id, 'index.html');
          const srcOffline = path.join(__dirname, 'src', 'pwa', mod.id, 'offline.html');

          if (!fs.existsSync(srcHtml)) continue;

          fs.mkdirSync(destDir, { recursive: true });
          fs.copyFileSync(srcHtml, path.join(destDir, 'index.html'));
          if (fs.existsSync(srcOffline)) {
            fs.copyFileSync(srcOffline, path.join(destDir, 'offline.html'));
          }
        }
        // Limpiar el árbol intermedio dist/src/pwa
        fs.rmSync(path.join(distRoot, 'src'), { recursive: true, force: true });

        // ── 2. Replicar sw.js + workbox chunk en cada PWA ──────
        // Cada módulo emite dist/[id]-sw.js (filename único) → dist/[id]/sw.js
        for (const mod of PWA_MODULES) {
          const modSwSrc = path.join(distRoot, `${mod.id}-sw.js`);
          if (!fs.existsSync(modSwSrc)) continue;
          const destDir = path.join(distRoot, mod.id);
          fs.mkdirSync(destDir, { recursive: true });
          // INYECCIÓN clientsClaim (FIX 2026-08-26): vite-plugin-pwa v1.3 NO
          // añade self.clients.claim() al SW aunque workbox.clientsClaim=true.
          // Sin claim, el SW nuevo no toma control de las pestañas abiertas →
          // el SW viejo (con la caché 401 atrapada) seguía mandando. Inyectamos
          // el handler activate + limpieza de cachés runtime obsoletas.
          let swContent = fs.readFileSync(modSwSrc, 'utf-8');
          if (!swContent.includes('self.clients.claim')) {
            swContent = swContent + [
              '',
              '/** FORCH.iA inyectado: clientsClaim + limpieza cachés runtime obsoletas. */',
              'self.addEventListener("activate",(e)=>{e.waitUntil((async()=>{',
              '  if(!self.clients)return;',
              '  await self.clients.claim();',
              `  const prefix = "${mod.id}-api-";`,
              '  if(!self.caches)return;',
              '  const keys = await self.caches.keys();',
              '  await Promise.all(keys.filter(k=>k.startsWith(prefix)).map(k=>self.caches.delete(k)));',
              '})());});',
              '',
            ].join('\n');
            fs.writeFileSync(modSwSrc, swContent, 'utf-8');
          }
          fs.copyFileSync(modSwSrc, path.join(destDir, 'sw.js'));
          // Chunks de workbox compartidos
          const workboxChunks = fs.readdirSync(distRoot)
            .filter(f => f.startsWith('workbox-') && f.endsWith('.js'));
          for (const chunk of workboxChunks) {
            fs.copyFileSync(path.join(distRoot, chunk), path.join(destDir, chunk));
          }
        }

        // ── 2b. Limpiar SWs raíz (ya replicados por módulo) ────
        for (const mod of PWA_MODULES) {
          const rootSw = path.join(distRoot, `${mod.id}-sw.js`);
          if (fs.existsSync(rootSw)) fs.rmSync(rootSw);
        }
        // Limpiar chunks workbox de la raíz (copiados a cada módulo)
        const rootWorkbox = fs.readdirSync(distRoot)
          .filter(f => f.startsWith('workbox-') && f.endsWith('.js'));
        for (const chunk of rootWorkbox) {
          fs.rmSync(path.join(distRoot, chunk));
        }

        // ── 3. Manifest.json desde PWA_REGISTRY (SSOT) ─────────
        for (const mod of PWA_MODULES) {
          const reg = PWA_REGISTRY[mod.id as keyof typeof PWA_REGISTRY];
          if (!reg) continue;
          const destDir = path.join(distRoot, mod.id);
          fs.mkdirSync(destDir, { recursive: true });
          fs.writeFileSync(
            path.join(destDir, 'manifest.json'),
            JSON.stringify(reg.manifest, null, 2),
            'utf-8',
          );
        }

        // ── 4. Limpieza: registerSW.js sobrante ────────────────
        const leftover = path.join(distRoot, 'registerSW.js');
        if (fs.existsSync(leftover)) fs.rmSync(leftover);
      },
    },
  };
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

    // PWA plugin para cada módulo — scope propio (FASE 3)
    ...PWA_MODULES.map(mod =>
      VitePWA({
    // Scope a este módulo específico: sw.js se sirve en /[pwa]/sw.js
        base: mod.base,
        scope: mod.base,
        includeAssets: ['icons/*.png', 'fonts/*.woff2'],
        manifest: false,      // Lo generamos desde pwa-registry (multiPwaOutput)
        registerType: 'autoUpdate',
        // Registro manual desde bootstrapPwa() (module-scoped) — evita que
        // cada plugin inyecte su registro en TODOS los html
        injectRegister: false,
        // Nombre único por módulo para que cada SW tenga SU precache/runtime
        filename: `${mod.id}-sw.js`,
        workbox: {
          // CRÍTICO (2026-08-26): skipWaiting + clientsClaim → el SW nuevo se
          // activa AL INSTANTE y RECLAMA el control de las pestañas abiertas.
          // Sin clientsClaim, el SW viejo (con la caché 401 atrapada) seguía
          // controlando la página → el usuario no podía entrar sin hard refresh.
          // Con estos dos, el auto-update del deploy aplica SOLO.
          skipWaiting: true,
          clientsClaim: true,
          globPatterns: [`${mod.id}/**/*.{js,css,png,svg}`],
          // navegación NUNCA cache-first: tras un deploy el index.html viejo
          // (con hashes que ya no existen) dejaba al usuario atrapado en la
          // versión vieja con token stale. Prefix con NetworkFirst para que
          // SIEMPRE baje el bundle nuevo y solo caiga a caché/offline si
          // no hay red (los estáticos JS/CSS sí siguen en CacheFirst).
          navigateFallback: `${mod.id}/offline.html`,
          navigateFallbackAllowlist: [new RegExp(`^/${mod.id}/`)],
          // Limpiar caches de precache obsoletos (versiones previas del SW)
          // → el navegador descarta los assets viejos y baja los nuevos.
          cleanupOutdatedCaches: true,
          // Precachear shell (index.html + offline.html) con revision
          additionalManifestEntries: [
            precacheEntry(mod.id, 'index.html'),
            precacheEntry(mod.id, 'offline.html'),
          ].filter((e): e is { url: string; revision: string } => e !== null),
          runtimeCaching: [
            // Navegación (index.html del PWA) → NetworkFirst. Crucial tras un
            // deploy: SIEMPRE intenta la red primero → baja el bundle nuevo.
            // Solo cae a caché si hay error de red (offline). Evita el loop
            // de "versión vieja + token stale" que dejaba al usuario sin entrar.
            {
              urlPattern: ({ request }) => request.mode === 'navigate',
              handler: 'NetworkFirst',
              options: {
                cacheName: `${mod.id}-html`,
                networkTimeoutSeconds: 4,
                expiration: { maxEntries: 5, maxAgeSeconds: 60 * 60 * 24 * 7 },
              },
            },
            // GET /api/* → NetworkOnly (SIEMPRE la red, NUNCA caché).
            // CRÍTICO: antes era NetworkFirst y cacheaba respuestas 401
            // (INVALID_TOKEN) de un token viejo → el SW las reutilizaba aunque
            // el usuario re-logueara con token nuevo → LOOP INFINITO de
            // "Token inválido o expirado". Las APIs son en tiempo real (polling)
            // en un restaurante con red — no necesitan caché, y el polling ya
            // da tolerancia a fallos. NetworkOnly elimina cualquier caché
            // de respuestas de error (401/403/500).
            {
              urlPattern: ({ url, request }) =>
                url.pathname.startsWith('/api/') && request.method === 'GET',
              handler: 'NetworkOnly',
              options: { cacheName: `${mod.id}-api-get` },
            },
            // POST/PUT/DELETE /api/* → NetworkOnly (nunca cachear writes)
            {
              urlPattern: ({ url, request }) =>
                url.pathname.startsWith('/api/') && request.method !== 'GET',
              handler: 'NetworkOnly',
              options: { cacheName: `${mod.id}-api-write` },
            },
            // Estáticos → CacheFirst
            {
              urlPattern: /\.(?:js|css|png|svg|woff2|jpg|jpeg|webp)$/,
              handler: 'CacheFirst',
              options: {
                cacheName: `${mod.id}-static`,
                expiration: {
                  maxEntries: 200,
                  maxAgeSeconds: 60 * 60 * 24 * 30, // 30 días
                },
              },
            },
            // Iconos compartidos → CacheFirst
            {
              urlPattern: /\/icons\//,
              handler: 'CacheFirst',
              options: {
                cacheName: `${mod.id}-icons`,
                expiration: {
                  maxEntries: 30,
                  maxAgeSeconds: 60 * 60 * 24 * 30,
                },
              },
            },
          ],
        },
      })
    ),

    multiPwaOutput(),
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
