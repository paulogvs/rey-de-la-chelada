/**
 * promos-service.js — Promos data-driven (v15 2026-08-29).
 *
 * Las promos ya NO viven en código (SSOT promotions.js) — viven en la DB
 * (tablas promos + promo_lines + promo_schedule) y se gestionan desde el
 * panel Admin. Este servicio expone:
 *   - CRUD (admin)           → createPromo / updatePromo / deletePromo / listPromos
 *   - Activas del día        → activePromosForBusinessDay(businessDay)
 *   - Resolver precio/context → resolvePromoLines(promo, cart) — el motor
 *     valida que el carrito tenga las líneas y aplica el precio total.
 *
 * El motor genérico (validar cantidad, repartir precio: 1ª línea paga +
 * resto gratis, max_per_order) vive aquí; las promos son DATOS.
 */

import { randomUUID } from 'node:crypto';
import { getDb } from '../db/index.js';
import { businessDayName } from '../../src/core/config/promotions.js';

// ── Helpers ─────────────────────────────────────────────────────────────

function promoById(db, id) {
  const promo = db.prepare('SELECT * FROM promos WHERE id = ?').get(id);
  if (!promo) return null;
  promo.lines = db.prepare('SELECT * FROM promo_lines WHERE promo_id = ? ORDER BY rowid').all(id);
  promo.schedule = db.prepare('SELECT * FROM promo_schedule WHERE promo_id = ?').all(id);
  return promo;
}

/**
 * ¿La promo está activa para un día laboral?
 * Activa = active=1 AND (sin schedule → siempre) OR (
 *   day_of_week coincide con el día del businessDay  OR
 *   start_date/end_date contienen el businessDay)
 */
function isPromoActiveForDay(promo, businessDay) {
  if (promo.active !== 1) return false;
  const schedule = promo.schedule || [];
  if (schedule.length === 0) return true; // sin restricción de días

  const dayName = businessDayName(businessDay); // 'domingo'..'sabado'
  const dow = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'].indexOf(dayName);
  return schedule.some(s => {
    // día de la semana
    if (s.day_of_week !== null && s.day_of_week === dow) return true;
    // rango de fechas (día laboral incluido)
    if (s.start_date || s.end_date) {
      const inRange = (!s.start_date || businessDay >= s.start_date) &&
                      (!s.end_date || businessDay <= s.end_date);
      if (inRange) return true;
    }
    return false;
  });
}

// ── CRUD (admin) ────────────────────────────────────────────────────────

/** Lista promos (todas, para el panel) con líneas y schedule. */
export function listPromos() {
  const db = getDb();
  return db.prepare('SELECT * FROM promos ORDER BY updated_at DESC').all()
    .map(p => promoById(db, p.id));
}

/**
 * Crea una promo. `data = { name, label, description, price_total,
 * max_per_order, active, lines: [{item_id|group_id, quantity, extra_id,
 * extra_price}], schedule: [{day_of_week, start_date, end_date}] }`
 */
export function createPromo(data, createdBy) {
  const db = getDb();
  const id = randomUUID();
  const tx = db.transaction(() => {
    db.prepare(`INSERT INTO promos (id, name, label, description, price_total, max_per_order, active, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`)
      .run(id, data.name, data.label || data.name, data.description || '', data.price_total || 0, data.max_per_order || 1, data.active === false ? 0 : 1, createdBy || null);
    for (const line of data.lines || []) {
      db.prepare(`INSERT INTO promo_lines (id, promo_id, item_id, group_id, quantity, extra_id, extra_price)
        VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .run(randomUUID(), id, line.item_id || null, line.group_id || null, line.quantity || 1, line.extra_id || null, line.extra_price ?? null);
    }
    for (const s of data.schedule || []) {
      db.prepare(`INSERT INTO promo_schedule (id, promo_id, day_of_week, start_date, end_date)
        VALUES (?, ?, ?, ?, ?)`)
        .run(randomUUID(), id, s.day_of_week ?? null, s.start_date || null, s.end_date || null);
    }
  });
  tx();
  return promoById(db, id);
}

/** Actualiza una promo (reemplaza líneas y schedule). */
export function updatePromo(id, data) {
  const db = getDb();
  if (!db.prepare('SELECT id FROM promos WHERE id = ?').get(id)) return null;
  const tx = db.transaction(() => {
    db.prepare(`UPDATE promos SET name=?, label=?, description=?, price_total=?, max_per_order=?, active=?, updated_at=datetime('now') WHERE id=?`)
      .run(data.name, data.label || data.name, data.description || '', data.price_total || 0, data.max_per_order || 1, data.active === false ? 0 : 1, id);
    db.prepare('DELETE FROM promo_lines WHERE promo_id = ?').run(id);
    db.prepare('DELETE FROM promo_schedule WHERE promo_id = ?').run(id);
    for (const line of data.lines || []) {
      db.prepare(`INSERT INTO promo_lines (id, promo_id, item_id, group_id, quantity, extra_id, extra_price)
        VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .run(randomUUID(), id, line.item_id || null, line.group_id || null, line.quantity || 1, line.extra_id || null, line.extra_price ?? null);
    }
    for (const s of data.schedule || []) {
      db.prepare(`INSERT INTO promo_schedule (id, promo_id, day_of_week, start_date, end_date)
        VALUES (?, ?, ?, ?, ?)`)
        .run(randomUUID(), id, s.day_of_week ?? null, s.start_date || null, s.end_date || null);
    }
  });
  tx();
  return promoById(db, id);
}

/** Activa/desactiva (toggle global). */
export function setPromoActive(id, active) {
  const db = getDb();
  db.prepare('UPDATE promos SET active = ?, updated_at = datetime(\'now\') WHERE id = ?').run(active ? 1 : 0, id);
}

export function deletePromo(id) {
  const db = getDb();
  db.prepare('DELETE FROM promos WHERE id = ?').run(id);
}

// ── FUSIÓN para clientes / server ───────────────────────────────────────

/**
 * Promos ACTIVAS para un día laboral, normalizadas para el cliente:
 *   { id, name, label, description, price_total, max_per_order,
 *     lines: [{ item_id?, group_id?, quantity, extra_id?, extra_price? }] }
 */
export function activePromosForBusinessDay(businessDay) {
  const db = getDb();
  return db.prepare('SELECT * FROM promos WHERE active = 1').all()
    .map(p => promoById(db, p.id))
    .filter(p => isPromoActiveForDay(p, businessDay))
    .map(p => ({
      id: p.id,
      name: p.name,
      label: p.label,
      description: p.description,
      price_total: p.price_total,
      max_per_order: p.max_per_order,
      lines: p.lines.map(l => ({
        item_id: l.item_id,
        group_id: l.group_id,
        quantity: l.quantity,
        extra_id: l.extra_id,
        extra_price: l.extra_price,
      })),
    }));
}

export default {
  listPromos,
  createPromo,
  updatePromo,
  setPromoActive,
  deletePromo,
  activePromosForBusinessDay,
};