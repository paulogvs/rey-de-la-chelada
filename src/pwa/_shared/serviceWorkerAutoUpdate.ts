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

  // Recargar UNA vez cuando el SW nuevo toma el control
  let refreshing = false;
  navigatorObj.addEventListener('controllerchange', () => {
    if (refreshing) return;
    refreshing = true;
    windowObj.location.reload();
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
