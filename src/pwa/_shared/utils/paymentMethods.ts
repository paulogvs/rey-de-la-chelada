/**
 * Payment methods — labels + icons compartidos (SSOT cliente)
 *
 * Reutilizado por SummaryView (caja), PaymentPanel (meseros) y
 * CollectView (caja, S2-C). NUNCA duplicar estas tablas en vistas.
 * methods: cash, qr_yape, qr_simple, card, transfer (SSOT server).
 */

export const METHOD_LABELS: Record<string, string> = {
  cash: 'Efectivo',
  qr_yape: 'Yape',
  qr_simple: 'QR Simple',
  card: 'Tarjeta',
  transfer: 'Transferencia',
};

export const METHOD_ICONS: Record<string, string> = {
  cash: '💵',
  qr_yape: '📱',
  qr_simple: '📱',
  card: '💳',
  transfer: '🏦',
};

export const PAYMENT_METHODS = ['cash', 'qr_yape', 'qr_simple', 'card', 'transfer'] as const;

export function methodLabel(method: string): string {
  return METHOD_LABELS[method] || method;
}

export function methodIcon(method: string): string {
  return METHOD_ICONS[method] || '💰';
}

export default { METHOD_LABELS, METHOD_ICONS, PAYMENT_METHODS, methodLabel, methodIcon };
