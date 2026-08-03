/**
 * Receipt utilities — pure functions for printable receipts.
 *
 * TDD-friendly: no DOM, no window — just data in, data out.
 * Used by PrintReceipt + the e2e full-flow smoke test.
 *
 * Business name defaults to the restaurant brand (config-driven at the
 * view layer; pure functions receive it as a parameter).
 */

// ============================================================
// Types
// ============================================================

export interface ReceiptItem {
  name: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  /** Human-readable modifier summary, e.g. "Familiar +20" */
  modifiers?: string;
}

export interface ReceiptData {
  businessName: string;
  orderId: string;
  tableNumber: number | null;
  /** ISO date */
  createdAt: string;
  items: ReceiptItem[];
  subtotal: number;
  ivaAmount: number;
  total: number;
  paymentMethod?: string;
  /** Short code shown on thermal receipts, e.g. first 8 chars of order id */
  receiptCode?: string;
}

export interface ClosingReceiptData {
  businessName: string;
  /** ISO date */
  date: string;
  totalSales: number;
  totalIva: number;
  totalOrders: number;
  byMethod: Record<string, number>;
  expectedCash: number;
  actualCash: number;
  difference: number;
  reconciled: boolean;
  notes?: string;
}

export interface InvoiceReceiptData {
  businessName: string;
  nit: string;
  customerName: string;
  orderId: string;
  amount: number;
  ivaAmount: number;
  /** ISO date */
  date: string;
}

// ============================================================
// Formatters (pure)
// ============================================================

/** Format an amount as BOB currency string. */
export function formatBs(amount: number): string {
  return `Bs. ${Number(amount || 0).toFixed(2)}`;
}

/** Format an ISO date as dd/mm/yyyy HH:mm (deterministic, testable). */
export function formatReceiptDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Derive a short receipt code from an order id (last 8 chars, uppercase). */
export function toReceiptCode(orderId: string): string {
  const clean = String(orderId || '').replace(/[^a-zA-Z0-9]/g, '');
  if (!clean) return '-----';
  return clean.slice(-8).toUpperCase();
}

// ============================================================
// Builders (pure)
// ============================================================

/**
 * Build ReceiptData from a normalized Order (ordersApi.Order).
 * Modifier adjustments are already reflected in the order item subtotals.
 */
export function buildReceiptData(
  order: {
    id: string;
    tableNumber: number | null;
    createdAt: string;
    subtotal: number;
    ivaAmount: number;
    total: number;
    paymentMethod?: string | null;
    items: Array<{
      menuItemName: string;
      quantity: number;
      unitPrice: number;
      subtotal: number;
      modifiers?: Array<{ groupName?: string; optionName: string; priceAdjustment?: number }>;
    }>;
  },
  businessName = 'El Rey de la Chelada'
): ReceiptData {
  return {
    businessName,
    orderId: order.id,
    tableNumber: order.tableNumber ?? null,
    createdAt: order.createdAt,
    receiptCode: toReceiptCode(order.id),
    items: order.items.map(item => ({
      name: item.menuItemName,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      lineTotal: item.subtotal,
      modifiers: (item.modifiers || [])
        .map(m => {
          const adj = Number(m.priceAdjustment || 0);
          return adj > 0 ? `${m.optionName} +${formatBs(adj)}` : m.optionName;
        })
        .join(', ') || undefined,
    })),
    subtotal: order.subtotal,
    ivaAmount: order.ivaAmount,
    total: order.total,
    paymentMethod: order.paymentMethod ?? undefined,
  };
}

/**
 * Compute receipt totals from line items (defensive — used when the
 * order object lacks precomputed totals).
 */
export function computeReceiptTotals(items: ReceiptItem[]) {
  const subtotal = items.reduce((sum, i) => sum + i.lineTotal, 0);
  const ivaAmount = Math.round(subtotal * 0.13 * 100) / 100;
  const total = Math.round((subtotal + ivaAmount) * 100) / 100;
  return { subtotal, ivaAmount, total };
}

// ============================================================
// Defaults
// ============================================================

export const DEFAULT_BUSINESS_NAME = 'El Rey de la Chelada';
export const DEFAULT_THANKS = 'Gracias por su visita';

export default {
  formatBs,
  formatReceiptDate,
  toReceiptCode,
  buildReceiptData,
  computeReceiptTotals,
  DEFAULT_BUSINESS_NAME,
  DEFAULT_THANKS,
};
