export type AllocationMethod = 'cash' | 'qr';

export interface PaymentAllocationInput {
  method: AllocationMethod;
  amount: number;
  received?: number;
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
      ...(allocation.method === 'qr' && allocation.reference ? { reference: allocation.reference } : {}),
    })),
  };
}
