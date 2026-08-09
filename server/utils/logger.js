/**
 * ═══════════════════════════════════════════════════════════
 *  LOGGER — App logging con rotación diaria (S1/T2)
 *
 *  Escribe a logs/app-YYYY-MM-DD.log Y a consola (console como respaldo).
 *  Retención: 7 días — prune() borra archivos .log con mtime > 7 días.
 *
 *  Uso:
 *    import { logger } from '../utils/logger.js';
 *    logger.info('mensaje', dato);
 *    logger.warn('cuidado', ...);
 *    logger.error('[Modulo] error:', err.message);
 *
 *  LOG_DIR env → permite apuntar a otra carpeta (tests usan temp dir).
 *  Artículo VI: Observabilidad — fail loud, never silent.
 * ═══════════════════════════════════════════════════════════
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { localDateStr } from '../../scripts/date-utils.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Default: <root>/logs (raíz del proyecto, no server/utils)
export const LOG_DIR = process.env.LOG_DIR
  ? path.resolve(process.env.LOG_DIR)
  : path.resolve(__dirname, '..', '..', 'logs');

export const LOG_RETENTION_DAYS = 7;

/** Crea la carpeta de logs si no existe */
function ensureLogDir() {
  try {
    if (!fs.existsSync(LOG_DIR)) {
      fs.mkdirSync(LOG_DIR, { recursive: true });
    }
  } catch (err) {
    // Nunca romper la app por un problema de logs
    console.error('[Logger] No se pudo crear el directorio de logs:', err?.message);
  }
}

/**
 * Nombre de archivo del día (YYYY-MM-DD local del negocio — America/La_Paz).
 * SSOT: scripts/date-utils.mjs — NUNCA toISOString()/fecha local del sistema.
 * Antes usaba la fecha local del SISTEMA (flaky: los tests esperaban UTC vía
 * toISOString). El contrato de fecha (AGENTS.md §2b) prohíbe UTC para "hoy".
 */
function todayFileName() {
  return `app-${localDateStr()}.log`;
}

function stringifyArg(arg) {
  if (typeof arg === 'string') return arg;
  if (arg instanceof Error) return arg.stack || arg.message;
  try {
    return JSON.stringify(arg);
  } catch {
    return String(arg);
  }
}

/** Escribe una línea al archivo del día + consola */
function write(level, ...args) {
  const line = `[${new Date().toISOString()}] [${level.toUpperCase()}] ${args.map(stringifyArg).join(' ')}`;
  ensureLogDir();
  try {
    fs.appendFileSync(path.join(LOG_DIR, todayFileName()), line + '\n');
  } catch (err) {
    console.error('[Logger] No se pudo escribir al log:', err?.message);
  }
  // Consola como respaldo (fail loud en terminal también)
  const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  fn(line);
}

/** Borra logs con mtime > LOG_RETENTION_DAYS días (llamar al arranque) */
export function pruneOldLogs() {
  let files;
  try {
    ensureLogDir();
    files = fs.readdirSync(LOG_DIR);
  } catch {
    return;
  }
  const cutoff = Date.now() - LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  let removed = 0;
  for (const file of files) {
    if (!file.endsWith('.log')) continue;
    try {
      const full = path.join(LOG_DIR, file);
      const stat = fs.statSync(full);
      if (stat.mtimeMs < cutoff) {
        fs.unlinkSync(full);
        removed++;
      }
    } catch {
      // archivo en uso / borrado concurrente — ignorar
    }
  }
  if (removed > 0) {
    write('info', `[Logger] prune: ${removed} log(s) antiguo(s) eliminado(s) (>${LOG_RETENTION_DAYS} días)`);
  }
}

export const logger = {
  info: (...args) => write('info', ...args),
  warn: (...args) => write('warn', ...args),
  error: (...args) => write('error', ...args),
  prune: pruneOldLogs,
  getLogDir: () => LOG_DIR,
};

export default logger;
