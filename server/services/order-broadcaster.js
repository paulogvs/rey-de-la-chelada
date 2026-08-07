/**
 * Order Event Broadcaster — Thin wrapper that couples the domain
 * broadcaster (server/services/websocket-broadcaster.js) with the
 * order-specific event shape.
 *
 * Routes call these helpers instead of wiring the broadcaster
 * directly — keeps the route files focused on HTTP concerns and
 * puts the "when do we emit which event" logic in one place.
 */

import { broadcaster, buildKDSEvent, KDSEventType } from './websocket-broadcaster.js';

/**
 * Emit a `new_order` event to KDS (cocina + bar).
 * Called at order CREATION time:
 *   - pedido público del cliente (clientes PWA) → status REAL 'called'
 *     (el mesero debe confirmarlo; KDS lo filtra hasta 'confirmed')
 *   - confirmación del mesero (called → confirmed) → status 'confirmed'
 *
 * 2.7 (A5): ANTES el status estaba hardcodeado a 'confirmed' → la KDS
 * veía como confirmado un pedido que en realidad estaba 'called' y el
 * flujo de confirmación del mesero se rompía. Ahora se emite el status
 * REAL del pedido (order.status).
 */
export function broadcastOrderCreated(order) {
  if (!order) return;
  broadcaster.broadcastKDS(buildKDSEvent(KDSEventType.NEW_ORDER, {
    orderId: order.id,
    tableNumber: order.table_number,
    items: order.items,
    status: order.status,
  }));
}

/**
 * Emit a `status_change` event to KDS. If the new state is "ready"
 * and all items of the order are ready, also emits `order_complete`
 * to meseros so they know to pick up the order.
 */
export function broadcastOrderStatusChange(order, previousStatus) {
  if (!order) return;
  const nextStatus = order.status;

  broadcaster.broadcastKDS(buildKDSEvent(KDSEventType.STATUS_CHANGE, {
    orderId: order.id,
    tableNumber: order.table_number,
    items: order.items,
    previousStatus,
    status: nextStatus,
  }));

  if (nextStatus === 'ready' && isOrderFullyReady(order)) {
    broadcaster.broadcastMeseros(buildKDSEvent(KDSEventType.ORDER_COMPLETE, {
      orderId: order.id,
      tableNumber: order.table_number,
      status: 'ready',
    }));
  }
}

/**
 * True when the order has at least one item AND every item is in a
 * terminal-for-kitchen state (ready / delivered / cancelled).
 */
function isOrderFullyReady(order) {
  if (!order.items || order.items.length === 0) return false;
  return order.items.every((i) =>
    i.status === 'ready' || i.status === 'delivered' || i.status === 'cancelled'
  );
}
