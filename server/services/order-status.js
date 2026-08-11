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
 *    - sin items → ronda 1.
 *    - con items existentes → SIEMPRE ronda nueva (max+1) → el KDS lo ve
 *      como tarjeta separada prioritaria "Mesa 4 · Ronda N 🆕" (el usuario
 *      quiere que un producto agregado sea SIEMPRE "otra orden").
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
 *   - Con items existentes → SIEMPRE ronda nueva (max + 1). El usuario
 *     pidió que un producto agregado aparezca SIEMPRE como "otra orden"
 *     para la mesa en cocina/bar (orden de prioridades), aunque la comanda
 *     anterior aún no se haya procesado.
 *
 * @param {object} db — better-sqlite3
 * @param {string} orderId
 * @returns {number} round
 */
export function resolveRound(db, orderId) {
  const row = db.prepare(`
    SELECT COUNT(*) as total, COALESCE(MAX(round), 0) as maxRound
    FROM order_items WHERE order_id = ?
  `).get(orderId);

  if (!row || Number(row.total) === 0) return 1;
  return Number(row.maxRound) + 1;
}
