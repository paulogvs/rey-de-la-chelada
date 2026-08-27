/**
 * format.ts — Formateo de moneda centralizado (SSOT)
 *
 * ═══════════════════════════════════════════════════════════
 *  CONTRATO DE CENTAVOS (migración autorizada)
 *  Todo valor monetario interno y de API es un ENTERO en centavos:
 *    Bs 10.50 → 1050
 *  La conversión a decimal SOLO ocurre en presentación:
 *    - `formatMoney(cents)`  → "Bs 12,50"  (display humano)
 *    - `fromCents(cents)`    → 12.5        (decimal, SOLO CSV/recibos/máquinas)
 *    - `toCents(bs)`         → 1250        (entrada desde decimal, ej. seeds)
 *    - `parseMoneyInput(raw)`→ 1250        (entero en centavos, input usuario)
 *  ⚠️ La lógica interna SIEMPRE usa enteros en centavos; nunca redondees
 *  en decimal salvo en la frontera de presentación (formatMoney/fromCents).
 * ═══════════════════════════════════════════════════════════
 *
 * Decisión del dueño (FASE B): moneda unificada a `"Bs 12,50"`
 *   - coma decimal (convención boliviana)
 *   - SIN separador de miles
 *   - "Bs" sin punto (el símbolo config es `Bs`)
 *
 * `parseMoneyInput` normaliza la entrada del teclado (MoneyInput):
 *   - "," y "." son SIEMPRE decimal (teclado numérico o teclado físico)
 *   - nunca se aceptan separadores de miles
 *   - devuelve el monto en CENTAVOS (entero)
 *
 * IMPORTANTE: NO usar estos helpers en `csvExport.ts` — el CSV debe seguir
 * con punto decimal y formato de máquina (Excel/consumidores lo parsean
 * numéricamente). Aquí el objetivo es DISPLAY humano.
 */

/**
 * Convierte un monto en Bs (decimal) a centavos (entero).
 * @param bs monto en bolivianos decimal (ej. 12.5)
 * @returns centavos enteros (ej. 1250)
 */
export function toCents(bs: number): number {
  return Math.round(bs * 100);
}

/**
 * Convierte centavos (entero) a Bs decimal.
 * SOLO para display/CSV/recibos — NUNCA para lógica interna.
 * @param cents centavos enteros (ej. 1250)
 * @returns bolivianos decimal (ej. 12.5)
 */
export function fromCents(cents: number): number {
  return cents / 100;
}

/** Formatea un monto en CENTAVOS a "Bs 12,50" (coma decimal, sin miles). */
export function formatMoney(cents: number): string {
  const n = Number.isFinite(cents) ? cents : 0;
  return `Bs ${(n / 100).toFixed(2).replace('.', ',')}`;
}

/**
 * Normaliza la entrada bruta de un input monetario a CENTAVOS (entero).
 * Devuelve `null` si no hay un número válido.
 *
 * Reglas (decisión del dueño):
 *   - "," → "." (ambos son decimal)
 *   - solo dígitos + UN separador decimal
 *   - si hay varios puntos, el PRIMERO es el decimal; los demás se eliminan
 *     (defensa ante separadores de miles pegados / dobles puntos)
 *   - resultado final: Math.round(n * 100) → centavos enteros
 */
export function parseMoneyInput(raw: string): number | null {
  if (raw == null) return null;
  let s = raw.trim();
  if (s === '') return null;

  // coma decimal → punto
  s = s.replace(/,/g, '.');

  // solo dígitos y punto
  s = s.replace(/[^\d.]/g, '');
  if (s === '' || s === '.') return null;

  // primer punto = decimal; los puntos extra se eliminan
  const firstDot = s.indexOf('.');
  if (firstDot !== -1) {
    s = s.slice(0, firstDot + 1) + s.slice(firstDot + 1).replace(/\./g, '');
  }

  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

/**
 * Referencia de mesa ESTANDARIZADA (2026-08-27): la mesa 0 es la BARRA.
 * Devuelve "BARRA" cuando number es 0 (o falsy), si no "Mesa N".
 * Úsalo en TODAS las vistas (meseros, caja, admin, KDS, cortes, pedidos)
 * para que nunca aparezca "Mesa 0" — siempre "BARRA".
 */
export function formatTableRef(number: number | string | null | undefined): string {
  const n = Number(number);
  if (!Number.isFinite(n) || n === 0) return 'BARRA';
  return `Mesa ${n}`;
}