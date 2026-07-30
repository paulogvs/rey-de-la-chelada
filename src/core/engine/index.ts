/**
 * 🏗️ REY DE LA CHELADA — SSOT Data Engine
 * 
 * Artículo I: SINGLE SOURCE OF TRUTH
 * Every metric, state, or value visible to the user comes from this engine.
 * The UI is ONLY a renderer — NEVER a calculator.
 * 
 * All sub-engines are exposed here as a unified API.
 */

export { default as tableEngine, TableEngine } from './TableEngine';
export { default as menuEngine, MenuEngine } from './MenuEngine';
export { default as orderEngine, OrderEngine } from './OrderEngine';

/**
 * Initialize all engines (called once at app startup)
 * Loads persisted state from localStorage/IndexedDB/PostgreSQL
 */
export function initializeEngines(): void {
  console.log('[Engine] All engines initialized');
  // Phase 2: Load from persistence layer
  // Phase 3: Sync with server
}
