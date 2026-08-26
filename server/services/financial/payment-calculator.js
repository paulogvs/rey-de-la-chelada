const METHODS = new Set(['cash', 'qr']);

function cents(value, field) {
  if (typeof value === 'string' && value.trim() === '') throw new Error(`${field} debe ser centavos`);
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw new Error(`${field} debe ser centavos enteros no negativos`);
  return number;
}

export function calculatePayment(input) {
  const { method, amount, received, change } = input;

  // 2026-08-26: RETIRO QR (cambio por QR / transferencia saliente del local).
  // El mesero cobra efectivo sin cambio físico y devuelve el vuelto por QR.
  // Se registra como payment method='qr' con amount NEGATIVO (salida), que:
  //   - NO toca el saldo del pedido (recordPayment usa SUM(amount) > 0)
  //   - SÍ afecta el QR del día en el cierre (qr_today = SUM(amount) qr)
  //   - admite foto de comprobante de la transferencia (proof_photo)
  if (input.transferOut) {
    if (method !== 'qr') throw new Error('transferOut solo aplica a qr');
    const transferAmount = cents(amount, 'transfer amount');
    if (transferAmount === 0) throw new Error('El retiro QR debe ser mayor que cero');
    return {
      method: 'qr',
      amount: -transferAmount, // salida (negativo) en la DB
      received: transferAmount,
      change: 0,
      transferOut: true,
      reference: input.reference || 'RETIRO QR',
    };
  }

  if (!METHODS.has(method)) throw new Error('Método de pago inválido');
  const paymentAmount = cents(amount, 'amount');
  if (paymentAmount === 0) throw new Error('amount debe ser mayor que cero');
  if (method !== 'cash' && received !== undefined && received !== null) {
    throw new Error('received solo aplica a cash');
  }
  const paymentReceived = method === 'cash' ? cents(received ?? paymentAmount, 'received') : paymentAmount;
  if (paymentReceived < paymentAmount) throw new Error('received no puede ser menor que amount');

  // 2026-08-26: CHANGE EXPLÍCITO — con "cambio por QR" el vuelto NO sale del
  // cajón: la cajera/mesero indica cuánto cambio se da EN EFECTIVO (default =
  // todo el cambio). El resto del vuelto (received − amount − changeEfectivo)
  // se devuelve por QR como retiro. El neto físico del cajón = received − change.
  const defaultChange = paymentReceived - paymentAmount;
  const explicitChange = change === undefined || change === null ? defaultChange : cents(change, 'change');
  if (explicitChange < 0 || explicitChange > defaultChange) {
    throw new Error('change no puede ser negativo ni exceder el vuelto total');
  }
  return { method, amount: paymentAmount, received: paymentReceived, change: explicitChange, reference: input.reference || '' };
}

export function calculateMixedPayments(orderTotal, paidBefore, allocations) {
  const total = cents(orderTotal, 'order total');
  const previous = cents(paidBefore, 'paid amount');
  if (!Array.isArray(allocations) || allocations.length === 0) throw new Error('allocations es requerido');
  if (previous > total) throw new Error('El saldo pagado excede el total');
  const remainingBefore = total - previous;
  const payments = allocations.map(calculatePayment);
  const allocated = payments.reduce((sum, payment) => sum + payment.amount, 0);
  if (allocated > remainingBefore) throw new Error('La asignación excede el saldo pendiente');
  const byMethod = { cash: 0, qr: 0 };
  for (const payment of payments) byMethod[payment.method] += payment.amount;
  return {
    payments,
    orderTotal: total,
    paidBefore: previous,
    paidAmount: previous + allocated,
    remaining: total - previous - allocated,
    isFullyPaid: previous + allocated === total,
    byMethod,
  };
}

export { cents };
