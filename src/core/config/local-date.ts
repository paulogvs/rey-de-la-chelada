/**
 * ═══════════════════════════════════════════════════════════
 *  LOCAL DATE (cliente/core) — "Hoy" en America/La_Paz (2.1)
 *
 *  Mismo bug C1 corregido en el server (server/utils/date-utils.js)
 *  pero del lado CLIENTE: `new Date().toISOString().split('T')[0]`
 *  devuelve la fecha UTC — a las 20:00 local (UTC-4) el "hoy" del
 *  dashboard/corte ya es "mañana".
 *
 *  SOLUCIÓN: Intl.DateTimeFormat con timeZone fija 'America/La_Paz'
 *  (UTC-4, sin DST → nunca cambia). MISMO comportamiento que el
 *  helper del server.
 *
 *  Regla: SIEMPRE que un componente PWA o engine necesite "hoy local",
 *  importa localDateStr de aquí (o de '@/pwa/_shared/utils/localDate').
 *  NUNCA recalcules con toISOString().split('T')[0].
 * ═══════════════════════════════════════════════════════════
 */

/** Zona horaria del negocio (Bolivia, UTC-4, sin DST) */
export const BUSINESS_TIMEZONE = 'America/La_Paz';

/** Índice del día de la semana: 0=domingo … 6=sábado (español, sin acento) */
export const PROMOTION_DAYS = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];

/**
 * Nombre del día de la semana (español, sin acento) de un businessDayStr.
 * v16 (2026-09-01): se movió aquí desde src/core/config/promotions.js (SSOT
 * eliminado) para que los hooks (useActivePromos / PromotionsToday) no
 * dependan del código de promos. Misma función pura que el server
 * (server/utils/date-utils.js, sync manual).
 * @param dateStr — 'YYYY-MM-DD' del día laboral
 * @returns string 'domingo'..'sabado'
 */
export function businessDayName(dateStr: string): string {
  const [y, m, d] = String(dateStr).split('-').map(Number);
  return PROMOTION_DAYS[new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay()];
}

// Formatters hoisteados (react-doctor js-hoist-intl): se crean UNA vez al
// cargar el módulo. Construir Intl en cada llamada desperdicia CPU, sobre
// todo en cortes/reportes y render de componentes que formatean fechas.
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
  hour12: false,
});

const TIME_FMT = new Intl.DateTimeFormat('en-US', {
  timeZone: BUSINESS_TIMEZONE,
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

const HOUR_FMT = new Intl.DateTimeFormat('en-US', {
  timeZone: BUSINESS_TIMEZONE,
  hour: '2-digit',
  hour12: false,
});

/**
 * Hora local en la que inicia el DÍA LABORAL (turno 15:00 → termina 06:00
 * del día siguiente). DEBE coincidir con server/utils/date-utils.js
 * BUSINESS_DAY_START_HOUR (env con fallback 15) — se mantienen en sync
 * manualmente, igual que hoy con la zona horaria.
 */
export const BUSINESS_DAY_START_HOUR = 15;

/**
 * Fecha local YYYY-MM-DD de America/La_Paz para un Date (default: ahora).
 * @param date — fecha a convertir (default: ahora)
 * @returns string 'YYYY-MM-DD' local del negocio
 */
export function localDateStr(date: Date = new Date()): string {
  const parts = DATE_FMT.formatToParts(date);
  const get = (type: string) => (parts.find(p => p.type === type) || {}).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/**
 * Fecha + hora local 'DD/MM/YYYY HH:mm' de America/La_Paz (P1-1).
 * Fijo al timeZone del negocio — NO depende del locale del navegador.
 * @param date — fecha a convertir (default: ahora)
 * @returns string 'DD/MM/YYYY HH:mm' local del negocio
 */
export function localDateTimeStr(date: Date = new Date()): string {
  const parts = DATETIME_FMT.formatToParts(date);
  const get = (type: string) => (parts.find(p => p.type === type) || {}).value;
  return `${get('day')}/${get('month')}/${get('year')} ${get('hour')}:${get('minute')}`;
}

/**
 * Hora local 'HH:mm' de America/La_Paz (P1-1).
 * Fijo al timeZone del negocio — NO depende del locale del navegador.
 * @param date — fecha a convertir (default: ahora)
 * @returns string 'HH:mm' local del negocio
 */
export function localTimeStr(date: Date = new Date()): string {
  const parts = TIME_FMT.formatToParts(date);
  const get = (type: string) => (parts.find(p => p.type === type) || {}).value;
  return `${get('hour')}:${get('minute')}`;
}

/**
 * Hora local 'HH' (0-23) de America/La_Paz (default: ahora).
 * @param date — fecha a convertir (default: ahora)
 * @returns string hora local '00'..'23'
 */
export function localHour(date: Date = new Date()): string {
  const parts = HOUR_FMT.formatToParts(date);
  const h = parts.find(p => p.type === 'hour')?.value || '00';
  // Intl puede emitir '24' a medianoche (hourCycle h24) → normalizar a '00'
  return h === '24' ? '00' : h;
}

/**
 * Suma/resta días a una fecha local 'YYYY-MM-DD' y devuelve la fecha local
 * resultante (mismo formato que localDateStr). Usa MEDIODÍA UTC + Date.UTC
 * (NUNCA toISOString): a mediodía UTC la fecha local en La Paz (UTC-4 →
 * 08:00 local) nunca cruza de día, así que formatear con el MISMO Intl
 * devuelve el día exacto.
 * @param dateStr — fecha local 'YYYY-MM-DD'
 * @param deltaDays — días a sumar (negativo = restar)
 * @returns string 'YYYY-MM-DD' local
 */
export function addDaysLocal(dateStr: string, deltaDays: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  return localDateStr(new Date(Date.UTC(y, m - 1, d + deltaDays, 12)));
}

/**
 * Fecha 'YYYY-MM-DD' del DÍA LABORAL (turno del negocio) para un Date
 * (default: ahora).
 *
 * Concepto (Opción B — 2026-08-19): "hoy" para cortes/reportes.
 *   - Hora local >= 15:00 → pertenece al día laboral de su fecha local.
 *   - Hora local < 15:00 → pertenece al día laboral ANTERIOR
 *     (ej. 03:00 jue → miércoles; 06:00 jue → miércoles = fin del turno).
 *
 * Misma lógica que server/utils/date-utils.js businessDayDateStr (sync manual).
 * localDateStr (calendario) sigue existiendo para pedidos/meseros.
 * @param date — fecha a convertir (default: ahora)
 * @returns string 'YYYY-MM-DD' del día laboral
 */
export function businessDayDateStr(date: Date = new Date()): string {
  const local = localDateStr(date);
  if (Number(localHour(date)) < BUSINESS_DAY_START_HOUR) {
    return addDaysLocal(local, -1);
  }
  return local;
}

export default localDateStr;
