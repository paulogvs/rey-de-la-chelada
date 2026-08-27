/**
 * Service Worker — Registro con auto-actualización (PWA clientes y staff)
 *
 * FIX "pantalla café": un SW viejo en caché sirve un index.html con hashes
 * de assets que ya no existen en el servidor → React nunca monta.
 *
 * Este módulo registra el SW y aplica el patrón estándar de auto-update:
 *   1. Si hay un SW nuevo esperando (waiting) → postMessage SKIP_WAITING
 *   2. Si se detecta una actualización → activarla al instalarse
 *   3. Cuando el SW nuevo toma control → recargar UNA vez
 *
 * Puro e inyectable para poder testearlo sin navegador (TDD).
 */

/** Forma mínima de un ServiceWorker (compatible con el DOM real y con mocks de test) */
export interface SwWorkerLike {
  postMessage: (message: unknown) => void;
  state?: string;
  addEventListener: (type: string, listener: () => void) => void;
}

export interface SwRegistrationLike {
  waiting: SwWorkerLike | null;
  installing: SwWorkerLike | null;
  addEventListener: (type: string, listener: () => void) => void;
  update: () => Promise<unknown>;
}

export interface ServiceWorkerNavigatorLike {
  register: (script: string, opts?: { scope?: string }) => Promise<SwRegistrationLike>;
  controller: unknown;
  addEventListener: (type: 'controllerchange', listener: () => void) => void;
}

export interface WindowLike {
  location: { reload: () => void };
  caches?: { keys: () => Promise<string[]>; delete: (key: string) => Promise<boolean> };
}

/**
 * Borra las cachés de RUNTIME del módulo (no el precache). CRÍTICO: el SW
 * viejo (NetworkFirst) cacheaba respuestas 401 de un token stale en la caché
 * `${moduleId}-api-get` — incluso con NetworkOnly, esa caché vieja persistía y
 * el SW la reutilizaba (sin clientsClaim antes, ni siquiera tomaba control).
 * Al tomar control el SW nuevo, limpiamos esas cachés para que el 401 atrapado
 * desaparezca y el token nuevo funcione sin hard refresh.
 */
export async function clearRuntimeCaches(moduleId: string, windowObj: WindowLike): Promise<void> {
  const caches = windowObj.caches;
  if (!caches) return;
  try {
    const keys = await caches.keys();
    // La caché de runtime lleva el prefijo del módulo + "-api-get"/"-api-write".
    // Nunca borra el precache ni las de otros módulos.
    const runtimeCacheName = `${moduleId}-api-`;
    const stale = keys.filter(k => k.startsWith(runtimeCacheName));
    await Promise.all(stale.map(k => caches.delete(k)));
  } catch (err) {
    console.warn(`[PWA] No se pudieron limpiar cachés runtime (${moduleId}):`, err);
  }
}

/** Registra el SW y aplica el patrón de auto-actualización. Devuelve la registration. */
export async function registerServiceWorkerWithAutoUpdate(
  moduleId: string,
  navigatorObj: ServiceWorkerNavigatorLike,
  windowObj: WindowLike
): Promise<SwRegistrationLike> {
  const registration = await navigatorObj.register(`/${moduleId}/sw.js`, {
    scope: `/${moduleId}/`,
  });

  // Recargar UNA vez cuando el SW nuevo toma el control. ANTES de recargar,
  // limpiar las cachés runtime obsoletas (con el 401 atrapado) del módulo.
  // Si `window.caches` no existe (o no hay cachés que limpiar), recargamos
  // síncronamente para mantener el contrato del test (recarga única inmediata).
  let refreshing = false;
  navigatorObj.addEventListener('controllerchange', () => {
    if (refreshing) return;
    refreshing = true;
    const cleanup = windowObj.caches
      ? clearRuntimeCaches(moduleId, windowObj).finally(() => windowObj.location.reload())
      : windowObj.location.reload();
    void cleanup;
  });

  // Si ya hay un SW nuevo esperando (build anterior pendiente), activarlo
  if (registration.waiting) {
    registration.waiting.postMessage({ type: 'SKIP_WAITING' });
  }

  // Cuando se detecta una actualización, activarla al instalarse
  registration.addEventListener('updatefound', () => {
    const newWorker = registration.installing;
    if (!newWorker) return;
    newWorker.addEventListener('statechange', () => {
      if (newWorker.state === 'installed' && navigatorObj.controller) {
        newWorker.postMessage({ type: 'SKIP_WAITING' });
      }
    });
  });

  // Verificar actualizaciones al cargar (si ya estamos controlados)
  if (navigatorObj.controller) {
    registration.update().catch(() => {});
  }

  return registration;
}
