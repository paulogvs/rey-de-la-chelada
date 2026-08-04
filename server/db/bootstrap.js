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
 *    2. Carga el menú REAL (menu-seed.json → 49 items)
 *    3. Aplica precios demo (si los items no tienen precio)
 *
 *  Idempotente: si ya hay datos, no duplica nada ni pisa precios
 *  que el admin haya cambiado. Alineado al SSOT (seed.js /
 *  load-menu.js / demo-prices.js son las fuentes de verdad).
 * ═══════════════════════════════════════════════════════════
 */

import { ensureStaff, ensureTables } from './seed.js';
import { loadMenuFromSeed } from '../scripts/load-menu.js';
import { applyDemoPrices } from '../scripts/demo-prices.js';

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

  // ── 1. Staff + mesas (solo si no existen) ────────────────
  const staffCount = db.prepare('SELECT COUNT(*) AS n FROM staff').get().n;
  if (staffCount === 0) {
    const ADMIN_PIN = process.env.ADMIN_PIN || '0000';
    const MESERO_PIN = process.env.MESERO_PIN || '1111';
    const KDS_PIN = process.env.KDS_PIN || '2222';
    const defaultTables = parseInt(process.env.DEFAULT_TABLES || '10', 10);

    ensureStaff(db, { pin: ADMIN_PIN, role: 'admin', display_name: 'Administrador' });
    ensureStaff(db, { pin: MESERO_PIN, role: 'mesero', display_name: 'Mesero' });
    ensureStaff(db, { pin: KDS_PIN, role: 'kds', display_name: 'KDS' });
    const tables = ensureTables(db, defaultTables);

    log(`[Bootstrap] Staff creado (admin ${ADMIN_PIN}, mesero ${MESERO_PIN}, kds ${KDS_PIN}) + ${tables.created} mesas`);
    steps.push(`staff+tables`);
  } else {
    log(`[Bootstrap] Staff ya existe (${staffCount}) — skip`);
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

  // ── 3. Precios demo (solo si hay items sin precio) ────────
  const nullPriceCount = db.prepare('SELECT COUNT(*) AS n FROM menu_items WHERE price IS NULL').get().n;
  if (nullPriceCount > 0) {
    applyDemoPrices(db, { log });
    log(`[Bootstrap] Precios demo aplicados a ${nullPriceCount} items`);
    steps.push('prices-applied');
  } else {
    log(`[Bootstrap] Todos los items ya tienen precio — skip`);
    steps.push('prices-existing');
  }

  const seeded = staffCount === 0;
  log(`[Bootstrap] OK — steps: ${steps.join(', ')}`);
  return { seeded, steps };
}
