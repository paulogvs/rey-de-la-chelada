/**
 * Client order send-gate — pure logic shared by the clientes PWA.
 *
 * FASE 1: el gate vivía inline en MenuPage y usaba `session.tableId`
 * (campo INEXISTENTE en TableSession). Eso hacía que `!session.tableId`
 * siempre fuera true → el pedido jamás se enviaba (bloqueo silencioso).
 *
 * SSOT: la condición de envío está centralizada aquí, con el campo real
 * `tableNumber`. Todos los callers deben usar esta función.
 */

export interface SendSessionRef {
  /** Número de mesa real (de TableSession.tableNumber) */
  tableNumber: number;
  /** Session ID (de la URL / localStorage / servidor lazy) */
  sessionId?: string | null;
}

/**
 * ¿Se puede enviar el pedido del menú digital?
 * - Debe haber items en el carrito.
 * - Debe conocerse la mesa (tableNumber > 0).
 * - Debe existir una sesión (session_id) — "el pedido activo es el permiso".
 */
export function canSubmitClientOrder(
  session: SendSessionRef,
  draftItemCount: number
): boolean {
  if (draftItemCount <= 0) return false;
  if (!session.tableNumber || Number.isNaN(session.tableNumber)) return false;
  if (!session.sessionId) return false;
  return true;
}
