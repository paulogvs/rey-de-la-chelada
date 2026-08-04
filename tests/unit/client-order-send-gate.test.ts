/**
 * Client order send-gate — pure logic extracted from MenuPage.
 *
 * FASE 1 fix: el gate usaba `session.tableId` (campo inexistente en
 * TableSession) → `!session.tableId` siempre true → el pedido NUNCA se
 * enviaba (bloqueado silenciosamente). El campo real es `tableNumber`.
 *
 * TDD: RED → GREEN. Test escrito antes que el helper.
 */

import { describe, it, expect } from 'vitest';
import { canSubmitClientOrder } from '../../src/pwa/clientes/utils/orderSendGate';

describe('canSubmitClientOrder', () => {
  it('permite enviar cuando hay items, mesa y session_id válidos', () => {
    expect(
      canSubmitClientOrder({ tableNumber: 3, sessionId: 'sess_abc' }, 2)
    ).toBe(true);
  });

  it('bloquea cuando no hay items en el carrito', () => {
    expect(
      canSubmitClientOrder({ tableNumber: 3, sessionId: 'sess_abc' }, 0)
    ).toBe(false);
  });

  it('bloquea cuando la mesa es desconocida (0 o ausente)', () => {
    expect(
      canSubmitClientOrder({ tableNumber: 0, sessionId: 'sess_abc' }, 2)
    ).toBe(false);
    expect(
      canSubmitClientOrder({ tableNumber: NaN, sessionId: 'sess_abc' }, 2)
    ).toBe(false);
  });

  it('bloquea cuando falta session_id (no hay sesión creada)', () => {
    expect(
      canSubmitClientOrder({ tableNumber: 3, sessionId: '' }, 2)
    ).toBe(false);
    expect(
      canSubmitClientOrder({ tableNumber: 3, sessionId: undefined }, 2)
    ).toBe(false);
  });
});
