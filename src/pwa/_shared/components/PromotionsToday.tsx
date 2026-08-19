/**
 * PromotionsToday — panel "Promos de hoy" (Caja + Admin)
 *
 * Sprint Promos (2026-08-19): muestra las promos activas del DÍA LABORAL
 * (15:00 → 06:00 +1, hora Bolivia) para que caja y administración sepan
 * qué descuentos están corriendo hoy. Informativo — el cobro de promos es
 * manual del mesero (botones en el carrito), nunca automático.
 *
 * Usa la config SSOT compartida (promotions.js) — misma fuente de verdad
 * que el server (GET /api/promotions).
 */

import React, { useMemo } from 'react';
import { Card } from '@/ui/components/Card';
import { businessDayDateStr } from '@/core/config/local-date';
import { activePromotionsForDay, businessDayName } from '@/core/config/promotions.js';
import './PromotionsToday.css';

export function PromotionsToday({ compact = false }: { compact?: boolean }) {
  const businessDay = useMemo(() => businessDayDateStr(), []);
  const active = useMemo(() => activePromotionsForDay(businessDay), [businessDay]);

  if (active.length === 0) {
    return (
      <Card className="promotions-today promotions-today--empty">
        <h3 className="promotions-today__title">Promos de hoy</h3>
        <p className="promotions-today__none">Hoy no hay promos activas.</p>
      </Card>
    );
  }

  const dayLabel = businessDayName(businessDay);

  return (
    <Card className="promotions-today">
      <h3 className="promotions-today__title">
        🏆 Promos de hoy <span className="promotions-today__day">({dayLabel})</span>
      </h3>
      <ul className={`promotions-today__list${compact ? ' promotions-today__list--compact' : ''}`}>
        {active.map(p => (
          <li key={p.id} className="promotions-today__item">
            <strong className="promotions-today__name">{p.label}</strong>
            <span className="promotions-today__desc">{p.description}</span>
            {!compact && p.promoType === 'BOGO' && (
              <span className="promotions-today__tag">2x1</span>
            )}
            {!compact && p.price != null && p.promoType !== 'COMBO' && (
              <span className="promotions-today__tag">Bs {p.price}</span>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}

export default PromotionsToday;