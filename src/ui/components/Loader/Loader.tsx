import React from 'react';
import './Loader.css';

interface LoaderProps {
  /** Texto opcional junto al spinner (default: "Cargando…") */
  label?: string;
  /** block: centrado con padding; compact: inline pequeño */
  variant?: 'default' | 'block' | 'compact';
  className?: string;
}

/**
 * Loader — spinner compartido (SSOT) para estados de carga.
 * Reemplaza los textos "Cargando…" planos en todas las PWAs.
 */
export function Loader({ label = 'Cargando…', variant = 'default', className }: LoaderProps) {
  const cls = ['loader', variant !== 'default' && `loader--${variant}`, className]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={cls} role="status" aria-live="polite">
      <span className="loader__spinner" aria-hidden="true" />
      {label && <span className="loader__label">{label}</span>}
    </div>
  );
}

export default Loader;
