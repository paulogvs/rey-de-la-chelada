import { describe, expect, it } from 'vitest';
import { buildMixedPaymentPayload, previewAllocations } from '../../src/pwa/_shared/utils/paymentAllocations';

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
