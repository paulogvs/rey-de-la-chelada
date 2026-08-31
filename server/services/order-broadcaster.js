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
  // S2-D: la caja también necesita saber que hay un pedido nuevo pendiente.
  broadcastOrderToCaja(order);
}

/**
 * Emit a `status_change` event to KDS. If the new state is "ready"
 * and all items of the order are ready, also emits `order_complete`
 * to meseros so they know to pick up the order. La caja recibe
 * status_change para mantener al día la lista de pendientes (S2-D).
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

  broadcastOrderToCaja(order);

  if (nextStatus === 'ready' && isOrderFullyReady(order)) {
    broadcastOrderComplete(order);
  }
}

/**
 * Emit `order_complete` to meseros: TODOS los items del pedido están en
 * estado terminal para la cocina (ready/delivered/cancelled) → listo para
 * servir. Se usa desde el flujo de status del pedido (broadcastOrderStatusChange)
 * Y desde el flujo REAL de items (PATCH /:id/items/:id/status) — el KDS
 * marca item a item y el server decide cuándo el pedido quedó completo.
 */
export function broadcastOrderComplete(order) {
  if (!order) return;
  // P2-1 (2026-08-11): emitir el status REAL del pedido (ahora 'ready' en
  // DB cuando todos los items están listos) — ANTES estaba hardcodeado a
  // 'ready' mientras la DB decía 'confirmed'.
  broadcaster.broadcastMeseros(buildKDSEvent(KDSEventType.ORDER_COMPLETE, {
    orderId: order.id,
    tableNumber: order.table_number,
    status: order.status || 'ready',
  }));
}

/**
 * Emit a lightweight `status_change` to the caja module so the pending
 * orders list refreshes in real time (S2-D).
 */
export function broadcastOrderToCaja(order) {
  if (!order) return;
  broadcaster.broadcastToModule('caja', buildKDSEvent(KDSEventType.STATUS_CHANGE, {
    orderId: order.id,
    tableNumber: order.table_number,
    status: order.status,
  }));
}

/**
 * True when the order has at least one item AND every item is in a
 * terminal-for-kitchen state (ready / delivered / cancelled).
 */
export function isOrderFullyReady(order) {
  if (!order.items || order.items.length === 0) return false;
  return order.items.every((i) =>
    i.status === 'ready' || i.status === 'delivered' || i.status === 'cancelled'
  );
}

/**
 * True when TODOS los items de UN módulo (bar | cocina) están en estado
 * terminal-for-kitchen. El circuito se cierra SOLO cuando TODOS los módulos
 * del pedido están listos (isOrderFullyReady); este helper permite avisar
 * por módulo: "barra lista" y "cocina lista" son avisos SEPARADOS al mesero.
 *
 * FIX 2026-08-11 (flujo mixto): antes, marcar la barra lista hacía que el
 * pedido entero pareciera listo (order_complete) o desapareciera del otro
 * módulo KDS. Ahora cada módulo completa su parte de forma independiente.
 */
export function isModuleFullyReady(order, module) {
  if (!order.items || order.items.length === 0) return false;
  const moduleItems = order.items.filter((i) => (i.kds_module || 'cocina') === module);
  if (moduleItems.length === 0) return false;
  return moduleItems.every((i) =>
    i.status === 'ready' || i.status === 'delivered' || i.status === 'cancelled'
  );
}

/**
 * Emit a `module_ready` event to meseros: UN módulo del pedido (bar o
 * cocina) terminó TODOS sus items → el mesero puede recoger esa parte.
 * No es order_complete: el pedido sigue abierto hasta que TODOS los
 * módulos terminen (broadcastOrderComplete).
 */
export function broadcastModuleReady(order, module) {
  if (!order || !module || !['bar', 'cocina'].includes(module)) return;
  broadcaster.broadcastMeseros(buildKDSEvent(KDSEventType.MODULE_READY, {
    orderId: order.id,
    tableNumber: order.table_number,
    module,
    status: order.status || 'confirmed',
  }));
}

/**
 * Emit a `menu_changed` event to ALL staff modules (meseros, cocina, bar,
 * caja) so they refetch the menu in real time when Admin edits it.
 * v14 (2026-08-29): sin orderId — es un evento global de catálogo.
 *
 * v15 FASE 3 (2026-08-31): DEBOUNCE ~1000ms. Si el dueño activa/desactiva
 * varios toggles de promos/extras rápido, cada mutador llamaba esta función
 * y los PWAs refetcheaban N veces. Ahora los cambios se acumulan y se emite
 * UN solo evento tras 1000ms de inactividad (el timer se reinicia en cada
 * llamada). La firma exportada no cambia.
 */
const MENU_CHANGED_DEBOUNCE_MS = 1000;
let menuChangedTimer = null;

function emitMenuChangedNow() {
  broadcaster.broadcastToModules(['meseros', 'cocina', 'bar', 'caja'], {
    type: KDSEventType.MENU_CHANGED,
    timestamp: new Date().toISOString(),
  });
}

export function broadcastMenuChanged() {
  if (menuChangedTimer) clearTimeout(menuChangedTimer);
  menuChangedTimer = setTimeout(() => {
    menuChangedTimer = null;
    emitMenuChangedNow();
  }, MENU_CHANGED_DEBOUNCE_MS);
}

/**
 * Flush inmediato del debounce (tests / cierre de sesión): emite YA el
 * evento si hay un cambio pendiente; si no hay nada pendiente, no-op.
 */
export function flushMenuChanged() {
  if (!menuChangedTimer) return;
  clearTimeout(menuChangedTimer);
  menuChangedTimer = null;
  emitMenuChangedNow();
}
