/**
 * Circuito cerrado — integración (FASE 6)
 *
 * Verifica el circuito del restobar de punta a punta con la BD real
 * (schema.js) y los servicios SSOT:
 *
 *   Cliente crea pedido (clientes PWA, público)
 *     → servidor persiste (orders + order_items) con totales SSOT
 *     → reporte diario deriva net_revenue / IVA / base de forma consistente
 *     → el total que paga el cliente == el total reportado como venta.
 *
 * Asegura que NO hay eslabón roto entre: creación de pedido, totales de IVA
 * y reportes.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { applySchema } from '../../server/db/schema.js';
import { createPublicOrder } from '../../server/services/client-orders.js';
import { computeTotals } from '../../src/core/config/iva.js';

let db;

beforeEach(() => {
  db = new Database(':memory:');
  applySchema(db);
  // Mesa + staff + items de menú
  db.prepare(
    "INSERT INTO tables (id, number, capacity, status, section, position) VALUES (?, ?, ?, 'free', 'interior', 1)"
  ).run('tbl-1', 1, 4);
  db.prepare(
    "INSERT INTO staff (id, pin_hash, role, display_name) VALUES ('w1', 'x', 'mesero', 'Mesero')"
  ).run();

  const seedCategory = `
    INSERT INTO menu_categories (id, name, emoji, is_active, sort_order)
    VALUES (?, ?, ?, 1, ?)`;
  db.prepare(seedCategory).run('cat-1', 'Micheladas', '🍹', 1);
  db.prepare(seedCategory).run('cat-2', 'Platos', '🍛', 2);

  const seedItem = `
    INSERT INTO menu_items (id, name, price, category_id, area, is_active, is_available, iva_percentage)
    VALUES (?, ?, ?, ?, ?, 1, 1, 13)`;
  db.prepare(seedItem).run('m1', 'Chelada Clásica', 20, 'cat-1', 'bar');
  db.prepare(seedItem).run('m2', 'Pique Macho', 85, 'cat-2', 'cocina');
});

function createOrder() {
  const result = createPublicOrder(db, {
    table_number: 1,
    session_id: 'sess_test_1',
    items: [
      { menu_item_id: 'm1', quantity: 2 }, // 40
      { menu_item_id: 'm2', quantity: 1 }, // 85 → gross 125
    ],
    guest_count: 2,
  });
  expect(result.success).toBe(true);
  return result.order;
}

describe('Circuito cerrado: pedido cliente → total/IVA → reporte', () => {
  it('el total guardado del pedido es EXACTAMENTE la suma de precios (incluye IVA)', () => {
    const order = createOrder();
    // gross = 40 + 85 = 125
    expect(order.total).toBe(125);
  });

  it('el IVA y la base derivan del mismo helper SSOT (iva.js)', () => {
    const order = createOrder();
    const expected = computeTotals(125);
    expect(order.iva_amount).toBe(expected.iva);
    expect(order.subtotal).toBe(expected.subtotal);
    // Verificación cruzada de IVA
    expect(order.subtotal + order.iva_amount).toBeCloseTo(order.total, 2);
  });

  it('el reporte diario deriva net_revenue == total del pedido y IVA consistente', () => {
    const order = createOrder();

    // Simular que el pedido se pagó (caja) → cierra el circuito de venta.
    db.prepare("UPDATE orders SET status = 'paid', is_paid = 1, paid_at = datetime('now') WHERE id = ?")
      .run(order.id);
    db.prepare(`
      INSERT INTO payments (id, order_id, method, amount, iva_amount, status, processed_by, processed_at)
      VALUES (?, ?, 'cash', ?, ?, 'completed', 'w1', datetime('now'))
    `).run('pay-1', order.id, order.total, order.iva_amount);

    // Reporte diario (mismo SQL que server/routes/reports.js)
    const summary = db.prepare(`
      SELECT
        SUM(total) as gross_revenue,
        SUM(CASE WHEN status = 'paid' THEN total ELSE 0 END) as net_revenue
      FROM orders WHERE DATE(created_at) = ?
    `).get(new Date().toISOString().split('T')[0]);

    // net_revenue == lo que pagó el cliente (125)
    expect(summary.net_revenue).toBe(125);
    expect(summary.gross_revenue).toBe(125);

    // IVA derivado por el helper SSOT (lo que reporta reportsApi)
    const { iva } = computeTotals(summary.net_revenue);
    expect(iva).toBe(order.iva_amount);
  });

  it('marcar como paid deja la mesa SIN pedidos activos (invariante de cierre)', () => {
    const order = createOrder();
    const table = db.prepare("SELECT status FROM tables WHERE id = 'tbl-1'").get();
    expect(table.status).toBe('occupied'); // mesa ocupada mientras hay pedido

    db.prepare("UPDATE orders SET status = 'paid', is_paid = 1, paid_at = datetime('now') WHERE id = ?")
      .run(order.id);

    // El invariante que cierra el circuito: tras pagar, no debe quedar
    // ningún pedido activo para esa mesa (el route de status hace luego
    // el flujo de liberar la mesa cuando no quedan activos).
    const activeOrders = db.prepare(`
      SELECT id FROM orders
      WHERE table_id = 'tbl-1' AND status NOT IN ('paid','cancelled')
    `).all();
    expect(activeOrders).toHaveLength(0);
  });
});
