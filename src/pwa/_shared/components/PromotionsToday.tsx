/**
 * PromotionsToday — panel "Promos de hoy" (Caja + Admin)
 *
 * Sprint Promos (2026-08-19) + v15 (2026-08-29): muestra las promos activas
 * del DÍA LABORAL (15:00 → 06:00 +1, hora Bolivia) para que caja y
 * administración sepan qué descuentos corren hoy. Informativo — el cobro de
 * promos es manual del mesero (botones en el carrito), nunca automático.
 *
 * Ahora consume GET /api/promotions (que fusiona promos de la DB data-driven
 * + el SSOT del código) con FALLBACK al SSOT si la API falla (offline).
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Card } from '@/ui/components/Card';
import { businessDayDateStr } from '@/core/config/local-date';
import { activePromotionsForDay, businessDayName } from '@/core/config/promotions.js';
import { formatMoney } from '@/pwa/_shared/utils/format';
import './PromotionsToday.css';

interface MergedPromo {
  id: string;
  label: string;
  description: string;
  price?: number | null;
  promoType?: string | null;
}

/** Normaliza promos de la API fusionada (DB + SSOT) a un shape común. */
export function normalizePromotionsToday(promos: Array<Record<string, unknown>>): MergedPromo[] {
  return (promos || []).map(p => ({
    id: String(p.id ?? ''),
    label: String(p.label ?? p.name ?? ''),
    description: String(p.description ?? ''),
    price: p.price != null ? Number(p.price) : (p.price_total != null ? Number(p.price_total) : null),
    promoType: p.promoType ? String(p.promoType) : (p.promo_type ? String(p.promo_type) : null),
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
    } catch { /* cae al fallback */ }
    // Fallback: SSOT del código (offline / API caída)
    setPromos(activePromotionsForDay(businessDay).map(p => ({
      id: p.id, label: p.label || p.name, description: p.description, price: p.price, promoType: p.promoType,
    })));
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
            {!compact && p.promoType === 'BOGO' && (
              <span className="promotions-today__tag">2x1</span>
            )}
            {!compact && p.price != null && p.promoType !== 'COMBO' && (
              <span className="promotions-today__tag">{formatMoney(p.price)}</span>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}

export default PromotionsToday;