/**
 * CSV export utils tests — pure CSV generation with Excel BOM.
 *
 * TDD: pin the CSV layout (header, summary row, method rows) and the
 * BOM prefix required for Excel compatibility.
 */

import { describe, it, expect } from 'vitest';
import {
  csvEscape,
  csvLine,
  buildDailySalesCsv,
  dailyCsvFilename,
} from '../../src/pwa/_shared/utils/csvExport';

function makeDaily() {
  return {
    date: '2026-08-03',
    totalOrders: 5,
    completedOrders: 4,
    cancelledOrders: 1,
    grossRevenue: 40000,
    totalSales: 35000,
    totalIva: 4027,
    baseRevenue: 30973,
    averageTicket: 8750,
    byMethod: { cash: 25000, qr: 10000 },
  };
}

describe('csvEscape', () => {
  it('returns plain values unchanged', () => {
    expect(csvEscape('Cheve-Chango')).toBe('Cheve-Chango');
    expect(csvEscape(30)).toBe('30');
    expect(csvEscape(30.5)).toBe('30.5');
  });

  it('quotes values containing commas', () => {
    expect(csvEscape('Sandía-Loca, la original')).toBe('"Sandía-Loca, la original"');
  });

  it('doubles embedded quotes', () => {
    expect(csvEscape('Dijo "hola"')).toBe('"Dijo ""hola"""');
  });

  it('quotes values with newlines', () => {
    expect(csvEscape('a\nb')).toBe('"a\nb"');
  });

  it('turns null/undefined into empty string', () => {
    expect(csvEscape(null)).toBe('');
    expect(csvEscape(undefined)).toBe('');
  });
});

describe('csvLine', () => {
  it('joins fields with commas', () => {
    expect(csvLine(['a', 1, null])).toBe('a,1,');
  });

  it('escapes individual fields', () => {
    expect(csvLine(['a,b', 'c'])).toBe('"a,b",c');
  });
});

describe('buildDailySalesCsv', () => {
  it('prepends the UTF-8 BOM for Excel compatibility', () => {
    const csv = buildDailySalesCsv(makeDaily());
    expect(csv.startsWith('\uFEFF')).toBe(true);
  });

  it('includes a header row with all metrics', () => {
    const csv = buildDailySalesCsv(makeDaily());
    const lines = csv.replace('\uFEFF', '').trim().split('\r\n');
    expect(lines[0]).toContain('Fecha');
    expect(lines[0]).toContain('Venta neta (Bs)');
    expect(lines[0]).toContain('Efectivo');
    expect(lines[0]).toContain('QR');
  });

  it('includes a summary row with values', () => {
    const csv = buildDailySalesCsv(makeDaily());
    const lines = csv.replace('\uFEFF', '').trim().split('\r\n');
    expect(lines[1]).toContain('2026-08-03');
    expect(lines[1]).toContain('350.00');
    expect(lines[1]).toContain('40.27');
  });

  it('adds a row per non-zero payment method', () => {
    const csv = buildDailySalesCsv(makeDaily());
    const lines = csv.replace('\uFEFF', '').trim().split('\r\n');
    // header + summary + cash + qr = 4 lines
    expect(lines).toHaveLength(4);
    expect(lines[2]).toBe('Efectivo,250.00');
    expect(lines[3]).toBe('QR,100.00');
  });

  it('handles empty methods with only header + summary', () => {
    const daily = makeDaily();
    daily.byMethod = {};
    const csv = buildDailySalesCsv(daily);
    const lines = csv.replace('\uFEFF', '').trim().split('\r\n');
    expect(lines).toHaveLength(2);
  });

  it('uses CRLF line endings', () => {
    const csv = buildDailySalesCsv(makeDaily());
    expect(csv).toContain('\r\n');
    expect(csv).not.toContain('\n\r');
  });
});

describe('dailyCsvFilename', () => {
  it('builds ventas-YYYY-MM-DD.csv', () => {
    expect(dailyCsvFilename('2026-08-03')).toBe('ventas-2026-08-03.csv');
  });
});
