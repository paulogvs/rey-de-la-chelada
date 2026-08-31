/**
 * BusinessDayPicker — selector de DÍA LABORAL (turno 15:00 → 06:00 +1).
 *
 * v14 (2026-08-29): reutilizable en Admin para ver días ANTERIORES
 * (movimientos, comprobantes, reportes históricos). El "día" que importa
 * es el laboral (businessDay), no el calendario: el turno del miércoles
 * 15:00 va hasta el jueves 06:00 = UN solo día laboral "miércoles".
 */

import React from 'react';
import { FormField } from '@/ui/components/FormField';

interface BusinessDayPickerProps {
  value: string;          // 'YYYY-MM-DD' del día laboral
  onChange: (day: string) => void;
  disabled?: boolean;
}

export function BusinessDayPicker({ value, onChange, disabled }: BusinessDayPickerProps) {
  return (
    <FormField
      type="date"
      variant="sm"
      value={value}
      onChange={e => onChange(e.target.value)}
      disabled={disabled}
      aria-label="Día laboral"
      title="Día laboral (turno 15:00 → 06:00 del día siguiente)"
    />
  );
}

export default BusinessDayPicker;