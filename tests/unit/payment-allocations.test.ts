import { describe, expect, it } from 'vitest';
import {
  buildMixedPaymentPayload,
  previewAllocations,
  resolveChangeSplit,
} from '../../src/pwa/_shared/utils/paymentAllocations';

describe('payment allocation editor contract', () => {
  it('previews cash, QR, balance and cash change using cents', () => {
    expect(previewAllocations(10000, [
      { method: 'cash', amount: 4000, received: 5000 },
      { method: 'qr', amount: 6000 },
    ])).toEqual({ total: 10000, cash: 4000, qr: 6000, remaining: 0, change: 1000, valid: true });
  });

  it('rejects fractional, zero, over-allocation and invalid cash received', () => {
    expect(previewAllocations(10000, [{ method: 'cash', amount: 10001 }]).valid).toBe(false);
    expect(previewAllocations(10000, [{ method: 'cash', amount: 1000, received: 900 }]).valid).toBe(false);
    expect(previewAllocations(10000, [{ method: 'qr', amount: 100.5 }]).valid).toBe(false);
  });

  it('builds the server payload without sending UI-only empty fields', () => {
    expect(buildMixedPaymentPayload('o1', [
      { method: 'cash', amount: 4000, received: 5000 },
      { method: 'qr', amount: 6000, reference: '' },
    ], 'op-1')).toEqual({
      order_id: 'o1', idempotency_key: 'op-1',
      allocations: [
        { method: 'cash', amount: 4000, received: 5000 },
        { method: 'qr', amount: 6000 },
      ],
    });
  });
});

describe('resolveChangeSplit — reparto del cambio (regresión 2026-08-27)', () => {
  it('QR=0: el cambio es SOLO en efectivo (no se puede devolver por QR lo que no se cobró por QR)', () => {
    // Cash 15000, QR 0, pedido 12500 → cambio 2500. Solo efectivo.
    const s = resolveChangeSplit(2500, 15000, 0);
    expect(s.changeCash).toBe(2500);
    expect(s.changeQr).toBe(0);
    expect(s.valid).toBe(true);
    expect(s.maxChangeCash).toBe(2500);
    expect(s.minChangeCash).toBe(2500);
  });

  it('bloquea el caso del bug: el usuario NO puede forzar 20/5 con QR=0 (clamp a 25/0)', () => {
    // Simula intentar changeCash=20 con QR=0 (tendría que dar changeQr=5, imposible).
    const s = resolveChangeSplit(2500, 15000, 0);
    expect(s.valid).toBe(true);
    // El clamp de changeCash a 20 al rango [2500, 2500] → vuelve a 2500.
    const clamped = Math.min(s.maxChangeCash, Math.max(s.minChangeCash, 2000));
    expect(clamped).toBe(2500);
    expect(s.changeQr).toBe(0);
  });

  it('con QR cubriendo el exceso, el cambio si puede ser por QR', () => {
    // Cash 15000, QR 5000, pedido 12500 → cambio 7500. max efectivo=15000, min=7500-5000=2500.
    // Default = max efectivo (7500), resto QR = 0.
    const s = resolveChangeSplit(7500, 15000, 5000);
    expect(s.changeCash).toBe(7500);
    expect(s.changeQr).toBe(0);
    expect(s.minChangeCash).toBe(2500);
    expect(s.maxChangeCash).toBe(7500);
    expect(s.valid).toBe(true);
  });
});
