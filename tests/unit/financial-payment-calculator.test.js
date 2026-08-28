import { describe, expect, it } from 'vitest';
import { calculatePayment, calculateMixedPayments } from '../../server/services/financial/payment-calculator.js';

describe('financial payment calculator', () => {
  it('calculates cash change using integer cents', () => {
    expect(calculatePayment({ method: 'cash', amount: 3450, received: 5000 })).toEqual({
      method: 'cash', amount: 3450, received: 5000, change: 1550, reference: '',
    });
  });

  it('calculates a mixed allocation against the remaining balance', () => {
    expect(calculateMixedPayments(10000, 2500, [
      { method: 'cash', amount: 4000, received: 5000, reference: '' },
      { method: 'qr', amount: 3500, reference: 'qr-1' },
    ])).toMatchObject({
      orderTotal: 10000,
      paidBefore: 2500,
      paidAmount: 10000,
      remaining: 0,
      isFullyPaid: true,
      byMethod: { cash: 4000, qr: 3500 },
    });
  });

  it('rejects negative, overpaid, and invalid allocations', () => {
    expect(() => calculatePayment({ method: 'cash', amount: -1 })).toThrow(/centavos/);
    expect(() => calculateMixedPayments(1000, 0, [{ method: 'qr', amount: 1001 }])).toThrow(/saldo/);
    expect(() => calculatePayment({ method: 'qr', amount: 100, received: 100 })).toThrow(/received/);
  });

  it('retiro QR (negativo) NO descuenta el pago del pedido (regresión escenario E2)', () => {
    // Pedido 4000, paga cash 4000 (cubre) + retiro QR -5000 (vuelto por QR).
    // El retiro NO debe bajar paidAmount: debe quedar 4000 y fullyPaid=true.
    const r = calculateMixedPayments(4000, 0, [
      { method: 'cash', amount: 4000, received: 9000, change: 5000 },
      { method: 'qr', amount: 5000, transferOut: true, reference: 'RETIRO QR' },
    ]);
    expect(r.paidAmount).toBe(4000);
    expect(r.isFullyPaid).toBe(true);
    expect(r.remaining).toBe(0);
    // el retiro QR sigue siendo amount negativo en los payments
    const retiro = r.payments.find(p => p.transferOut);
    expect(retiro.amount).toBe(-5000);
  });
});
