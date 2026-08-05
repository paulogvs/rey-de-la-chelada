/**
 * client-orders agotados — un item con is_available=0 NO debe poder pedirse.
 *
 * RED (FASE 2): createPublicOrder filtraba por is_active=1 pero no por
 * is_available → el cliente podía pedir un item agotado. El menú digital
 * lo oculta en UI pero el API público lo aceptaba.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { applySchema } from '../../server/db/schema.js';
import { createPublicOrder } from '../../server/services/client-orders.js';

function makeDb() {
  const db = new Database(':memory:');
  applySchema(db);
  // Seed mínimo: categoría, item activo/disponible y item agotado
  const catId = randomUUID();
  db.prepare('INSERT INTO menu_categories (id, name, sort_order, is_active) VALUES (?, ?, 0, 1)')
    .run(catId, 'E2E Cat');
  const itemId = randomUUID();
  db.prepare(`
    INSERT INTO menu_items (id, category_id, name, description, price, currency,
                            is_active, is_available, area, preparation_time)
    VALUES (?, ?, ?, '', 20, 'BOB', 1, 1, 'bar', 5)
  `).run(itemId, catId, 'Disponible');
  const agotadoId = randomUUID();
  db.prepare(`
    INSERT INTO menu_items (id, category_id, name, description, price, currency,
                            is_active, is_available, area, preparation_time)
    VALUES (?, ?, ?, '', 15, 'BOB', 1, 0, 'bar', 5)
  `).run(agotadoId, catId, 'Agotado');
  // Mesa 1
  db.prepare("INSERT INTO tables (id, number, capacity, status) VALUES (?, 1, 4, 'free')")
    .run(randomUUID());
  // Staff mesero (FK de orders.waiter_id)
  db.prepare(`
    INSERT INTO staff (id, pin_hash, role, display_name, is_active, created_at)
    VALUES (?, 'hash', 'mesero', 'Mesero E2E', 1, datetime('now'))
  `).run(randomUUID());
  return { db, itemId, agotadoId };
}

describe('createPublicOrder — items agotados', () => {
  let db;
  let itemId;
  let agotadoId;

  beforeAll(() => {
    const fixture = makeDb();
    db = fixture.db;
    itemId = fixture.itemId;
    agotadoId = fixture.agotadoId;
  });

  afterAll(() => {
    db.close();
  });

  it('acepta un item activo y disponible', () => {
    const result = createPublicOrder(db, {
      table_number: 1,
      session_id: 'sess-e2e-ok',
      items: [{ menu_item_id: itemId, quantity: 1 }],
    });
    expect(result.success).toBe(true);
  });

  it('RECHAZA un item agotado (is_available=0) con INVALID_MENU_ITEM', () => {
    const result = createPublicOrder(db, {
      table_number: 1,
      session_id: 'sess-e2e-agotado',
      items: [{ menu_item_id: agotadoId, quantity: 1 }],
    });
    expect(result.success).toBe(false);
    expect(result.code).toBe('INVALID_MENU_ITEM');
  });
});
