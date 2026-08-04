/**
 * KDSBoard filter — reparte pedidos mixtos por área KDS (SSOT defensivo).
 *
 * FASE 1: KDS separado. El servidor ya filtra por mi.area en
 * GET /api/orders/kds/:module, pero el WebSocket entrega pedidos
 * completos a ambos módulos (broadcastKDS). Cada pantalla KDS re-filtra
 * los items por kds_module para mostrar SOLO su área sin mutar el engine.
 */

import type { Order, OrderLineItem } from '@/core/types';

export type KDSModule = 'cocina' | 'bar';

/** Item con kds_module opcional (server DB snake_case → mi.area). */
type KDSAwareItem = OrderLineItem & { kds_module?: string };

/** Area de un item: kds_module del item, con fallback 'cocina' (legacy). */
function itemModule(item: KDSAwareItem): string {
  return item.kds_module || 'cocina';
}

/**
 * Devuelve copias de los pedidos con SOLO los items del módulo indicado.
 * Los pedidos sin items de ese módulo se omiten. Nunca muta el original.
 */
export function filterItemsByModule(orders: Order[], module: KDSModule): Order[] {
  const result: Order[] = [];
  for (const order of orders) {
    const items = order.items.filter(i => itemModule(i) === module);
    if (items.length === 0) continue;
    result.push({ ...order, items });
  }
  return result;
}

export default filterItemsByModule;
