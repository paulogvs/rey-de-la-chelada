/**
 * useActivePromos — promos activas del día laboral para la UI de meseros
 * (v15 FASE 3 2026-08-31).
 *
 * FASE 3: el desplegable de promos del mesero YA NO usa solo el SSOT fijo
 * (src/core/config/promotions.js) — carga las promos ACTIVAS del día desde
 * GET /api/promotions (que fusiona promos data-driven de la DB + SSOT).
 *
 * Contrato:
 *   - fallback al SSOT si la API falla (nunca romper si no hay red/DB)
 *   - `reload()` para refetchear al recibir el evento WS `menu_changed`
 *   - normaliza las promos a la forma que espera PromosCollapsible
 *     ({ id, label, description }) + campos extra para el marcado DB.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { businessDayDateStr } from '@/core/config/local-date';
import { activePromotionsForDay, businessDayName } from '@/core/config/promotions.js';
import { apiFetch } from '../api/apiFetch';

export interface ActivePromo {
  id: string;
  label: string;
  description: string;
  /** true si la promo es data-driven (vive en la DB, no en el SSOT). */
  db?: boolean;
  price_total?: number;
  max_per_order?: number;
  lines?: { item_id?: string | null; group_id?: string | null; quantity?: number }[];
}

/** Forma cruda del GET /api/promotions (SSOT con `days` + DB con `price_total`). */
export interface ApiPromo extends ActivePromo {
  name?: string;
  days?: string[];
}

export interface UseActivePromosResult {
  promos: ActivePromo[];
  businessDay: string;
  businessDayNameLabel: string;
  reload: () => Promise<void>;
}

/** Promos del SSOT normalizadas (fallback + arranque inmediato). */
function ssotPromos(businessDay: string): ActivePromo[] {
  return activePromotionsForDay(businessDay).map(p => ({
    id: p.id,
    label: p.label,
    description: p.description || '',
  }));
}

export function useActivePromos(): UseActivePromosResult {
  const businessDay = useMemo(() => businessDayDateStr(), []);
  // v15 (2026-08-31): la DB es la única fuente. Inicializa VACÍO (no SSOT) —
  // se carga de GET /api/promotions. El SSOT solo es fallback si la API falla.
  const [promos, setPromos] = useState<ActivePromo[]>([]);

  const reload = useCallback(async () => {
    try {
      const res = await apiFetch<{ success: boolean; promotions?: ApiPromo[] }>('/api/promotions');
      if (res.ok && Array.isArray(res.data?.promotions)) {
        setPromos(res.data.promotions.map(p => ({
          id: p.id,
          label: p.label || p.name || p.id,
          description: p.description || '',
          // las promos data-driven no tienen `days` (solo el SSOT las define)
          db: !p.days,
          price_total: p.price_total,
          max_per_order: p.max_per_order,
          lines: p.lines,
        })));
      } else {
        setPromos(ssotPromos(businessDay)); // fallback: API respondió sin promos
      }
    } catch {
      setPromos(ssotPromos(businessDay)); // fallback: red/API caída
    }
  }, [businessDay]);

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