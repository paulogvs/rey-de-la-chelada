/**
 * Unit — Order Status Service (FASE 4: estados derivados + rondas)
 *
 * - recalcOrderStatus: el status GLOBAL se deriva de los items
 *   (pending → confirmed, preparing → preparing, ready → ready,
 *    todos entregados → served). 'paid'/'cancelled' son terminales.
 * - resolveRound: items NUEVOS van a la MISMA ronda si hay trabajo sin
 *   procesar; a RONDA NUEVA (max+1) si todo ya fue procesado.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { applySchema } from '../../server/db/schema.js';
import { recalcOrderStatus, resolveRound } from '../../server/services/order-status.js';

let db;
let orderId;

beforeEach(() => {
  db = new Database(':memory:');
  applySchema(db);
  db.prepare("INSERT INTO staff (id, pin_hash, role, display_name) VALUES ('w1', 'x', 'mesero', 'Waiter')").run();
  db.prepare("INSERT INTO tables (id, number, capacity) VALUES ('t1', 1, 4)").run();
  db.prepare(`
    INSERT INTO orders (id, table_id, table_number, waiter_id, waiter_name, status, total)
    VALUES ('o1', 't1', 1, 'w1', 'Waiter', 'confirmed', 100)
  `).run();
  orderId = 'o1';
});

function insertItem(id, status = 'pending', round = 1) {
  db.prepare(`
    INSERT INTO order_items (id, order_id, menu_item_id, menu_item_name, quantity, unit_price, subtotal, status, round)
    VALUES (?, ?, 'm1', 'Item', 1, 10, 10, ?, ?)
  `).run(id, orderId, status, round);
}

function orderStatus() {
  return db.prepare('SELECT status FROM orders WHERE id = ?').get(orderId).status;
}

afterEach(() => db.close());

describe('recalcOrderStatus — estados derivados', () => {
  it('todos los items pending → confirmed', () => {
    insertItem('a', 'pending');
    insertItem('b', 'pending');
    expect(recalcOrderStatus(db, orderId)).toBe('confirmed');
    expect(orderStatus()).toBe('confirmed');
  });

  it('algún item preparing → preparing', () => {
    insertItem('a', 'preparing');
    insertItem('b', 'ready');
    expect(recalcOrderStatus(db, orderId)).toBe('preparing');
  });

  it('todos los items ready (o entregados) → ready', () => {
    insertItem('a', 'ready');
    insertItem('b', 'delivered');
    expect(recalcOrderStatus(db, orderId)).toBe('ready');
  });

  it('todos los items delivered/cancelled → served', () => {
    insertItem('a', 'delivered');
    insertItem('b', 'cancelled');
    expect(recalcOrderStatus(db, orderId)).toBe('served');
  });

  it('una orden served con item NUEVO pending → vuelve a confirmed (reactivación)', () => {
    insertItem('a', 'delivered');
    expect(recalcOrderStatus(db, orderId)).toBe('served');
    insertItem('b', 'pending', 2); // ronda 2 recién agregada
    expect(recalcOrderStatus(db, orderId)).toBe('confirmed');
  });

  it('no pisa paid (terminal)', () => {
    db.prepare("UPDATE orders SET status = 'paid' WHERE id = ?").run(orderId);
    insertItem('a', 'pending');
    expect(recalcOrderStatus(db, orderId)).toBe('paid');
    expect(orderStatus()).toBe('paid');
  });

  it('no pisa cancelled (terminal)', () => {
    db.prepare("UPDATE orders SET status = 'cancelled' WHERE id = ?").run(orderId);
    insertItem('a', 'pending');
    expect(recalcOrderStatus(db, orderId)).toBe('cancelled');
  });

  it('sin items no toca el status', () => {
    expect(recalcOrderStatus(db, orderId)).toBe('confirmed');
  });
});

describe('resolveRound — segunda comanda', () => {
  it('sin items → ronda 1', () => {
    expect(resolveRound(db, orderId)).toBe(1);
  });

  it('con items existentes (aún pending) → ronda nueva (max + 1)', () => {
    insertItem('a', 'pending', 1);
    expect(resolveRound(db, orderId)).toBe(2);
  });

  it('todo procesado → ronda nueva (max + 1)', () => {
    insertItem('a', 'delivered', 1);
    expect(resolveRound(db, orderId)).toBe(2);
    insertItem('b', 'ready', 2);
    expect(resolveRound(db, orderId)).toBe(3);
  });

  it('siempre crea ronda nueva aunque quede trabajo sin procesar', () => {
    insertItem('a', 'delivered', 1);
    insertItem('b', 'pending', 1);
    expect(resolveRound(db, orderId)).toBe(2);
  });
});
