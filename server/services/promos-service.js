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

/**
 * Seed de promos por defecto (migración del SSOT a la DB, idempotente).
 *
 * v15 (2026-08-31): las promos que antes vivían en código (src/core/config/
 * promotions.js) se insertan UNA vez en la tabla `promos` para que aparezcan
 * en el panel Admin como editables/eliminables. Las "Shot + Michelada" y
 * "Doble Escarchado" (eran MODIFIER/adicionales) se convierten en EXTRAS del
 * grupo "Micheladas Especiales".
 *
 * NO usa días/fechas (el dueño quiere SIMPLE: activar/desactivar a mano).
 * Idempotente: no duplica si la promo/extras ya existen por label/nombre.
 */
export function seedDefaultPromos(db) {
  const steps = [];
  const catByName = (name) => db.prepare('SELECT id FROM menu_categories WHERE name = ?').get(name);
  const micheladas = catByName('Micheladas Especiales');
  const cervezaArt = catByName('Cerveza Artesanal');

  // ── 1. Promos de venta (solo si existen las categorías) ──
  const defaultPromos = [
    { name: 'Jueves de Chelada 2x1', label: '2x1', description: '2x1 en Micheladas Signature.', price_total: null, type: 'BOGO', lines: () => micheladas ? [{ group_id: micheladas.id, quantity: 2 }] : [] },
    { name: 'Miércoles de Barra', label: 'Miércoles de Barra', description: 'Cerveza Artesanal a precio especial.', price_total: 1200, type: 'PRICE_OVERRIDE', lines: () => cervezaArt ? [{ group_id: cervezaArt.id, quantity: 1 }] : [] },
    { name: 'Combo Michelada + Cerveza', label: 'Combo', description: '1 Michelada Signature + 1 Cerveza Artesanal.', price_total: 4500, type: 'COMBO', lines: () => (micheladas && cervezaArt) ? [{ group_id: micheladas.id }, { group_id: cervezaArt.id }] : [] },
    { name: 'Primera Visita', label: 'Primera Visita', description: 'Michelada Signature para nuevos.', price_total: 2500, type: 'PRICE_OVERRIDE', lines: () => micheladas ? [{ group_id: micheladas.id, quantity: 1 }] : [] },
  ];

  for (const p of defaultPromos) {
    const exists = db.prepare('SELECT id FROM promos WHERE label = ? OR name = ?').get(p.label, p.name);
    if (exists) { steps.push(`promo ${p.label} ya existe`); continue; }
    const id = randomUUID();
    const lines = p.lines();
    if (lines.length === 0) { steps.push(`promo ${p.label} sin categoría (seed skipped)`); continue; }
    const tx = db.transaction(() => {
      db.prepare(`INSERT INTO promos (id, name, label, description, price_total, max_per_order, active, created_at, updated_at)
        VALUES (?,?,?,?,?,1,0, datetime('now'), datetime('now'))`)
        .run(id, p.name, p.label, p.description, p.price_total ?? 0);
      for (const l of lines) {
        db.prepare(`INSERT INTO promo_lines (id, promo_id, item_id, group_id, quantity, extra_id, extra_price)
          VALUES (?,?,?,?,?,?,?)`)
          .run(randomUUID(), id, null, l.group_id, l.quantity || 1, null, null);
      }
    });
    tx();
    steps.push(`promo ${p.label} sembrada`);
  }

  // ── 2. Extras que eran MODIFIER (Shot, Escarchado) → grupo Micheladas ──
  if (micheladas) {
    for (const ex of [{ name: 'Shot', price: 1500 }, { name: 'Doble Escarchado', price: 500 }]) {
      const exists = db.prepare('SELECT id FROM category_extras WHERE category_id = ? AND name = ?').get(micheladas.id, ex.name);
      if (exists) { steps.push(`extra ${ex.name} ya existe`); continue; }
      const eid = randomUUID();
      db.prepare(`INSERT INTO category_extras (id, category_id, name, price, active, sort_order, created_at, updated_at)
        VALUES (?,?,?,?,1,0, datetime('now'), datetime('now'))`)
        .run(eid, micheladas.id, ex.name, ex.price);
      steps.push(`extra ${ex.name} sembrado`);
    }
  }

  if (steps.length > 0 && steps.some(s => !s.includes('ya existe'))) {
    console.log('[Promos] Seed:', steps.join(' · '));
  }
  return steps;
}

export default {
  listPromos,
  createPromo,
  updatePromo,
  setPromoActive,
  deletePromo,
  activePromosForBusinessDay,
  seedDefaultPromos,
};