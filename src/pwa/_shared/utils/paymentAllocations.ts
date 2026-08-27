export type AllocationMethod = 'cash' | 'qr';

export interface PaymentAllocationInput {
  method: AllocationMethod;
  amount: number;
  received?: number;
  /** 2026-08-26: cambio entregado EN EFECTIVO (default = todo el vuelto).
   *  Con "cambio por QR", change < received − amount (el resto sale por QR). */
  change?: number;
  reference?: string;
}

export interface AllocationPreview {
  total: number;
  cash: number;
  qr: number;
  remaining: number;
  change: number;
  valid: boolean;
}

export function previewAllocations(
  orderRemaining: number,
  allocations: PaymentAllocationInput[]
): AllocationPreview {
  const total = allocations.reduce((sum, allocation) => sum + Math.max(0, allocation.amount), 0);
  const cash = allocations.filter(a => a.method === 'cash').reduce((sum, a) => sum + Math.max(0, a.amount), 0);
  const qr = allocations.filter(a => a.method === 'qr').reduce((sum, a) => sum + Math.max(0, a.amount), 0);
  const received = allocations
    .filter(a => a.method === 'cash')
    .reduce((sum, a) => sum + Math.max(0, a.received ?? a.amount), 0);

  return {
    total,
    cash,
    qr,
    remaining: Math.max(0, orderRemaining - total),
    change: Math.max(0, received - cash),
    valid: total > 0 && total <= orderRemaining && allocations.every(a =>
      Number.isSafeInteger(a.amount) && a.amount > 0 &&
      (a.method !== 'cash' || (a.received === undefined || Number.isSafeInteger(a.received)) && (a.received ?? a.amount) >= a.amount)
    ),
  };
}

export function buildMixedPaymentPayload(
  orderId: string,
  allocations: PaymentAllocationInput[],
  idempotencyKey: string
) {
  return {
    order_id: orderId,
    idempotency_key: idempotencyKey,
    allocations: allocations.map(allocation => ({
      method: allocation.method,
      amount: allocation.amount,
      ...(allocation.method === 'cash' && allocation.received !== undefined ? { received: allocation.received } : {}),
      ...(allocation.method === 'cash' && allocation.change !== undefined ? { change: allocation.change } : {}),
      ...(allocation.method === 'qr' && allocation.reference ? { reference: allocation.reference } : {}),
    })),
  };
}

/**
 * Reparto del cambio entre efectivo y QR (FIX 2026-08-27).
 *
 * Regla de negocio: el cambio por QR NO puede superar lo que efectivamente se
 * cobró por QR (`ruleQrGiven`), porque no se puede "devolver" por QR dinero que
 * no entró por QR. Si QR=0, el cambio es SOLO en efectivo.
 *
 * @param changeAvailable cambio total a devolver (efectivo + QR recibido − pedido)
 * @param cashGiven       efectivo entregado por el cliente
 * @param qrGiven         monto pagado por QR (el "techo" del cambio QR)
 * @returns { changeCash, changeQr, minChangeCash, maxChangeCash, valid }
 */
export function resolveChangeSplit(changeAvailable: number, cashGiven: number, qrGiven: number) {
  const available = Math.max(0, changeAvailable);
  // max cambio en efectivo = lo que cabe en el efectivo recibido.
  const maxChangeCash = Math.min(available, cashGiven);
  // min cambio en efectivo = cambio que NO se puede dar por QR (resta el techo QR).
  const minChangeCash = Math.max(0, available - qrGiven);
  // default: dar el cambio en efectivo tanto como sea posible.
  const defaultChangeCash = maxChangeCash;
  // clamp de un valor de cambio en efectivo al rango factible.
  const clampChangeCash = (value: number) =>
    Math.min(maxChangeCash, Math.max(minChangeCash, value));
  const changeCash = clampChangeCash(defaultChangeCash);
  const changeQr = available - changeCash;
  const valid = changeQr >= 0 && changeQr <= qrGiven && changeCash >= 0 && changeCash <= cashGiven;
  return { changeCash, changeQr, minChangeCash, maxChangeCash, valid };
}
