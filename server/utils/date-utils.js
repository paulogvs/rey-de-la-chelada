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

/** Índice del día de la semana: 0=domingo … 6=sábado (español, sin acento) */
export const PROMOTION_DAYS = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];

/**
 * Nombre del día de la semana (español, sin acento) de un businessDayStr.
 * v16 (2026-09-01): se movió aquí desde src/core/config/promotions.js (SSOT
 * eliminado) para que promos-service / routes no dependan del código de
 * promos. Misma función pura: recibe 'YYYY-MM-DD' y devuelve 'domingo'..'sabado'.
 * @param {string} businessDayStr — 'YYYY-MM-DD' del día laboral
 * @returns {string}
 */
export function businessDayName(businessDayStr) {
  const [y, m, d] = String(businessDayStr).split('-').map(Number);
  // Mediodía UTC (mismo patrón que addDaysLocal) — getUTCDay nunca cruza día.
  return PROMOTION_DAYS[new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay()];
}

/** Modifier de SQLite: timestamps UTC almacenados → fecha/hora local */
export const SQL_UTC_OFFSET_MODIFIER = '-4 hours';

// Formatters hoisteados (react-doctor js-hoist-intl): se crean UNA vez al
// cargar el módulo y se reutilizan en cada llamada — construir Intl en cada
// invocación desperdicia CPU en reportes/cortes con muchas filas.
const DATE_FMT = new Intl.DateTimeFormat('en-US', {
  timeZone: BUSINESS_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const DATETIME_FMT = new Intl.DateTimeFormat('en-US', {
  timeZone: BUSINESS_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

const HOUR_FMT = new Intl.DateTimeFormat('en-US', {
  timeZone: BUSINESS_TIMEZONE,
  hour: '2-digit',
  hour12: false,
});

/**
 * Hora local (hora de America/La_Paz, 0-23) en la que inicia el DÍA LABORAL
 * (turno). Fallback 15 (15:00 → el turno termina 06:00 del día siguiente).
 * Patrón DEFAULT_TABLES del repo: env con fallback al valor SSOT.
 * @type {number}
 */
export const BUSINESS_DAY_START_HOUR = Number(process.env.BUSINESS_DAY_START_HOUR) || 15;

/**
 * Fecha local YYYY-MM-DD de America/La_Paz para un Date (default: ahora).
 * @param {Date} [date]
 * @returns {string} 'YYYY-MM-DD' local del negocio
 */
export function localDateStr(date = new Date()) {
  const parts = DATE_FMT.formatToParts(date);
  const get = type => (parts.find(p => p.type === type) || {}).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/**
 * Fecha+hora local 'YYYY-MM-DD HH:mm:ss' de America/La_Paz para un Date.
 * @param {Date} [date]
 * @returns {string} timestamp local del negocio (ej. '2026-08-11 14:30:05')
 */
export function localDateTimeStr(date = new Date()) {
  const parts = DATETIME_FMT.formatToParts(date);
  const get = type => (parts.find(p => p.type === type) || {}).value;
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}:${get('second')}`;
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

/**
 * Hora local 'HH' (0-23) de America/La_Paz para un Date (default: ahora).
 * Helper de partes para businessDayDateStr (misma zona que localDateStr).
 * @param {Date} [date]
 * @returns {string} hora local '00'..'23'
 */
export function localHour(date = new Date()) {
  const parts = HOUR_FMT.formatToParts(date);
  const h = (parts.find(p => p.type === 'hour') || {}).value || '00';
  // Intl puede emitir '24' a medianoche (hourCycle h24) → normalizar a '00'
  return h === '24' ? '00' : h;
}

/**
 * Suma/resta días a una fecha local 'YYYY-MM-DD' y devuelve la fecha local
 * resultante 'YYYY-MM-DD' (mismo formato que localDateStr).
 *
 * IMPORTANTE: usa MEDIODÍA UTC + Date.UTC (NUNCA toISOString, que corta a
 * UTC). A mediodía UTC la fecha local en La Paz (UTC-4 → 08:00 local) nunca
 * cruza de día, así que formatear con el MISMO Intl devuelve el día exacto
 * (a medianoche UTC el formateo caería al día ANTERIOR local).
 * @param {string} dateStr — fecha local 'YYYY-MM-DD'
 * @param {number} deltaDays — días a sumar (negativo = restar)
 * @returns {string}
 */
function shiftLocalDateDays(dateStr, deltaDays) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return localDateStr(new Date(Date.UTC(y, m - 1, d + deltaDays, 12)));
}

/**
 * Fecha 'YYYY-MM-DD' del DÍA LABORAL (turno del negocio) para un Date
 * (default: ahora).
 *
 * Concepto (Opción B — 2026-08-19):
 *   - Timestamp local con hora >= BUSINESS_DAY_START_HOUR (15:00) →
 *     pertenece al día laboral de su fecha local (ej. 15:00 jue → jueves).
 *   - Timestamp local con hora < 15:00 → pertenece al día laboral ANTERIOR
 *     (ej. 03:00 jue → miércoles; 06:00 jue → miércoles = fin del turno).
 *
 * Equivale a businessDayExpr en SQL. ÚSALO en cortes de caja y reportes;
 * localDateStr (calendario) sigue existiendo para el resto.
 * @param {Date} [date]
 * @returns {string} 'YYYY-MM-DD' del día laboral
 */
export function businessDayDateStr(date = new Date()) {
  const local = localDateStr(date);
  if (Number(localHour(date)) < BUSINESS_DAY_START_HOUR) {
    return shiftLocalDateDays(local, -1);
  }
  return local;
}

/**
 * Expresión SQL del DÍA LABORAL para una columna timestamp UTC:
 * `DATE(col, '-4 hours', '-15 hours')` — día laboral: inicia 15:00 →
 * termina a las 06:00 del día siguiente (15:00 → 06:00).
 * NUNCA hardcodear '-19 hours': se calcula desde BUSINESS_DAY_START_HOUR.
 * @param {string} column — columna timestamp (p.ej. 'p.processed_at')
 * @returns {string} expresión SQL lista para WHERE/GROUP BY
 */
export function businessDayExpr(column) {
  return `DATE(${column}, '${SQL_UTC_OFFSET_MODIFIER}', '-${BUSINESS_DAY_START_HOUR} hours')`;
}

export default {
  BUSINESS_TIMEZONE, SQL_UTC_OFFSET_MODIFIER,
  BUSINESS_DAY_START_HOUR,
  PROMOTION_DAYS, businessDayName,
  localDateStr, localDateTimeStr, localDateExpr, localHourExpr, localHour,
  businessDayDateStr, businessDayExpr,
};
