/**
 * PromotionsToday — panel "Promos de hoy" (Caja + Admin)
 *
 * Sprint Promos (2026-08-19) + v16 (2026-09-01): muestra las promos activas
 * del DÍA LABORAL (15:00 → 06:00 +1, hora Bolivia) para que caja y
 * administración sepan qué descuentos corren hoy. Informativo — el cobro de
 * promos es manual del mesero (botones en el carrito), nunca automático.
 *
 * v16: el SSOT (src/core/config/promotions.js) quedó ELIMINADO — consume
 * SOLO GET /api/promotions (la DB es la única fuente). Sin API → vacío.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Card } from '@/ui/components/Card';
import { businessDayDateStr, businessDayName } from '@/core/config/local-date';
import { formatMoney } from '@/pwa/_shared/utils/format';
import './PromotionsToday.css';

interface MergedPromo {
  id: string;
  label: string;
  description: string;
  price?: number | null;
  price_mode?: string | null;
  price_value?: number | null;
}

/** Normaliza promos de la API (DB) a un shape común. */
export function normalizePromotionsToday(promos: Array<Record<string, unknown>>): MergedPromo[] {
  return (promos || []).map(p => ({
    id: String(p.id ?? ''),
    label: String(p.label ?? p.name ?? ''),
    description: String(p.description ?? ''),
    price: p.price_value != null ? Number(p.price_value) : (p.price_total != null ? Number(p.price_total) : null),
    price_mode: p.price_mode ? String(p.price_mode) : null,
  })).filter(p => p.id && p.label);
}

export function PromotionsToday({ compact = false }: { compact?: boolean }) {
  const businessDay = businessDayDateStr();
  const [promos, setPromos] = useState<MergedPromo[]>([]);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/promotions?business_day=${businessDay}`);
      const json = await res.json().catch(() => null);
      if (res.ok && json?.success && Array.isArray(json.promotions)) {
        setPromos(normalizePromotionsToday(json.promotions));
        setLoaded(true);
        return;
      }
    } catch { /* API caída → no hay promos */ }
    setPromos([]);
    setLoaded(true);
  }, [businessDay]);

  useEffect(() => { load(); }, [load]);
  // Recargar si la API se vuelve disponible (evento online)
  useEffect(() => {
    const h = () => { if (navigator.onLine) load(); };
    window.addEventListener('online', h);
    return () => window.removeEventListener('online', h);
  }, [load]);

  if (!loaded) return null;

  if (promos.length === 0) {
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
        {promos.map(p => (
          <li key={p.id} className="promotions-today__item">
            <strong className="promotions-today__name">{p.label}</strong>
            <span className="promotions-today__desc">{p.description}</span>
            {!compact && p.price != null && (
              <span className="promotions-today__tag">{formatMoney(p.price)}</span>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}

export default PromotionsToday;
