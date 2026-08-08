/**
 * 🏗️ REY DE LA CHELADA — SSOT Data Engine
 * 
 * Artículo I: SINGLE SOURCE OF TRUTH
 * Every metric, state, or value visible to the user comes from this engine.
 * The UI is ONLY a renderer — NEVER a calculator.
 * 
 * All sub-engines are exposed here as a unified API.
 *
 * ⚠️ LEGACY (FASE 2, 2.8/M6): El SSOT real de producción es el SERVIDOR
 * (Express + SQLite + API REST). Este módulo cliente es legacy de la fase
 * inicial:
 *   - `initializeEngines()` NUNCA se invoca en las PWAs productivas.
 *   - `tableEngine`/`menuEngine` ya NO alimentan pantallas productivas
 *     (meseros usa useTables→API; clientes/meseros usan menuApi→API).
 *   - `orderEngine` sigue VIVO (KDS + useKDSWebSocket + useTableSession),
 *     pero como caché/estado local alimentado por el servidor, NO como
 *     fuente de verdad.
 * Mantener SOLO lo que se usa; eliminar el resto en una refactor futura.
 */

export { default as tableEngine, TableEngine } from './TableEngine';
export { default as menuEngine, MenuEngine } from './MenuEngine';
export { default as orderEngine, OrderEngine } from './OrderEngine';

/**
 * Initialize all engines (called once at app startup)
 * Loads persisted state from localStorage/IndexedDB/PostgreSQL
 */
export async function initializeEngines(): Promise<void> {
  // Load seed menu data (first-time setup)
  try {
    const { loadSeedToEngine } = await import('@/core/data/data-loader');
    loadSeedToEngine();
  } catch {
    console.warn('[Engine] Seed data load skipped (will load from DB in production)');
  }
  console.log('[Engine] All engines initialized');
  // Phase 2: Load from persistence layer (future)
  // Phase 3: Sync with server (future)
}
