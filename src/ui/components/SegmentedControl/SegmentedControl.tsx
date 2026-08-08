/**
 * SEGMENTEDCONTROL — Segmented filter control
 *
 * 3-4 equal options with active gold accent. Touch targets ≥48px.
 * Accessible: role="tablist" / role="tab" + aria-selected.
 * ZERO hardcoded colors — all from CSS variables.
 */

import React from 'react';
import './SegmentedControl.css';

export interface SegmentedOption {
  value: string;
  label: string;
}

export interface SegmentedControlProps {
  options: SegmentedOption[];
  /** Current selected value */
  value: string;
  onChange: (value: string) => void;
  className?: string;
}

export function SegmentedControl({ options, value, onChange, className = '' }: SegmentedControlProps) {
  const classes = ['segmented', className].filter(Boolean).join(' ');

  return (
    <div className={classes} role="tablist" aria-label="Filtros">
      {options.map(option => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={selected}
            className={`segmented__option ${selected ? 'segmented__option--active' : ''}`}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

export default SegmentedControl;
