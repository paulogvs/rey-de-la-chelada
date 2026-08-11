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
type KDSAwareItem = OrderLineItem;

/** Area de un item: kds_module (KDS WS) o kdsModule (ordersApi), con fallback 'cocina'. */
export function itemModule(item: KDSAwareItem): string {
  return item.kds_module || item.kdsModule || 'cocina';
}

/**
 * P0-FIX (2026-08-11 flujo mixto): filtra SOLO los items del módulo actual.
 * Lo usan handleAcknowledge/handleReject del KDSBoard para que el bartender
 * acepte/rechace SOLO su parte — ANTES marcaban TODOS los items del pedido
 * (incluidos los de cocina) y el pedido entero se cerraba con una sola
 * acción de un módulo.
 */
export function itemsForModule(items: OrderLineItem[], module: KDSModule): OrderLineItem[] {
  return items.filter(i => itemModule(i) === module);
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
