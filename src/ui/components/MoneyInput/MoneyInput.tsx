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
 *     con coma ("10,50") y parsea la entrada a centavos vía parseMoneyInput.
 *
 * FIX 2026-08-28 (decimales): este input es CONTROLADO por `value` (centavos),
 * por lo que al escribir un punto/comma, el re-render formateaba el valor y
 * "se comía" el carácter decimal → no se podía pagar 70.50. Solución: se
 * mantiene un TEXTO interno (string) mientras el usuario edita (así el punto
 * /comma se conserva en pantalla) y se sincroniza a centavos hacia arriba.
 * Al perder el foco, se re-formatea a "10,50" (2 decimales).
 *
 * Drop-in para los `type="number" step={0.01}` existentes:
 *   - FormField → <MoneyInput variant="lg" className="form-input--mono" />
 *   - input crudo → <MoneyInput className="mi-clase" />
 */

import React, { useState, useEffect, useRef } from 'react';
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

/** Centavos → texto editable con coma y SIEMPRE 2 decimales ("1050" → "10,50"). */
function centsToText(cents: number): string {
  if (!cents) return '';
  const v = cents / 100;
  return v.toFixed(2).replace('.', ',');
}

export function MoneyInput({ value, onChange, variant, className = '', placeholder, onFocus, onBlur, ...rest }: MoneyInputProps) {
  const [text, setText] = useState<string>(() => centsToText(value));
  const focusedRef = useRef(false);

  // Sincronizar cuando el valor EXTERNO cambia (ej. el padre resetea),
  // pero NO mientras el usuario está escribiendo (para no pisar el punto).
  useEffect(() => {
    if (!focusedRef.current) {
      setText(centsToText(value));
    }
  }, [value]);

  const handleFocus = (e: React.FocusEvent<HTMLInputElement>) => {
    focusedRef.current = true;
    if (onFocus) onFocus(e);
  };

  const handleBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    focusedRef.current = false;
    // Al salir, re-formatear limpio y emitir el valor final
    const parsed = parseMoneyInput(text);
    setText(centsToText(parsed ?? 0));
    if (parsed !== null && parsed !== value) onChange(parsed);
    if (onBlur) onBlur(e);
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    // Permitir punto/comma y dígitos; limpiar múltiples separadores.
    // Mientras se edita, conservamos el texto tal cual para que el punto
    // decimal no desaparezca → ahora se puede escribir "70.50" / "70,50".
    setText(raw);
    const parsed = parseMoneyInput(raw);
    onChange(parsed ?? 0);
  };

  const cls = buildFormInputClass(variant, className);

  return (
    <input
      type="text"
      inputMode="decimal"
      className={cls}
      value={text}
      onChange={handleChange}
      onFocus={handleFocus}
      onBlur={handleBlur}
      placeholder={placeholder}
      {...rest}
    />
  );
}

export default MoneyInput;