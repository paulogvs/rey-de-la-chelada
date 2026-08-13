/**
 * MoneyInput — Input monetario unificado (FASE B).
 *
 * Decisiones del dueño:
 *   - `type="text" inputMode="decimal"` (NO `type="number"`): el teclado
 *     numérico muestra la coma/punto como decimal, sin los controles de
 *     step que rompen en móvil.
 *   - "," y "." son SIEMPRE decimal (teclado numérico o teclado físico).
 *   - El valor guardado es `number` (el contrato con el server NO cambia).
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
  /** Valor numérico (contrato server sin cambios). */
  value: number;
  /** Recibe el valor numérico parseado. */
  onChange: (value: number) => void;
  /** Variante FormField (opcional). Si no, usa `className` tal cual. */
  variant?: 'default' | 'lg' | 'mono' | 'sm' | 'constrained';
}

export function MoneyInput({ value, onChange, variant, className = '', placeholder, ...rest }: MoneyInputProps) {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const parsed = parseMoneyInput(e.target.value);
    onChange(parsed ?? 0);
  };

  // Display editable con coma decimal ("12,5"); vacío cuando es 0 para mostrar placeholder.
  const display = value === 0 ? '' : String(value).replace('.', ',');

  const cls = variant ? buildFormInputClass(variant, className) : className;

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
