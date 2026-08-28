/**
 * printer.js — Impresión térmica server-side (Windows).
 *
 * v1 (2026-08-28): reemplaza el stub client-side de usePrinter.ts.
 * Flujo: ticket-escp.js genera bytes → este servicio escribe un .bin
 * temporal → scripts/print-raw.ps1 (P/Invoke winspool) envía los bytes
 * RAW a la impresora predeterminada de Windows (o la configurada).
 *
 * El usuario solo configura la impresora en Windows; si la deja por
 * defecto, aquí se detecta automáticamente.
 */

import { execFile } from 'node:child_process';
import { writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { getSetting } from './settings.js';

const PS1 = join(process.cwd(), 'scripts', 'print-raw.ps1');

/**
 * Nombre de impresora efectivo: settings.printer_name > env PRINTER_NAME > '' (default Windows).
 */
export function getEffectivePrinterName() {
  return getSetting('printer_name') || process.env.PRINTER_NAME || '';
}

/**
 * Envía bytes ESC/POS crudos a la impresora.
 * @param {Uint8Array|Buffer} bytes
 * @param {string} [printerName]  nombre explícito; vacío = predeterminada Windows
 * @returns {Promise<{ok: boolean, message: string}>}
 */
export function printRaw(bytes, printerName = getEffectivePrinterName()) {
  return new Promise((resolve) => {
    const tmpFile = join(tmpdir(), `rdc-print-${randomUUID()}.bin`);
    try {
      writeFileSync(tmpFile, Buffer.from(bytes));
    } catch (err) {
      resolve({ ok: false, message: `No se pudo escribir el archivo temporal: ${err.message}` });
      return;
    }

    const args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', PS1, '-File', tmpFile];
    if (printerName) args.push('-PrinterName', printerName);

    execFile('powershell.exe', args, { timeout: 30000, windowsHide: true }, (err, stdout, stderr) => {
      try { unlinkSync(tmpFile); } catch { /* best-effort */ }
      if (err) {
        // Extraer solo la línea con el mensaje real (el stderr de PowerShell
        // incluye ruido: "En ... Caracter", CategoryInfo, FullyQualifiedErrorId).
        const lines = (stderr || stdout || '').split(/\r?\n/);
        const msg = lines.find((l) => l.includes('ERROR:')) || lines[lines.length - 1] || err.message;
        resolve({ ok: false, message: msg.replace(/^.*?ERROR:\s*/, '').trim() });
        return;
      }
      resolve({ ok: true, message: (stdout || '').trim() || 'Impreso correctamente' });
    });
  });
}

export default { getEffectivePrinterName, printRaw };