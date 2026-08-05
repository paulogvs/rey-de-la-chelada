/**
 * resolveClientCapabilities — pure logic tests.
 *
 * Regla de negocio (FASE 1):
 * - canCallWaiter  = sesión VÁLIDA (con o sin pedido activo)
 *   → el cliente puede llamar al mesero desde que escanea el QR, sin
 *     necesidad de tener un pedido activo. El mesero crea el pedido.
 * - canRequestBill = sesión válida Y pedido activo (no tiene sentido
 *   pedir la cuenta sin haber pedido nada).
 * - isReadOnly     = !hasActiveOrder (menú en modo lectura sin pedido,
 *   pero el botón "Llamar Mesero" sigue disponible).
 */

import { describe, it, expect } from 'vitest';
import { resolveClientCapabilities } from '../../src/pwa/clientes/utils/clientCapabilities';

describe('resolveClientCapabilities', () => {
  it('permite llamar al mesero SIN pedido activo (sesión válida)', () => {
    const caps = resolveClientCapabilities({ valid: true, hasActiveOrder: false });
    expect(caps.canCallWaiter).toBe(true);
    expect(caps.canRequestBill).toBe(false);
    expect(caps.isReadOnly).toBe(true);
  });

  it('con pedido activo permite llamar Y pedir cuenta', () => {
    const caps = resolveClientCapabilities({ valid: true, hasActiveOrder: true });
    expect(caps.canCallWaiter).toBe(true);
    expect(caps.canRequestBill).toBe(true);
    expect(caps.isReadOnly).toBe(false);
  });

  it('sesión inválida bloquea llamar y pedir cuenta (isReadOnly la marca isValid, no esta función)', () => {
    const caps = resolveClientCapabilities({ valid: false, hasActiveOrder: true });
    expect(caps.canCallWaiter).toBe(false);
    expect(caps.canRequestBill).toBe(false);
    // isReadOnly depende solo de hasActiveOrder (comportamiento legacy conservado)
    expect(caps.isReadOnly).toBe(false);
  });

  it('reason readonly fuerza solo-lectura aunque haya pedido', () => {
    const caps = resolveClientCapabilities({
      valid: true,
      hasActiveOrder: true,
      readonlyReason: 'readonly',
    });
    expect(caps.canCallWaiter).toBe(true);
    expect(caps.canRequestBill).toBe(true);
    expect(caps.isReadOnly).toBe(true);
  });
});
