/**
 * useActivePromos — promos activas del día laboral para la UI de meseros
 * (v16 2026-09-01).
 *
 * La DB es la única fuente: carga GET /api/promotions (que devuelve solo las
 * promos data-driven de la DB). El SSOT (src/core/config/promotions.js) quedó
 * ELIMINADO — ya no hay fallback a promos fijas del código. Si la API falla
 * → lista vacía (no rompe; el mesero simplemente no ve promos).
 *
 * Contrato:
 *   - `reload()` para refetchear al recibir el evento WS `menu_changed`
 *   - normaliza las promos a la forma que espera PromosCollapsible
 *     ({ id, label, description }) + línea/price_mode/price_value.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { businessDayDateStr, businessDayName } from '@/core/config/local-date';
import { apiFetch } from '../api/apiFetch';

export interface ActivePromo {
  id: string;
  name?: string;
  label: string;
  description: string;
  price_mode?: 'FIXED' | 'MENU_PLUS' | string;
  price_value?: number;
  price_total?: number;
  max_per_order?: number;
  lines?: { item_id?: string | null; group_id?: string | null; quantity?: number; extra_id?: string | null; extra_price?: number | null }[];
}

/** Forma cruda del GET /api/promotions. */
export interface ApiPromo extends ActivePromo {
  days?: string[]; // legacy SSOT — la DB no lo trae
}

export interface UseActivePromosResult {
  promos: ActivePromo[];
  businessDay: string;
  businessDayNameLabel: string;
  reload: () => Promise<void>;
}

export function useActivePromos(): UseActivePromosResult {
  const businessDay = useMemo(() => businessDayDateStr(), []);
  // v16: inicia VACÍO — se carga de GET /api/promotions (la DB es la única fuente).
  const [promos, setPromos] = useState<ActivePromo[]>([]);

  const reload = useCallback(async () => {
    try {
      const res = await apiFetch<{ success: boolean; promotions?: ApiPromo[] }>('/api/promotions');
      if (res.ok && Array.isArray(res.data?.promotions)) {
        setPromos(res.data.promotions.map(p => ({
          id: p.id,
          name: p.name,
          label: p.label || p.name || p.id,
          description: p.description || '',
          price_mode: p.price_mode,
          price_value: p.price_value,
          price_total: p.price_total,
          max_per_order: p.max_per_order,
          lines: p.lines,
        })));
      } else {
        setPromos([]); // API respondió sin promos → nada
      }
    } catch {
      setPromos([]); // red/API caída → nada (no rompe)
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return {
    promos,
    businessDay,
    businessDayNameLabel: businessDayName(businessDay),
    reload,
  };
}

export default useActivePromos;
