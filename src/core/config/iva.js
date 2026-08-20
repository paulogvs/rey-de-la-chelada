/**
 *  IVA / PRICING SSOT — Single Source of Truth for totals
 *
 *  MODELO AUTORIZADO: "precio INCLUYE IVA" (includedInPrices: true).
 *  Ver `src/core/config/app.config.ts` (taxes.iva.includedInPrices) y
 *  `DESIGN.md`. Los precios del menú YA incluyen el 13% de IVA.
 *
 *  Consecuencia (modelo EXTRACTIVO):
 *    - `total`  = suma de precios del carrito/orden (lo que paga el cliente,
 *                 ya incluye IVA).
 *    - `base`   = total / (1 + IVA_RATE)  → subtotal sin IVA.
 *    - `iva`    = total - base → IVA extraído.
 *
 *  ⚠️ NO usar el modelo ADITIVO (total = subtotal + subtotal*0.13) — eso
 *  duplicaría el IVA cuando los precios ya lo incluyen.
 *
 *  ⚠️ MIGRACIÓN v11 (2026-08-19): REGLA MANDATORIA del ecosistema FORCH.iA
 *  (money-minor-units): TODO dinero se maneja como ENTERO en centavos.
 *  Este módulo trabaja 100% en CENTAVOS (enteros). No hay floats de dinero.
 *  La conversión a decimal solo ocurre en presentación (formatMoney).
 *
 *  Este módulo es JS puro (sin deps) para que lo importen TANTO el
 *  server/ (Node ESM .js) como el client/ (Vite TS, alias @/).
 *  USALO EN TODAS LAS CAPAS: nunca recalcules IVA inline.
 */

/** Tasa de IVA (13%) — SSOT. NO hardcodear 0.13 en otros lugares. */
export const IVA_RATE = 0.13;

/** Redondeo a centavo: entero (ya estamos en centavos). */
export function round2(n) {
  return Math.round(n);
}

/**
 * Descompone un total QUE YA INCLUYE IVA (en CENTAVOS) en
 * { subtotal(base), iva, total } — todos enteros en centavos.
 * @param {number} grossTotalCents — suma de precios en centavos
 * @returns {{ subtotal: number, iva: number, total: number }}
 */
export function computeTotals(grossTotalCents) {
  const total = Math.round(grossTotalCents);
  const base = Math.round(total / (1 + IVA_RATE));
  const iva = total - base;
  return { subtotal: base, iva, total };
}

/** IVA extraído de un monto que ya incluye IVA (centavos). */
export function extractIvaAmount(totalWithIvaCents) {
  return Math.round(totalWithIvaCents - totalWithIvaCents / (1 + IVA_RATE));
}

/** Precio sin IVA dado un precio que ya lo incluye (centavos). */
export function priceWithoutIva(priceWithIvaCents) {
  return Math.round(priceWithIvaCents / (1 + IVA_RATE));
}

/** Bs → centavos (conversión de entrada). Solo para fronteras (inputs/API). */
export function toCents(bs) {
  return Math.round(Number(bs) * 100);
}

/** Centavos → Bs (conversión de salida). SOLO para presentación/CSV. */
export function fromCents(cents) {
  return Number(cents) / 100;
}

export default {
  IVA_RATE,
  round2,
  computeTotals,
  extractIvaAmount,
  priceWithoutIva,
  toCents,
  fromCents,
};