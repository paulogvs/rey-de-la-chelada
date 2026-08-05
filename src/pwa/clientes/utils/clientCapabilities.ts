/**
 * Client capabilities — pure logic shared by the clientes PWA.
 *
 * SSOT de los permisos del cliente según el estado de la sesión:
 * - canCallWaiter  = sesión VÁLIDA (con o sin pedido activo)
 *   → el cliente puede llamar al mesero desde que escanea el QR, sin
 *     necesidad de tener un pedido activo. El mesero crea el pedido.
 * - canRequestBill = sesión válida Y pedido activo (no tiene sentido
 *   pedir la cuenta sin haber pedido nada).
 * - isReadOnly     = !hasActiveOrder (menú en modo lectura sin pedido,
 *   pero el botón "Llamar Mesero" sigue disponible).
 *
 * FASE 1: el gate de "Llamar Mesero" vivía inline en useTableSession con
 * `hasActiveOrder && validation.valid` — impedía llamar sin pedido.
 * Centralizado aquí + testeado (tests/unit/client-capabilities.test.ts).
 */

export interface CapabilityInput {
  /** La sesión QR es válida contra el servidor */
  valid: boolean;
  /** La mesa tiene un pedido activo (draft/called/confirmed/preparing/ready/served) */
  hasActiveOrder: boolean;
  /** Razón de solo-lectura forzada (p.ej. 'readonly' legacy) */
  readonlyReason?: string;
}

export interface ClientCapabilities {
  canCallWaiter: boolean;
  canRequestBill: boolean;
  isReadOnly: boolean;
}

/** Resuelve las capacidades del cliente según el estado de su sesión. */
export function resolveClientCapabilities({
  valid,
  hasActiveOrder,
  readonlyReason,
}: CapabilityInput): ClientCapabilities {
  return {
    // Llamar mesero: basta con sesión válida (el QR ya es el permiso)
    canCallWaiter: valid,
    // Pedir cuenta: requiere sesión válida Y pedido activo
    canRequestBill: valid && hasActiveOrder,
    isReadOnly: !hasActiveOrder || readonlyReason === 'readonly',
  };
}
