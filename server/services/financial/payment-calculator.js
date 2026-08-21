const METHODS = new Set(['cash', 'qr']);

function cents(value, field) {
  if (typeof value === 'string' && value.trim() === '') throw new Error(`${field} debe ser centavos`);
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw new Error(`${field} debe ser centavos enteros no negativos`);
  return number;
}

export function calculatePayment(input) {
  const { method, amount, received } = input;
  if (!METHODS.has(method)) throw new Error('Método de pago inválido');
  const paymentAmount = cents(amount, 'amount');
  if (paymentAmount === 0) throw new Error('amount debe ser mayor que cero');
  if (method !== 'cash' && received !== undefined && received !== null) {
    throw new Error('received solo aplica a cash');
  }
  const paymentReceived = method === 'cash' ? cents(received ?? paymentAmount, 'received') : paymentAmount;
  if (paymentReceived < paymentAmount) throw new Error('received no puede ser menor que amount');
  return { method, amount: paymentAmount, received: paymentReceived, change: paymentReceived - paymentAmount, reference: input.reference || '' };
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
