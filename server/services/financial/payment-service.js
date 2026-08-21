import { randomUUID } from 'node:crypto';
import { calculateMixedPayments, calculatePayment, cents } from './payment-calculator.js';

function operationResult(db, operation) {
  const order = db.prepare('SELECT total FROM orders WHERE id = ?').get(operation.order_id);
  const payments = db.prepare('SELECT * FROM payments WHERE payment_operation_id = ? ORDER BY rowid').all(operation.id);
  const allPayments = db.prepare("SELECT method, amount FROM payments WHERE order_id = ? AND status = 'completed'").all(operation.order_id);
  const paid = db.prepare("SELECT COALESCE(SUM(amount), 0) AS total FROM payments WHERE order_id = ? AND status = 'completed'").get(operation.order_id).total;
  const byMethod = { cash: 0, qr: 0 };
  for (const payment of allPayments) byMethod[payment.method] += payment.amount;
  return {
    operation_id: operation.id, order_total: order.total, paid_amount: paid,
    remaining: order.total - paid, is_fully_paid: paid === order.total,
    by_method: byMethod, payments,
    paymentId: payments[0]?.id, fullyPaid: paid === order.total,
  };
}

function ensureOrder(db, orderId) {
  const order = db.prepare('SELECT id, total, iva_amount, status, table_id FROM orders WHERE id = ?').get(orderId);
  if (!order) throw Object.assign(new Error(`Pedido no encontrado: ${orderId}`), { code: 'ORDER_NOT_FOUND' });
  if (order.status === 'cancelled') throw Object.assign(new Error('No se puede pagar un pedido cancelado'), { code: 'ORDER_CLOSED' });
  return order;
}

function updateOrder(db, order, paid, method, reference) {
  const fullyPaid = paid === order.total;
  db.prepare(`UPDATE orders SET is_paid = ?, payment_method = CASE WHEN ? THEN ? ELSE payment_method END,
    payment_reference = CASE WHEN ? THEN ? ELSE payment_reference END,
    paid_at = CASE WHEN ? THEN datetime('now') ELSE paid_at END,
    status = CASE WHEN ? THEN 'paid' ELSE status END, updated_at = datetime('now') WHERE id = ?`)
    .run(fullyPaid ? 1 : 0, method ? 1 : 0, method || '', method ? 1 : 0, reference || '', fullyPaid ? 1 : 0, fullyPaid ? 1 : 0, order.id);
  if (fullyPaid && order.table_id && !db.prepare("SELECT id FROM orders WHERE table_id = ? AND status NOT IN ('paid','cancelled') AND id != ?").get(order.table_id, order.id)) {
    db.prepare("UPDATE tables SET status = 'free', current_order_id = NULL WHERE id = ?").run(order.table_id);
  }
  return fullyPaid;
}

export function recordMixedPayment(db, { orderId, idempotencyKey, processedBy, allocations }) {
  if (typeof idempotencyKey !== 'string' || !idempotencyKey.trim()) throw Object.assign(new Error('idempotency_key es requerido'), { code: 'IDEMPOTENCY_REQUIRED' });
  const execute = db.transaction(() => {
    const existing = db.prepare('SELECT * FROM payment_operations WHERE idempotency_key = ?').get(idempotencyKey);
    if (existing) {
      if (existing.order_id !== orderId) throw Object.assign(new Error('idempotency_key ya fue usada para otra orden'), { code: 'IDEMPOTENCY_CONFLICT' });
      return operationResult(db, existing);
    }
    const order = ensureOrder(db, orderId);
    const paidBefore = db.prepare("SELECT COALESCE(SUM(amount), 0) total FROM payments WHERE order_id = ? AND status = 'completed'").get(orderId).total;
    const calculation = calculateMixedPayments(order.total, paidBefore, allocations);
    const operation = { id: randomUUID(), order_id: orderId };
    db.prepare('INSERT INTO payment_operations (id, order_id, total_amount, status, idempotency_key, created_by) VALUES (?, ?, ?, ?, ?, ?)')
      .run(operation.id, orderId, calculation.paidAmount - paidBefore, 'completed', idempotencyKey, processedBy);
    const insert = db.prepare(`INSERT INTO payments (id, order_id, method, amount, iva_amount, received, change, reference, status, processed_by, notes, synced_at, payment_operation_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'completed', ?, ?, ?, ?)`);
    for (const allocation of calculation.payments) insert.run(randomUUID(), orderId, allocation.method, allocation.amount, order.iva_amount || 0, allocation.received, allocation.change, allocation.reference || '', processedBy, '', new Date().toISOString(), operation.id);
    updateOrder(db, order, calculation.paidAmount, calculation.payments.at(-1).method, calculation.payments.at(-1).reference);
    return operationResult(db, { ...operation });
  });
  return execute();
}

export function recordPayment(db, args) {
  const payment = calculatePayment(args);
  const order = ensureOrder(db, args.orderId);
  const execute = db.transaction(() => {
    if (args.idempotencyKey) {
      const existing = db.prepare('SELECT * FROM payment_operations WHERE idempotency_key = ?').get(args.idempotencyKey);
      if (existing) return operationResult(db, existing);
    }
    const paid = db.prepare("SELECT COALESCE(SUM(amount), 0) total FROM payments WHERE order_id = ? AND status = 'completed'").get(order.id).total;
    if ((args.status || 'completed') === 'completed' && paid + payment.amount > order.total) throw Object.assign(new Error('El monto excede el saldo pendiente'), { code: 'PAYMENT_CONFLICT' });
    const operation = args.idempotencyKey ? { id: randomUUID() } : null;
    if (operation) db.prepare('INSERT INTO payment_operations (id, order_id, total_amount, status, idempotency_key, created_by) VALUES (?, ?, ?, ?, ?, ?)').run(operation.id, order.id, payment.amount, 'completed', args.idempotencyKey, args.processedBy);
    const id = args.paymentId || randomUUID();
    db.prepare(`INSERT INTO payments (id, order_id, method, amount, iva_amount, received, change, reference, status, processed_by, notes, synced_at, payment_operation_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, order.id, payment.method, payment.amount, order.iva_amount || 0, payment.received, payment.change, args.reference || '', args.status || 'completed', args.processedBy, args.notes || '', new Date().toISOString(), operation?.id || null);
    const totalPaid = paid + (args.status === 'completed' || !args.status ? payment.amount : 0);
    const fullyPaid = args.status === 'completed' || !args.status ? updateOrder(db, order, totalPaid, payment.method, args.reference) : false;
    return { paymentId: id, fullyPaid, remaining: order.total - totalPaid };
  });
  return execute();
}

export { cents };
