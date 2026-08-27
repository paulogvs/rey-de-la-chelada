/**
 * MoneyInput — Input monetario unificado (FASE B).
 *
 * Decisiones del dueño:
 *   - `type="text" inputMode="decimal"` (NO `type="number"`): el teclado
 *     numérico muestra la coma/punto como decimal, sin los controles de
 *     step que rompen en móvil.
 *   - "," y "." son SIEMPRE decimal (teclado numérico o teclado físico).
 *   - CONTRATO DE CENTAVOS: el valor guardado (`value`/`onChange`) es un
 *     ENTERO en CENTAVOS (ej. 1050 = Bs 10.50). El input muestra Bs decimal
 *     con coma ("10,5") y parsea la entrada a centavos vía parseMoneyInput.
 *
 * Drop-in para los `type="number" step={0.01}` existentes:
 *   - FormField → <MoneyInput variant="lg" className="form-input--mono" />
 *   - input crudo → <MoneyInput className="mi-clase" />
 */

import React from 'react';
import { parseMoneyInput } from '@/pwa/_shared/utils/format';
import { buildFormInputClass } from '../FormField/FormField';

export interface MoneyInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type' | 'inputMode'> {
  /** Valor en CENTAVOS (entero) — ej. 1050 = Bs 10.50. 0 muestra placeholder. */
  value: number;
  /** Recibe el valor parseado en CENTAVOS (entero). */
  onChange: (cents: number) => void;
  /** Variante FormField (opcional). Si no, usa `className` tal cual. */
  variant?: 'default' | 'lg' | 'mono' | 'sm' | 'constrained';
}

export function MoneyInput({ value, onChange, variant, className = '', placeholder, ...rest }: MoneyInputProps) {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const parsed = parseMoneyInput(e.target.value);
    onChange(parsed ?? 0);
  };

  // Display editable con coma decimal ("10,5"); vacío cuando es 0 para mostrar placeholder.
  const display = value === 0 ? '' : String(value / 100).replace('.', ',');

  // SIEMPRE usar buildFormInputClass → con variant/className vacíos produce
  // la clase base `form-input` (estilo oscuro unificado). Estandariza todos
  // los MoneyInput de la app sin depender de CSS local por call site.
  const cls = buildFormInputClass(variant, className);

  return (
    <input
      type="text"
      inputMode="decimal"
      className={cls}
      value={display}
      onChange={handleChange}
      placeholder={placeholder}
      {...rest}
    />
  );
}

export default MoneyInput;
