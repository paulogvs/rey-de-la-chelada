import { useState } from 'react';
import { AppIcon } from '@/ui/components/AppIcon/AppIcon';
import { formatMoney } from '../../_shared/utils/format';
import './PromosCollapsible.css';

export interface PromosCollapsibleProps {
  /** Día laboral (ej. "domingo") — el turno vigente, no el día calendario. */
  businessDayNameLabel: string;
  promos: { id: string; label: string; description?: string }[];
  /** Ids de promos ya aplicadas en el carrito. */
  appliedIds: string[];
  /** Aplica o quita una promo del carrito. */
  onToggle: (promoId: string) => void;
  savings: number;
}

/**
 * Promos del turno laboral — sección colapsable compacta.
 *
 * Rediseño 2026-08-21: antes el bloque renderizaba 4 botones expandidos y
 * ocupaba todo el sidebar del "Pedido actual" (PC/tablet). Ahora nace
 * colapsado (una línea con conteo) y el scroll propio evita que empuje
 * los items del pedido.
 *
 * Wording: "Promos del turno · DOM" + "válido 15:00 → 06:00" (día laboral
 * Opción B: inicia 15:00, termina 06:00 de la madrugada del día siguiente).
 */
export function PromosCollapsible({
  businessDayNameLabel,
  promos,
  appliedIds,
  onToggle,
  savings,
}: PromosCollapsibleProps) {
  const [open, setOpen] = useState(false);
  if (promos.length === 0) return null;

  const dayShort = businessDayNameLabel.slice(0, 3).toUpperCase();
  const appliedCount = appliedIds.length;

  return (
    <details
      className={`promos-collapsible${open ? ' promos-collapsible--open' : ''}`}
      onToggle={e => setOpen((e.target as HTMLDetailsElement).open)}
    >
      <summary className="promos-collapsible__summary" title="Promos del turno laboral (15:00 → 06:00)">
        <span className="promos-collapsible__title">
          Promos del turno · {dayShort}
          <span className="promos-collapsible__count">
            {appliedCount > 0 ? `${appliedCount} aplicada${appliedCount > 1 ? 's' : ''}` : promos.length}
          </span>
        </span>
        <span className="promos-collapsible__hint">15:00 → 06:00</span>
        <AppIcon name={open ? 'chevron-down' : 'chevron-up'} size="sm" />
      </summary>
      <div className="promos-collapsible__body">
        {promos.map(promo => {
          const applied = appliedIds.includes(promo.id);
          return (
            <button
              key={promo.id}
              className={`order-panel__promo-btn${applied ? ' order-panel__promo-btn--applied' : ''}`}
              onClick={() => onToggle(promo.id)}
              title={promo.description}
              type="button"
            >
              <span className="order-panel__promo-btn-name">{promo.label}</span>
              <span className="order-panel__promo-btn-desc">{promo.description}</span>
              <span className="order-panel__promo-btn-action">{applied ? 'Quitar' : 'Aplicar'}</span>
            </button>
          );
        })}
        {savings > 0 && (
          <p className="order-panel__promos-savings">
            Ahorro aplicado: <strong>{formatMoney(savings)}</strong>
          </p>
        )}
      </div>
    </details>
  );
}

export default PromosCollapsible;
