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
export function resolveChangeSplit(changeAvailable: number, cashGiven: number, _qrGiven: number) {
  const available = Math.max(0, changeAvailable);
  // max cambio en efectivo = lo que cabe en el efectivo recibido.
  const maxChangeCash = Math.min(available, cashGiven);
  // min cambio en efectivo = 0: el vuelto por QR es un RETIRO del local (no
  // requiere QR entrante), así que el efectivo puede ser 0 y todo ir por QR.
  const minChangeCash = 0;
  // default: dar el cambio en efectivo tanto como sea posible.
  const defaultChangeCash = maxChangeCash;
  // clamp de un valor de cambio en efectivo al rango factible.
  const clampChangeCash = (value: number) =>
    Math.min(maxChangeCash, Math.max(minChangeCash, value));
  const changeCash = clampChangeCash(defaultChangeCash);
  const changeQr = available - changeCash;
  const valid = changeQr >= 0 && changeCash >= 0 && changeCash <= cashGiven;
  return { changeCash, changeQr, minChangeCash, maxChangeCash, valid };
}

/** Clamp genérico a [min, max]. */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Rango factible del cambio en efectivo dado el cambio total y el contexto
 * (efectivo/QR recibidos). Devuelve los límites INCLUSO si cashGiven/qrGiven
 * no se pasan (≈ sin techo, para el caso "solo conozco el cambio total").
 */
export function resolveChangeBounds(changeAvailable: number, cashGiven?: number, _qrGiven?: number) {
  const available = Math.max(0, changeAvailable);
  // max cambio en efectivo = lo que cabe en el efectivo recibido (∞ si no se dio).
  const maxChangeCash = Number.isFinite(cashGiven) ? Math.min(available, cashGiven) : available;
  // min cambio en efectivo = 0: el vuelto por QR es retiro del local (no requiere QR).
  const minChangeCash = 0;
  return { available, minChangeCash, maxChangeCash };
}

/**
 * Cambio EDIBLE (OPCIÓN A, 2026-08-27): el usuario escribe UNO de los dos
 * (efectivo o QR) y el OTRO se deriva para que SIEMPRE sumen `changeAvailable`.
 *
 * `resolveChangeFromCash(changeAvailable, cashValue)` → { changeCash, changeQr }.
 * "- Si pido efectivo=2000 y hay 2500 → efectivo=2000, QR=500.
 *  - Si pido efectivo=3000 y hay 2500 → clamp a 2500, QR=0 (nunca excede).
 *  - `cashGiven`/`qrGiven` opcionales: al pasarlos se respeta la regla de
 *    negocio (cambio QR ≤ qrGiven, cambio efectivo ≤ cashGiven).
 */
export function resolveChangeFromCash(
  changeAvailable: number,
  cashValue: number,
  cashGiven?: number,
  qrGiven?: number
): { changeCash: number; changeQr: number } {
  const { available, minChangeCash, maxChangeCash } = resolveChangeBounds(changeAvailable, cashGiven, qrGiven);
  const changeCash = clamp(cashValue, minChangeCash, maxChangeCash);
  return { changeCash, changeQr: available - changeCash };
}

/**
 * `resolveChangeFromQr(changeAvailable, qrValue)` → { changeCash, changeQr }.
 * El QR deseado se clampea a su techo factible (≤ min(changeAvailable, qrGiven))
 * y el efectivo es el complemento.
 */
export function resolveChangeFromQr(
  changeAvailable: number,
  qrValue: number,
  cashGiven?: number,
  qrGiven?: number
): { changeCash: number; changeQr: number } {
  const { available, minChangeCash } = resolveChangeBounds(changeAvailable, cashGiven, qrGiven);
  // techo QR = cambio que puede absorber el QR = available − min cambio en efectivo.
  const maxChangeQr = available - minChangeCash;
  const changeQr = clamp(qrValue, 0, maxChangeQr);
  return { changeCash: available - changeQr, changeQr };
}

/**
 * MEJORA 4 (2026-08-27): auto-limpiar fotos cuando el medio de pago ya no aplica.
 * - `changeQr <= 0` → no hay "cambio por QR" → las fotos del retiro QR sobran.
 * - `qrApplied <= 0` → no hay monto QR aplicado al pedido → las fotos del pago QR sobran.
 * Función pura testeable del efecto de React del PaymentPanel.
 */
export function shouldClearChangePhotos(changeQr: number): boolean {
  return changeQr <= 0;
}

export function shouldClearProofPhotos(qrApplied: number): boolean {
  return qrApplied <= 0;
}

/**
 * REGLA SIMPLE DE COBRO (SSOT 2026-08-28):
 *   (Efectivo entregado + QR pagado) − (Cambio efectivo + Cambio QR) = Monto del pedido.
 *
 * El mesero decide el reparto del vuelto; el sistema solo valida que la resta
 * cuadre con el total del pedido. Devuelve true si el cobro es válido.
 *
 * Restricciones de negocio (evitan el 409 PAYMENT_CONFLICT del server):
 *   - changeCash ≤ cashGiven  (el vuelto en efectivo sale del efectivo recibido)
 *   - changeQr es un RETIRO del local (transferencia saliente) → NO está limitado
 *     a qrGiven. Si el cliente pagó efectivo de más, el local le transfiere el
 *     vuelto por QR (el local "saca" ese dinero). Por eso solo se limita a que
 *     cash+qr − cambios = pedido, y a que el cambio no sea negativo.
 */
export function validateChangeRule(
  amountToCollect: number,
  cashGiven: number,
  qrGiven: number,
  changeCash: number,
  changeQr: number
): { ok: boolean; applied: number; valid: boolean; reason?: string } {
  const applied = (cashGiven + qrGiven) - (changeCash + changeQr);
  if (applied !== amountToCollect) {
    return { ok: false, applied, valid: false, reason: 'La suma aplicada no cuadra con el pedido' };
  }
  if (changeCash < 0 || changeQr < 0) {
    return { ok: false, applied, valid: false, reason: 'El cambio no puede ser negativo' };
  }
  if (changeCash > cashGiven) {
    return { ok: false, applied, valid: false, reason: 'El cambio en efectivo supera lo entregado en efectivo' };
  }
  return { ok: true, applied, valid: true };
}
