/**
 * ═══════════════════════════════════════════════════════════
 *  DATE UTILS — "Hoy" en timezone local America/La_Paz (C1)
 *
 *  DECISIÓN DOCUMENTADA (aprobada — Fase 1 caja cuadre al centavo):
 *  - "Hoy" = 00:00–00:00 hora local America/La_Paz (UTC-4, SIN DST).
 *  - La DB guarda timestamps en UTC (`datetime('now')` o
 *    `new Date().toISOString()` — ambos UTC).
 *  - BUG corregido: `new Date().toISOString().split('T')[0]` cortaba a
 *    las 20:00 local (UTC-4) → pagos de 20:00–24:00 caían en el día
 *    siguiente del corte/reporte.
 *  - SOLUCIÓN: offset FIJO '-4 hours' (America/La_Paz no tiene DST →
 *    nunca cambia). En SQL: `DATE(col, '-4 hours')`. En JS:
 *    `Intl.DateTimeFormat(..., { timeZone: 'America/La_Paz' })`.
 *
 *  ÚSALO EN TODOS LOS CORTES/REPORTES (payments.js, reports.js) —
 *  nunca recalcules la fecha local inline.
 * ═══════════════════════════════════════════════════════════
 */

/** Zona horaria del negocio (Bolivia, UTC-4, sin DST) */
export const BUSINESS_TIMEZONE = 'America/La_Paz';

/** Modifier de SQLite: timestamps UTC almacenados → fecha/hora local */
export const SQL_UTC_OFFSET_MODIFIER = '-4 hours';

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

/**
 * Expresión SQL para comparar una columna timestamp UTC contra una
 * fecha local: `DATE(col, '-4 hours')`.
 * @param {string} column — columna timestamp (p.ej. 'p.processed_at')
 * @returns {string} expresión SQL lista para WHERE/GROUP BY
 */
export function localDateExpr(column) {
  return `DATE(${column}, '${SQL_UTC_OFFSET_MODIFIER}')`;
}

/**
 * Expresión SQL para la HORA local de una columna timestamp UTC:
 * `strftime('%H', col, '-4 hours')`.
 * @param {string} column
 * @returns {string}
 */
export function localHourExpr(column) {
  return `strftime('%H', ${column}, '${SQL_UTC_OFFSET_MODIFIER}')`;
}

export default { BUSINESS_TIMEZONE, SQL_UTC_OFFSET_MODIFIER, localDateStr, localDateExpr, localHourExpr };
