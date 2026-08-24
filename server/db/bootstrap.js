/**
 * ═══════════════════════════════════════════════════════════
 *  BOOTSTRAP — Auto-seed del servidor (idempotente)
 *
 *  SOLUCIONA EL BUG: la DB de PROD tenía schema pero CERO staff,
 *  porque el seed era un script manual (node server/db/seed.js)
 *  que nadie ejecutaba al arrancar → login PIN fallaba siempre.
 *
 *  ensureBootstrap(db) se ejecuta en server/index.js justo después
 *  de getDb(). Garantiza una DB usable desde el primer arranque:
 *
 *    1. Si staff está vacío → crea staff (admin/mesero/kds) + mesas
 *    2. Carga el menú REAL (menu-seed.json, única fuente oficial)
 *    3. No aplica precios demo: los precios oficiales vienen del seed
 *
 *  Idempotente: si ya hay datos, no duplica nada ni pisa precios
 *  que el admin haya cambiado. Alineado al SSOT (seed.js /
 *  load-menu.js / demo-prices.js son las fuentes de verdad).
 * ═══════════════════════════════════════════════════════════
 */

import { ensureStaff, ensureTables } from './seed.js';
import { loadMenuFromSeed } from '../scripts/load-menu.js';
import { applyPizzaSizeAdjustments } from '../scripts/demo-prices.js';

/**
 * Ensure the DB is bootstrapped (staff + tables + menu + prices).
 * Safe to call on every server startup.
 *
 * @param {object} db — better-sqlite3 instance
 * @param {{ log?: (msg: string) => void }} [opts]
 * @returns {{ seeded: boolean, steps?: string[], log?: string[] }}
 */
export function ensureBootstrap(db, { log = console.log } = {}) {
  const steps = [];

  // ── 1. Staff + mesas (idempotente) ──────────────────────
  // v5 (S1): ensureStaff corre SIEMPRE (es idempotente por rol). Antes solo
  // corría si staffCount === 0, lo que dejaba DBs existentes SIN el rol 'caja'
  // creado por la v5. Ahora cada arranque garantiza los 4 roles.
  const staffCount = db.prepare('SELECT COUNT(*) AS n FROM staff').get().n;
  const ADMIN_PIN = process.env.ADMIN_PIN || '0000';
  const MESERO_PIN = process.env.MESERO_PIN || '1111';
  const KDS_PIN = process.env.KDS_PIN || '2222';
  const CAJA_PIN = process.env.CAJA_PIN || '3333';
  // ⚠️ M4/2.8: número de mesas. SSOT = src/core/config/app.config.ts
  // (capacity.totalTables = 10). DEFAULT_TABLES es el override de runtime;
  // sin env, el valor DEFAULT debe coincidir con el SSOT (10).
  const defaultTables = parseInt(process.env.DEFAULT_TABLES || '10', 10);

  ensureStaff(db, { pin: ADMIN_PIN, role: 'admin', display_name: 'Administrador' });
  ensureStaff(db, { pin: MESERO_PIN, role: 'mesero', display_name: 'Mesero' });
  ensureStaff(db, { pin: KDS_PIN, role: 'kds', display_name: 'KDS' });
  ensureStaff(db, { pin: CAJA_PIN, role: 'caja', display_name: 'Cajero' });
  const tables = ensureTables(db, defaultTables);

  const staffRoles = db.prepare('SELECT role FROM staff ORDER BY role').all().map(r => r.role);
  if (staffCount === 0) {
    log(`[Bootstrap] Staff creado (admin ${ADMIN_PIN}, mesero ${MESERO_PIN}, kds ${KDS_PIN}, caja ${CAJA_PIN}) + ${tables.created} mesas`);
    steps.push('staff+tables');
  } else {
    log(`[Bootstrap] Staff existente (${staffCount}) — roles asegurados: ${staffRoles.join(', ')}`);
    steps.push('staff-existing');
  }

  // ── 2. Menú real (siempre upsert idempotente) ─────────────
  const categoryCount = db.prepare('SELECT COUNT(*) AS n FROM menu_categories').get().n;
  const menuResult = loadMenuFromSeed(db, { log });
  if (categoryCount === 0) {
    log(`[Bootstrap] Menú real cargado: ${menuResult.itemsCreated} items nuevos`);
    steps.push('menu-loaded');
  } else {
    steps.push('menu-synced');
  }

  // ── 3. Variantes de pizza oficiales — SIEMPRE ────────────
  // load-menu re-upsertea las options en cada arranque y el seed trae
  // Los precios absolutos viven en size_variants y no se generan aquí.
  // applyPizzaSizeAdjustments es idempotente y SOLO toca modifier_options
  // (no pisa precios de items editados por admin). Correr en cada bootstrap.
  try {
    const sizeResult = applyPizzaSizeAdjustments(db, { log });
    steps.push(`size-adjustments:${sizeResult.message}`);
  } catch (sizeErr) {
    log(`[Bootstrap] Error en ajustes de tamaño: ${sizeErr.message}`);
    steps.push('size-adjustments:error');
  }

  const seeded = staffCount === 0;
  log(`[Bootstrap] OK — steps: ${steps.join(', ')}`);
  return { seeded, steps };
}
