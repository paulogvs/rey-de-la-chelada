/**
 * tableAlerts — pure helpers for the meseros SALÓN alerts (FASE 4.5)
 *
 * The server is the SSOT: GET /api/tables → table.activeOrder
 *   { id, status, modules: { bar?: 'ready'|'preparing', cocina?: ... } }
 *
 * These helpers turn that into the visual alert state of a table card:
 *   - served      → 💰 "Por cobrar" (todo entregado)
 *   - modules     → 🍳/🍺 verde (ready) / amarillo (preparing)
 *
 * Pure & unit-tested in node. No imports — safe anywhere in the client.
 */

export interface ActiveOrderModules {
  bar?: 'ready' | 'preparing';
  cocina?: 'ready' | 'preparing';
}

export interface ActiveOrderLike {
  id: string;
  status: string | null;
  modules: Partial<Record<'bar' | 'cocina', 'ready' | 'preparing'>>;
}

export interface TableAlertState {
  /** true → todo entregado (mostrar "💰 Por cobrar") */
  served: boolean;
  /** módulos con trabajo activo: 'ready' (verde) | 'preparing' (amarillo) */
  modules: Array<{ module: 'bar' | 'cocina'; state: 'ready' | 'preparing' }>;
}

/** Estado de alerta de una mesa a partir de su activeOrder (o null). */
export function tableAlertState(activeOrder: ActiveOrderLike | null | undefined): TableAlertState {
  if (!activeOrder) return { served: false, modules: [] };

  const served = activeOrder.status === 'served';
  const modules = (Object.entries(activeOrder.modules) as Array<['bar' | 'cocina', 'ready' | 'preparing']>)
    .map(([module, state]) => ({ module, state }));

  return { served, modules };
}

export default { tableAlertState };
