/**
 * ═══════════════════════════════════════════════════════════
 *  IVA / PRICING SSOT — Single Source of Truth for totals
 *
 *  MODELO AUTORIZADO: "precio INCLUYE IVA" (includedInPrices: true).
 *  Ver `src/core/config/app.config.ts` (taxes.iva.includedInPrices) y
 *  `DESIGN.md`. Los precios del menú YA incluyen el 13% de IVA.
 *
 *  Consecuencia (modelo EXTRACTIVO):
 *    - `total`  = suma de precios del carrito/orden (QUÉ PAGA EL CLIENTE,
 *                 ya incluye IVA).
 *    - `base`   = total / (1 + IVA_RATE)  → subtotal sin IVA.
 *    - `iva`    = total - base → IVA extraído.
 *
 *  ⚠️ NO usar el modelo ADITIVO (total = subtotal + subtotal*0.13) — eso
 *  duplicaría el IVA cuando los precios ya lo incluyen.
 *
 *  Este módulo es JS puro (sin deps) para que lo importen TANTO el
 *  server/ (Node ESM .js) como el client/ (Vite TS, alias @/).
 *  ÚSALO EN TODAS LAS CAPAS: nunca recalcules IVA inline.
 * ═══════════════════════════════════════════════════════════
 */

/** Tasa de IVA (13%) — SSOT. NO hardcodear 0.13 en otros lugares. */
export const IVA_RATE = 0.13;

export function round2(n) {
  return Math.round(n * 100) / 100;
}

/**
 * Descompone un total QUE YA INCLUYE IVA en { subtotal(base), iva, total }.
 * @param {number} grossTotal — suma de precios (ya incluye IVA)
 * @returns {{ subtotal: number, iva: number, total: number }}
 */
export function computeTotals(grossTotal) {
  const total = round2(grossTotal);
  const base = round2(total / (1 + IVA_RATE));
  const iva = round2(total - base);
  return { subtotal: base, iva, total };
}

/** IVA extraído de un monto que ya incluye IVA. */
export function extractIvaAmount(totalWithIva) {
  return round2(totalWithIva - totalWithIva / (1 + IVA_RATE));
}

/** Precio sin IVA dado un precio que ya lo incluye. */
export function priceWithoutIva(priceWithIva) {
  return round2(priceWithIva / (1 + IVA_RATE));
}

export default {
  IVA_RATE,
  round2,
  computeTotals,
  extractIvaAmount,
  priceWithoutIva,
};
