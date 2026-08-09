/**
 * T2 — Logger de app con rotación diaria
 *
 * logger.info/warn/error escribe a logs/app-YYYY-MM-DD.log Y a consola.
 * prune() retiene solo los últimos 7 días (borra logs viejos).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import { localDateStr } from '../../scripts/date-utils.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let tempLogDir;
let logger;

beforeEach(async () => {
  tempLogDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rdlc-logger-'));
  process.env.LOG_DIR = tempLogDir;
  // Import limpio del módulo (lee LOG_DIR en import time) — resetModules
  // fuerza un módulo fresco por test (LOG_DIR se captura al importar).
  vi.resetModules();
  logger = await import('../../server/utils/logger.js');
});

afterEach(() => {
  try { fs.rmSync(tempLogDir, { recursive: true, force: true }); } catch { /* noop */ }
  delete process.env.LOG_DIR;
});

function todayLogFile() {
  // SSOT: MISMA fecha local America/La_Paz que usa el logger (bonus de
  // auditoría — antes usaba UTC vía toISOString y flakeaba al amanecer).
  const day = localDateStr();
  return path.join(tempLogDir, `app-${day}.log`);
}

describe('Logger', () => {
  it('info escribe una línea al archivo del día con el mensaje', () => {
    logger.logger.info('hola mundo', 42);
    const content = fs.readFileSync(todayLogFile(), 'utf8');
    expect(content).toContain('hola mundo');
    expect(content).toContain('[INFO]');
  });

  it('error escribe el mensaje y mantiene el console como respaldo', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    logger.logger.error('[Test] algo falló');
    const content = fs.readFileSync(todayLogFile(), 'utf8');
    expect(content).toContain('[ERROR]');
    expect(content).toContain('algo falló');
    expect(errSpy).toHaveBeenCalled();
  });

  it('warn escribe al archivo', () => {
    logger.logger.warn('cuidado');
    const content = fs.readFileSync(todayLogFile(), 'utf8');
    expect(content).toContain('[WARN]');
    expect(content).toContain('cuidado');
  });

  it('prune() borra logs de más de 7 días y conserva los recientes', () => {
    logger.logger.info('hoy');
    const oldFile = path.join(tempLogDir, 'app-2020-01-01.log');
    fs.writeFileSync(oldFile, 'viejo');
    const cutoff = Date.now() - 8 * 24 * 60 * 60 * 1000;
    fs.utimesSync(oldFile, new Date(cutoff), new Date(cutoff));

    logger.logger.prune();

    expect(fs.existsSync(oldFile)).toBe(false);
    expect(fs.existsSync(todayLogFile())).toBe(true);
  });

  it('crea la carpeta logs si no existe', async () => {
    // El dir temp ya existe; forzamos una subcarpeta inexistente
    const nested = path.join(tempLogDir, 'nested');
    delete process.env.LOG_DIR;
    process.env.LOG_DIR = nested;
    vi.resetModules();
    const fresh = await import('../../server/utils/logger.js');
    fresh.logger.info('crea dir');
    expect(fs.existsSync(path.join(nested, `app-${localDateStr()}.log`))).toBe(true);
  });
});
