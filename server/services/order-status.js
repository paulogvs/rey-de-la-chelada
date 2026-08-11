/**
 * ═══════════════════════════════════════════════════════════
 *  ORDER STATUS SERVICE — Estados derivados (FASE 4)
 *
 *  El status GLOBAL de un pedido NO se setea a mano: se DERIVA de sus
 *  items. Elimina inconsistencias históricas (pedido 'ready' con item
 *  'pending', pedido 'served' que reaparece, etc.).
 *
 *  Precedencia (peor caso domina):
 *    1. algún item 'pending'      → 'confirmed'  (trabajo pendiente → KDS)
 *    2. algún item 'preparing'    → 'preparing'
 *    3. algún item 'ready'        → 'ready'      (listo para servir)
 *    4. TODOS delivered/cancelled → 'served'     (todo entregado → cobrable)
 *
 *  'paid' / 'cancelled' son terminales y NUNCA se derivan ni se pisan.
 *
 *  RONDAS (v7): `resolveRound` decide a qué ronda van los items NUEVOS:
 *    - si la orden aún tiene trabajo sin procesar (items 'pending') →
 *      MISMA ronda (la comanda sigue abierta).
 *    - si TODO ya fue procesado (preparing/ready/delivered/cancelled) →
 *      RONDA NUEVA (max+1) → el KDS lo ve como tarjeta separada prioritaria.
 * ═══════════════════════════════════════════════════════════
 */

/**
 * Deriva y persiste el status del pedido según sus items.
 * No toca 'paid'/'cancelled' (terminales).
 *
 * @param {object} db — better-sqlite3
 * @param {string} orderId
 * @returns {string} status derivado
 */
export function recalcOrderStatus(db, orderId) {
  const order = db.prepare('SELECT status FROM orders WHERE id = ?').get(orderId);
  if (!order) return null;
  // Terminales: nunca derivar ni pisar
  if (order.status === 'paid' || order.status === 'cancelled') return order.status;

  const counts = db.prepare(`
    SELECT
      SUM(CASE WHEN status = 'pending'    THEN 1 ELSE 0 END) as pending,
      SUM(CASE WHEN status = 'preparing'  THEN 1 ELSE 0 END) as preparing,
      SUM(CASE WHEN status = 'ready'      THEN 1 ELSE 0 END) as ready,
      SUM(CASE WHEN status = 'delivered'  THEN 1 ELSE 0 END) as delivered,
      SUM(CASE WHEN status = 'cancelled'  THEN 1 ELSE 0 END) as cancelled
    FROM order_items WHERE order_id = ?
  `).get(orderId);

  const n = (v) => Number(v || 0);
  const total = n(counts.pending) + n(counts.preparing) + n(counts.ready) + n(counts.delivered) + n(counts.cancelled);
  if (total === 0) return order.status; // sin items: no tocar

  let derived;
  if (n(counts.pending) > 0) derived = 'confirmed';
  else if (n(counts.preparing) > 0) derived = 'preparing';
  else if (n(counts.ready) > 0) derived = 'ready';
  else derived = 'served'; // todos delivered/cancelled

  if (derived !== order.status) {
    db.prepare("UPDATE orders SET status = ?, updated_at = datetime('now') WHERE id = ?").run(derived, orderId);
  }
  return derived;
}

/**
 * Resuelve la ronda para items NUEVOS de una orden (FASE 4B):
 *   - Sin items → ronda 1.
 *   - Con trabajo sin procesar (algún item 'pending') → misma ronda en curso.
 *   - Todo ya procesado → ronda nueva (max + 1).
 *
 * @param {object} db — better-sqlite3
 * @param {string} orderId
 * @returns {number} round
 */
export function resolveRound(db, orderId) {
  const row = db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
      COALESCE(MAX(round), 1) as maxRound
    FROM order_items WHERE order_id = ?
  `).get(orderId);

  if (!row || Number(row.total) === 0) return 1;
  if (Number(row.pending) > 0) return Number(row.maxRound);
  return Number(row.maxRound) + 1;
}
