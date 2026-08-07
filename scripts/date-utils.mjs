/**
 * ═══════════════════════════════════════════════════════════
 *  DATE UTILS (scripts E2E) — "Hoy" en America/La_Paz (2.1)
 *
 *  Mismo bug C1 corregido (server + cliente) pero en los scripts E2E
 *  que corren fuera de Vite: `new Date().toISOString().split('T')[0]`
 *  devuelve la fecha UTC — a las 20:00 local (UTC-4) el reporte del
 *  E2E se correría de día.
 *
 *  Uso:
 *    import { localDateStr } from './date-utils.mjs';
 *    const today = localDateStr(); // 'YYYY-MM-DD' local del negocio
 * ═══════════════════════════════════════════════════════════
 */

/** Zona horaria del negocio (Bolivia, UTC-4, sin DST) */
export const BUSINESS_TIMEZONE = 'America/La_Paz';

/**
 * Fecha local YYYY-MM-DD de America/La_Paz para un Date (default: ahora).
 * @param {Date} [date]
 * @returns {string} 'YYYY-MM-DD' local del negocio
 */
export function localDateStr(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: BUSINESS_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const get = type => (parts.find(p => p.type === type) || {}).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export default localDateStr;
