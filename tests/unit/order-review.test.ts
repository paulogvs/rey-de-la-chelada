import { describe, expect, it } from 'vitest';
import { summarizeOrderReview } from '@/pwa/meseros/orderReview';

describe('summarizeOrderReview', () => {
  it('counts total units separately from cart lines', () => {
    expect(summarizeOrderReview([
      { quantity: 3, unitPrice: 25 },
      { quantity: 1, unitPrice: 40 },
    ])).toEqual({ lineCount: 2, totalQuantity: 4, total: 115 });
  });

  it('rounds monetary totals to cents', () => {
    expect(summarizeOrderReview([
      { quantity: 2, unitPrice: 12.345 },
      { quantity: 1, unitPrice: 0 },
    ]).total).toBe(24.69);
  });

  it('handles an empty review', () => {
    expect(summarizeOrderReview([])).toEqual({ lineCount: 0, totalQuantity: 0, total: 0 });
  });
});
