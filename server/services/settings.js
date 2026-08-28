/**
 * settings.js — Configuración del restaurante persistida en DB (tabla `settings`).
 *
 * v14 (2026-08-28): onboarding NIT/IVA/impresora sin tocar código.
 * Los valores DB ganan sobre el SSOT app.config (que queda como fallback).
 *
 * Keys soportadas (valores string):
 *   nit, business_name, address, phone, slogan, iva_rate,
 *   printer_name (vacío = impresora predeterminada de Windows),
 *   paper_width ('58mm'|'80mm')
 */

import { getDb } from '../db/index.js';

export const SETTING_KEYS = [
  'nit',
  'business_name',
  'address',
  'phone',
  'slogan',
  'iva_rate',
  'printer_name',
  'paper_width',
];

export function getAllSettings() {
  const db = getDb();
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const out = {};
  for (const r of rows) out[r.key] = r.value;
  return out;
}

export function getSetting(key) {
  const db = getDb();
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : null;
}

/**
 * Guarda un conjunto de settings (upsert). Ignora keys desconocidas
 * (fail-loud: avisa en consola) y normaliza vacíos.
 * @returns {object} settings actualizados completos
 */
export function updateSettings(patch) {
  const db = getDb();
  const upsert = db.prepare(`
    INSERT INTO settings (key, value, updated_at)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')
  `);
  const tx = db.transaction((entries) => {
    for (const [k, v] of entries) upsert.run(k, String(v ?? ''));
  });

  const entries = [];
  for (const [k, v] of Object.entries(patch)) {
    if (!SETTING_KEYS.includes(k)) {
      console.warn(`[Settings] Ignorando key desconocida: ${k}`);
      continue;
    }
    entries.push([k, v]);
  }
  if (entries.length > 0) tx(entries);
  return getAllSettings();
}

export function getEffectiveBusiness() {
  const s = getAllSettings();
  return {
    name: s.business_name || 'Rey de la Chelada',
    slogan: s.slogan || '',
    address: s.address || '',
    phone: s.phone || '',
    nit: s.nit || '',
  };
}

export function getEffectiveTaxConfig() {
  const s = getAllSettings();
  const rate = Number(s.iva_rate);
  return {
    iva: { percentage: Number.isFinite(rate) && rate > 0 ? rate : 13 },
  };
}

export function getEffectivePaperSize() {
  const s = getAllSettings();
  return s.paper_width === '58mm' ? '58mm' : '80mm';
}

export default {
  SETTING_KEYS,
  getAllSettings,
  getSetting,
  updateSettings,
  getEffectiveBusiness,
  getEffectiveTaxConfig,
  getEffectivePaperSize,
};