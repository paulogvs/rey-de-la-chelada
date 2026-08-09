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

/**
 * Fecha local YYYY-MM-DD de America/La_Paz para un Date (default: ahora).
 * @param date — fecha a convertir (default: ahora)
 * @returns string 'YYYY-MM-DD' local del negocio
 */
export function localDateStr(date: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: BUSINESS_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
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
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: BUSINESS_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
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
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: BUSINESS_TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const get = (type: string) => (parts.find(p => p.type === type) || {}).value;
  return `${get('hour')}:${get('minute')}`;
}

export default localDateStr;
