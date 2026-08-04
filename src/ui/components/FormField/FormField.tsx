import React from 'react';
import './FormField.css';

interface FormFieldProps extends React.InputHTMLAttributes<HTMLInputElement> {
  /** Label shown above the input */
  label?: string;
  /** Visual variant: default | lg | mono | sm */
  variant?: 'default' | 'lg' | 'mono' | 'sm' | 'constrained';
}

/** Construye el className de form-input + variantes */
export function buildFormInputClass(variant: FormFieldProps['variant'], extra?: string) {
  const variants: Record<string, string> = {
    lg: 'form-input--lg',
    mono: 'form-input--mono',
    sm: 'form-input--sm',
    constrained: 'form-input--constrained',
  };
  return ['form-input', variant && variants[variant], extra].filter(Boolean).join(' ');
}

/**
 * FormField — shared input + label (SSOT for form controls).
 * Usa `className` adicional para estilos propios del contenedor.
 */
export function FormField({ label, variant, className, ...rest }: FormFieldProps) {
  if (!label) {
    return <input className={buildFormInputClass(variant, className)} {...rest} />;
  }
  return (
    <label className="form-field">
      <span className="form-field__label">{label}</span>
      <input className={buildFormInputClass(variant)} {...rest} />
    </label>
  );
}

export default FormField;
