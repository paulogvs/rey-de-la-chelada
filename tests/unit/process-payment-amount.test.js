/**
 * B2 — processPayment: defensa en profundidad sobre `amount`
 *
 * La ruta POST /api/payments valida amount (400 INVALID_AMOUNT), pero
 * processPayment es el punto de entrada único para registrar pagos
 * (defensa en profundidad). Antes: `Number(amount) || 0` convertía 'abc'
 * o NaN en Bs 0 silenciosamente. Ahora lanza un error claro.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { applySchema } from '../../server/db/schema.js';
import { processPayment } from '../../server/routes/payments.js';

let db;
let orderId;

beforeEach(() => {
  db = new Database(':memory:');
  applySchema(db);
  db.prepare("INSERT INTO staff (id, pin_hash, role, display_name) VALUES ('w1', 'x', 'mesero', 'Waiter')").run();
  db.prepare("INSERT INTO tables (id, number, capacity) VALUES ('t1', 1, 4)").run();
  db.prepare(`
    INSERT INTO orders (id, table_id, table_number, waiter_id, waiter_name, status, total, iva_amount)
    VALUES ('o1', 't1', 1, 'w1', 'Waiter', 'confirmed', 10000, 1150)
  `).run();
  orderId = 'o1';
});

function pay(amount) {
  return processPayment(db, { order_id: orderId, method: 'qr', amount, processed_by: 'w1' });
}

afterEach(() => db.close());

describe('processPayment — amount inválido (defensa en profundidad)', () => {
  it("amount 'abc' → throw (antes: Bs 0 silencioso)", () => {
    expect(() => pay('abc')).toThrow(/monto es inv[áa]lido/);
  });

  it('amount NaN → throw', () => {
    expect(() => pay(NaN)).toThrow(/monto es inv[áa]lido/);
  });

  it('amount -5 → throw (negativo)', () => {
    expect(() => pay(-5)).toThrow(/monto es inv[áa]lido/);
  });

  it('amount undefined → throw (contrato: la ruta siempre lo pasa)', () => {
    expect(() => pay(undefined)).toThrow(/monto es inv[áa]lido/);
  });

  it('amount inválido NO inserta pago (sin huérfanos)', () => {
    try { pay('abc'); } catch { /* esperado */ }
    const count = db.prepare('SELECT COUNT(*) as c FROM payments WHERE order_id = ?').get(orderId).c;
    expect(count).toBe(0);
  });
});

describe('processPayment — amount válido', () => {
  it('amount 3450 (entero, centavos) → pago registrado con ese monto', () => {
    const result = pay(3450);
    expect(result.paymentId).toBeTruthy();
    expect(result.fullyPaid).toBe(false);
    expect(result.remaining).toBe(6550);
    const row = db.prepare('SELECT amount FROM payments WHERE id = ?').get(result.paymentId);
    expect(row.amount).toBe(3450);
  });

  it('amount "34.5" (string decimal legacy) → 3450 centavos (retrocompat)', () => {
    const result = pay('34.5');
    expect(result.paymentId).toBeTruthy();
    expect(result.remaining).toBe(6550);
  });
});
