/**
 * Receipt utils tests — pure formatting + building functions.
 *
 * TDD: pin the receipt data shapes used by the PrintReceipt component
 * and the e2e full-flow smoke test.
 */

import { describe, it, expect } from 'vitest';
import {
  formatBs,
  formatReceiptDate,
  toReceiptCode,
  buildReceiptData,
  computeReceiptTotals,
} from '../../src/pwa/_shared/utils/receipt';

describe('formatBs', () => {
  it('formats whole amounts with two decimals', () => {
    expect(formatBs(25)).toBe('Bs 25,00');
  });

  it('formats decimals', () => {
    expect(formatBs(45.5)).toBe('Bs 45,50');
  });

  it('formats zero', () => {
    expect(formatBs(0)).toBe('Bs 0,00');
  });

  it('handles null/undefined defensively', () => {
    expect(formatBs(null as unknown as number)).toBe('Bs 0,00');
  });
});

describe('formatReceiptDate', () => {
  it('formats an ISO date as dd/mm/yyyy HH:mm', () => {
    // 2026-08-03 14:30 local
    expect(formatReceiptDate('2026-08-03T14:30:00')).toBe('03/08/2026 14:30');
  });

  it('pads single-digit day/month/hour/minute', () => {
    expect(formatReceiptDate('2026-01-05T09:05:00')).toBe('05/01/2026 09:05');
  });

  it('returns the raw string for invalid dates', () => {
    expect(formatReceiptDate('not-a-date')).toBe('not-a-date');
  });
});

describe('toReceiptCode', () => {
  it('returns last 8 alphanumeric chars uppercase', () => {
    expect(toReceiptCode('abc-1234567890-xyz')).toBe('67890XYZ');
  });

  it('handles short ids', () => {
    expect(toReceiptCode('ab1')).toBe('AB1');
  });

  it('returns a placeholder for empty ids', () => {
    expect(toReceiptCode('')).toBe('-----');
  });
});

describe('buildReceiptData', () => {
  const order = {
    id: 'order-12345678-extra',
    tableNumber: 4,
    createdAt: '2026-08-03T14:30:00',
    subtotal: 100,
    ivaAmount: 13,
    total: 113,
    paymentMethod: 'cash',
    items: [
      {
        menuItemName: 'Cheve-Chango',
        quantity: 2,
        unitPrice: 30,
        subtotal: 60,
        modifiers: [],
      },
      {
        menuItemName: 'La Rey',
        quantity: 1,
        unitPrice: 75,
        subtotal: 75,
        modifiers: [{ groupName: 'Tamaño', optionName: 'Familiar', priceAdjustment: 20 }],
      },
    ],
  };

  it('maps order fields into receipt data', () => {
    const receipt = buildReceiptData(order);
    expect(receipt.orderId).toBe('order-12345678-extra');
    expect(receipt.tableNumber).toBe(4);
    expect(receipt.createdAt).toBe('2026-08-03T14:30:00');
    expect(receipt.total).toBe(113);
    expect(receipt.subtotal).toBe(100);
    expect(receipt.ivaAmount).toBe(13);
    expect(receipt.paymentMethod).toBe('cash');
    expect(receipt.receiptCode).toBe(toReceiptCode(order.id));
  });

  it('maps items with quantity, price and line total', () => {
    const receipt = buildReceiptData(order);
    expect(receipt.items).toHaveLength(2);
    expect(receipt.items[0]).toMatchObject({
      name: 'Cheve-Chango',
      quantity: 2,
      unitPrice: 30,
      lineTotal: 60,
    });
    expect(receipt.items[0].modifiers).toBeUndefined();
  });

  it('summarizes positive modifier adjustments on items', () => {
    const receipt = buildReceiptData(order);
    expect(receipt.items[1].modifiers).toBe('Familiar +Bs 20,00');
  });

  it('uses default business name when not provided', () => {
    expect(buildReceiptData(order).businessName).toBe('El Rey de la Chelada');
  });

  it('accepts a custom business name', () => {
    expect(buildReceiptData(order, 'Mi Bar').businessName).toBe('Mi Bar');
  });

  it('handles orders without table', () => {
    const noTable = { ...order, tableNumber: null };
    expect(buildReceiptData(noTable).tableNumber).toBeNull();
  });

  it('handles missing payment method', () => {
    const noPay = { ...order, paymentMethod: null };
    expect(buildReceiptData(noPay).paymentMethod).toBeUndefined();
  });
});

describe('computeReceiptTotals', () => {
  it('computes subtotal (base), extracted IVA and total (line total incluye IVA)', () => {
    const totals = computeReceiptTotals([
      { name: 'A', quantity: 1, unitPrice: 60, lineTotal: 60 },
      { name: 'B', quantity: 1, unitPrice: 40, lineTotal: 40 },
    ]);
    // Modelo SSOT EXTRACTIVO: lineTotal ya incluye IVA → total 100,
    // subtotal (base) 100/1.13 = 88.5, iva 11.5.
    expect(totals.subtotal).toBe(88.5);
    expect(totals.ivaAmount).toBe(11.5);
    expect(totals.total).toBe(100);
  });

  it('returns zeros for empty items', () => {
    const totals = computeReceiptTotals([]);
    expect(totals).toEqual({ subtotal: 0, ivaAmount: 0, total: 0 });
  });
});
