/**
 * CSV export utilities — pure, client-side CSV generation.
 *
 * - buildDailySalesCsv: daily sales report → CSV string with UTF-8 BOM
 *   (\uFEFF) so Excel opens it correctly with Spanish characters.
 * - downloadCsv: browser download helper (Blob + object URL).
 *
 * CONTRATO DE CENTAVOS: los montos de entrada (`DailySalesCsvSource`) llegan
 * en CENTAVOS (enteros). El CSV es formato MÁQUINA (Excel lo parsea
 * numéricamente) → aquí SIEMPRE se emite Bs decimal con PUNTO decimal,
 * nunca el display humano ("Bs 12,50") de formatMoney.
 *
 * No external dependencies.
 */

// ============================================================
// Escaping (pure)
// ============================================================

/** Convierte CENTAVOS a Bs (formato máquina: punto decimal, 2 dígitos). */
function centsToBs(cents: number): string {
  return (cents / 100).toFixed(2);
}

/** Escape a single CSV field (RFC 4180: quote if it contains , " or newline). */
export function csvEscape(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  const s = String(value);
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/** Join fields into a CSV line (CRLF for Excel compatibility). */
export function csvLine(fields: Array<string | number | null | undefined>): string {
  return fields.map(csvEscape).join(',');
}

// ============================================================
// Daily sales report → CSV (pure)
// ============================================================

export interface DailySalesCsvSource {
  date: string;
  totalOrders: number;
  completedOrders: number;
  cancelledOrders: number;
  /** Venta bruta en CENTAVOS (entero). */
  grossRevenue: number;
  /** Venta neta en CENTAVOS (entero). */
  totalSales: number;
  /** IVA en CENTAVOS (entero). */
  totalIva: number;
  /** Base imponible en CENTAVOS (entero). */
  baseRevenue: number;
  /** Ticket promedio en CENTAVOS (entero). */
  averageTicket: number;
  /** Recaudación por método en CENTAVOS (entero). */
  byMethod: Record<string, number>;
}

const METHOD_LABELS: Record<string, string> = {
  cash: 'Efectivo',
  qr: 'QR',
};

const DEFAULT_METHODS = ['cash', 'qr'];

/**
 * Build a CSV string for the daily sales report.
 * Includes a UTF-8 BOM (\uFEFF) prefix for Excel compatibility.
 *
 * Layout:
 *   row 1: header
 *   row 2: summary values
 *   rows 3..n: one row per payment method with revenue
 *
 * @param daily normalized DailySales object (from reportsApi)
 * @param _ivaRate IVA rate as decimal (0.13) — kept for API stability; the
 *   report already carries precomputed IVA totals in `daily.totalIva`.
 * @param opts.methods optional ordered method keys (defaults to all 5)
 * @returns CSV string starting with \uFEFF
 */
export function buildDailySalesCsv(
  daily: DailySalesCsvSource,
  _ivaRate = 0.13,
  opts: { methods?: string[] } = {}
): string {
  const methods = opts.methods || DEFAULT_METHODS;

  const header = [
    'Fecha',
    'Pedidos totales',
    'Pedidos pagados',
    'Pedidos cancelados',
    'Venta bruta (Bs)',
    'Venta neta (Bs)',
    'IVA (Bs)',
    'Base imponible (Bs)',
    'Ticket promedio (Bs)',
    ...methods.map(m => METHOD_LABELS[m] || m),
  ];

  const summaryRow = [
    daily.date,
    daily.totalOrders,
    daily.completedOrders,
    daily.cancelledOrders,
    centsToBs(daily.grossRevenue),
    centsToBs(daily.totalSales),
    centsToBs(daily.totalIva),
    centsToBs(daily.baseRevenue),
    centsToBs(daily.averageTicket),
    ...methods.map(m => centsToBs(daily.byMethod[m] ?? 0)),
  ];

  const methodRows = methods
    .filter(m => (daily.byMethod[m] ?? 0) > 0)
    .map(m => [METHOD_LABELS[m] || m, centsToBs(daily.byMethod[m] ?? 0)]);

  const lines = [csvLine(header), csvLine(summaryRow), ...methodRows.map(r => csvLine(r))];

  // BOM for Excel (opens UTF-8 CSV with correct accents/ñ)
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

// ============================================================
// Download (browser-only)
// ============================================================

/**
 * Trigger a client-side CSV download (Blob + anchor).
 * @param filename e.g. "ventas-2026-08-03.csv"
 * @param csv CSV content (may include BOM)
 */
export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** Build a filename for the daily CSV export, e.g. "ventas-2026-08-03.csv". */
export function dailyCsvFilename(date: string): string {
  return `ventas-${date}.csv`;
}

export default { csvEscape, csvLine, buildDailySalesCsv, downloadCsv, dailyCsvFilename };
