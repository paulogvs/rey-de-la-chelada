/**
 * Shared client date utils — "hoy" local America/La_Paz (2.1)
 *
 * Wrapper TS del mismo Intl.DateTimeFormat con timeZone 'America/La_Paz'
 * que usa el server (server/utils/date-utils.js). La implementación vive
 * en src/core/config/local-date.ts para que OrderEngine (core) la importe
 * sin depender de capas PWA; aquí la re-exportamos para los componentes.
 *
 * Uso:
 *   import { localDateStr } from '../_shared/utils/localDate';
 *   const today = localDateStr(); // 'YYYY-MM-DD' local del negocio
 */

export { BUSINESS_TIMEZONE, localDateStr } from '@/core/config/local-date';
export { default } from '@/core/config/local-date';
