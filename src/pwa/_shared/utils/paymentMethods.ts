/**
 * Payment methods — labels + icons compartidos (SSOT cliente)
 *
 * Reutilizado por SummaryView (caja), PaymentPanel (meseros) y
 * CollectView (caja, S2-C). NUNCA duplicar estas tablas en vistas.
 * methods: cash, qr (FASE 3 — solo Efectivo o QR; el corte separa cajón vs depósito).
 */

export const METHOD_LABELS: Record<string, string> = {
  cash: 'Efectivo',
  qr: 'QR',
};

export const METHOD_ICONS: Record<string, string> = {
  cash: '💵',
  qr: '📱',
};

export const PAYMENT_METHODS = ['cash', 'qr'] as const;

export function methodLabel(method: string): string {
  return METHOD_LABELS[method] || method;
}

export function methodIcon(method: string): string {
  return METHOD_ICONS[method] || '💰';
}

export default { METHOD_LABELS, METHOD_ICONS, PAYMENT_METHODS, methodLabel, methodIcon };
