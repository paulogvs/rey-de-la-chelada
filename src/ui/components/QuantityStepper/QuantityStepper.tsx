/**
 * QuantityStepper — +/- controls for order quantities
 *
 * Large touch targets (48px minimum)
 * Zero hardcoded colors
 */

import React from 'react';
import './QuantityStepper.css';

export interface QuantityStepperProps {
  value: number;
  min?: number;
  max?: number;
  onChange: (value: number) => void;
  /** Size variant */
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export function QuantityStepper({
  value,
  min = 1,
  max = 99,
  onChange,
  size = 'md',
  className = '',
}: QuantityStepperProps) {
  const classes = ['qty-stepper', `qty-stepper--${size}`, className].filter(Boolean).join(' ');

  return (
    <div className={classes}>
      <button
        className="qty-stepper__btn"
        onClick={() => onChange(Math.max(min, value - 1))}
        disabled={value <= min}
        aria-label="Reducir cantidad"
      >
        −
      </button>
      <span className="qty-stepper__value" aria-live="polite">
        {value}
      </span>
      <button
        className="qty-stepper__btn"
        onClick={() => onChange(Math.min(max, value + 1))}
        disabled={value >= max}
        aria-label="Aumentar cantidad"
      >
        +
      </button>
    </div>
  );
}

export default QuantityStepper;
