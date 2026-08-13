/**
 * format.ts — Formateo de moneda centralizado (SSOT)
 *
 * Decisión del dueño (FASE B): moneda unificada a `"Bs 12,50"`
 *   - coma decimal (convención boliviana)
 *   - SIN separador de miles
 *   - "Bs" sin punto (el símbolo config es `Bs`)
 *
 * `parseMoneyInput` normaliza la entrada del teclado (MoneyInput):
 *   - "," y "." son SIEMPRE decimal (teclado numérico o teclado físico)
 *   - nunca se aceptan separadores de miles
 *
 * IMPORTANTE: NO usar estos helpers en `csvExport.ts` — el CSV debe seguir
 * con punto decimal y formato de máquina (Excel/consumidores lo parsean
 * numéricamente). Aquí el objetivo es DISPLAY humano.
 */

/** Formatea un monto a "Bs 12,50" (coma decimal, sin miles). */
export function formatMoney(amount: number): string {
  const n = Number.isFinite(amount) ? amount : 0;
  return `Bs ${n.toFixed(2).replace('.', ',')}`;
}

/**
 * Normaliza la entrada bruta de un input monetario a `number`.
 * Devuelve `null` si no hay un número válido.
 *
 * Reglas (decisión del dueño):
 *   - "," → "." (ambos son decimal)
 *   - solo dígitos + UN separador decimal
 *   - si hay varios puntos, el PRIMERO es el decimal; los demás se eliminan
 *     (defensa ante separadores de miles pegados / dobles puntos)
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
  return Number.isFinite(n) ? n : null;
}
