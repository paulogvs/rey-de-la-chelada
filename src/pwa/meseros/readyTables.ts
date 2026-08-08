/**
 * Ready Tables — pure helpers for the meseros "🍴 Listo" badge (S2-A)
 *
 * The server is the SSOT of "order ready to serve": it emits
 * `order_complete` (to meseros) when the last non-cancelled item of an
 * order becomes 'ready' (see server/services/order-broadcaster.js and
 * PATCH /api/orders/:id/items/:itemId/status). These helpers turn those
 * events into a Map<tableNumber → timestamp> that TablesView renders.
 *
 * Pure & unit-tested in node (tests/unit/ready-tables.test.js).
 * No imports — safe to use anywhere in the client.
 */

/** Badge TTL: 10 minutes after the order is reported ready. */
export const READY_TTL_MS = 10 * 60 * 1000;

export interface ReadyEventLike {
  type: string;
  tableNumber?: number;
  status?: string;
}

/**
 * Compute the next ready-tables map from a WS event.
 *
 * Rules:
 *  - `order_complete` with tableNumber → mark table as ready (now)
 *  - `status_change` to paid/served/cancelled → clear the table
 *  - entries older than `ttlMs` are pruned
 *
 * Returns a NEW Map — the input is never mutated.
 */
export function nextReadyTables(
  prev: ReadonlyMap<number, number>,
  event: ReadyEventLike,
  now = Date.now(),
  ttlMs = READY_TTL_MS
): Map<number, number> {
  const next = new Map(prev);

  if (event.type === 'order_complete' && typeof event.tableNumber === 'number') {
    next.set(event.tableNumber, now);
  } else if (event.type === 'status_change' && typeof event.tableNumber === 'number') {
    const s = event.status;
    if (s === 'paid' || s === 'served' || s === 'cancelled') {
      next.delete(event.tableNumber);
    }
  }

  const cutoff = now - ttlMs;
  for (const [tableNumber, ts] of next) {
    if (ts < cutoff) next.delete(tableNumber);
  }

  return next;
}

export default { nextReadyTables, READY_TTL_MS };
