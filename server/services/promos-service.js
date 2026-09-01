/**
 * promos-service.js — Promos data-driven (v16 2026-09-01).
 *
 * Las promos viven en la DB (tablas promos + promo_lines + promo_schedule)
 * y se gestionan desde el panel Admin. Este servicio expone:
 *   - CRUD (admin)           → createPromo / updatePromo / deletePromo / listPromos
 *   - Activas del día        → activePromosForBusinessDay(businessDay)
 *   - Resolver precio/context → resolvePromoPrice / promoLineMatchesItem
 *   - Seed v16               → seedDefaultPromos (6 promos, idempotente)
 *
 * MODELO DE PRECIO (v16, confirmado por el dueño):
 *   - Modo A (FIXED): el armador pone un precio TOTAL. Aplica a item+item,
 *     item+extra o grupo+extra. Si es grupo → modal elige item pero el
 *     precio es SIEMPRE el FIJO (ni más ni menos). El total del pack se
 *     reparte entre las unidades de las líneas (1 item → 1 precio; combo
 *     2 líneas → mitad y mitad).
 *   - Modo B (MENU_PLUS): el armador pone un AJUSTE. Aplica a grupo+extra
 *     (o item+extra). Si es grupo → modal elige item → el precio =
 *     item.menu_price + ajuste. Con líneas de quantity > 1 el precio paga
 *     la PRIMERA unidad y el resto va GRATIS (2x1/BOGO).
 *
 * El SSOT src/core/config/promotions.js quedó ELIMINADO (v16). La DB es la
 * única fuente. businessDayName se importa de server/utils/date-utils.js.
 */

import { randomUUID } from 'node:crypto';
import { getDb } from '../db/index.js';
import { businessDayName } from '../utils/date-utils.js';

// ── Helpers ─────────────────────────────────────────────────────────────

export function promoById(id) {
  const db = getDb();
  if (!id) return null;
  const promo = db.prepare('SELECT * FROM promos WHERE id = ?').get(id);
  if (!promo) return null;
  promo.lines = db.prepare('SELECT * FROM promo_lines WHERE promo_id = ? ORDER BY rowid').all(id);
  promo.schedule = db.prepare('SELECT * FROM promo_schedule WHERE promo_id = ?').all(id);
  return promo;
}

/**
 * ¿El item matchea una línea de la promo?
 * Matchea por item_id directo o por group_id (= categoría del item).
 * @param {object} line — { item_id?, group_id? }
 * @param {object} menuItem — { id, category_id }
 * @returns {boolean}
 */
export function promoLineMatchesItem(line, menuItem) {
  if (!line || !menuItem) return false;
  const catId = menuItem.category_id || menuItem.categoryId;
  return !!(
    (line.item_id && line.item_id === menuItem.id) ||
    (line.group_id && line.group_id === catId)
  );
}

/**
 * Precio de línea de un item bajo una promo (modelo A/B).
 *   - FIXED     → price_value (el total del pack; el reparto por unidades
 *                  lo hace el caller vía las líneas de la promo)
 *   - MENU_PLUS → menuItemPrice + price_value (ajuste)
 * @param {object} promo — promo con price_mode/price_value
 * @param {number} menuItemPrice — precio del menu_item en centavos
 * @returns {number}
 */
export function resolvePromoPrice(promo, menuItemPrice) {
  if (!promo) return 0;
  const value = Number(promo.price_value) || 0;
  if (promo.price_mode === 'MENU_PLUS') {
    return (Number(menuItemPrice) || 0) + value;
  }
  return value; // FIXED
}

/**
 * Nombre de un extra (categoría) por id — usado por order-pricing para la
 * sub-línea KDS. (La resolución de la sub-línea se hace en order-pricing.js
 * con un lookup directo a category_extras; aquí no se usa, solo documentamos.)
 */
/** ¿La promo está activa para un día laboral? */
function isPromoActiveForDay(promo, businessDay) {
  if (promo.active !== 1) return false;
  const schedule = promo.schedule || [];
  if (schedule.length === 0) return true; // sin restricción de días

  const dayName = businessDayName(businessDay); // 'domingo'..'sabado'
  const dow = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'].indexOf(dayName);
  return schedule.some(s => {
    if (s.day_of_week !== null && s.day_of_week === dow) return true;
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
    .map(p => promoById(p.id));
}

/**
 * Crea una promo. `data = { name, label, description, price_mode,
 * price_value, max_per_order, active, lines: [{item_id|group_id, quantity,
 * extra_id, extra_price}], schedule: [...] }`
 */
export function createPromo(data, createdBy) {
  const db = getDb();
  const id = randomUUID();
  const priceMode = data.price_mode === 'MENU_PLUS' ? 'MENU_PLUS' : 'FIXED';
  const priceValue = Number(data.price_value ?? data.price_total ?? 0) || 0;
  const tx = db.transaction(() => {
    db.prepare(`INSERT INTO promos (id, name, label, description, price_total, price_mode, price_value, max_per_order, active, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`)
      .run(id, data.name, data.label || data.name, data.description || '', priceValue, priceMode, priceValue, data.max_per_order || 1, data.active === false ? 0 : 1, createdBy || null);
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
  return promoById(id);
}

/** Actualiza una promo (reemplaza líneas y schedule). */
export function updatePromo(id, data) {
  const db = getDb();
  if (!db.prepare('SELECT id FROM promos WHERE id = ?').get(id)) return null;
  const priceMode = data.price_mode === 'MENU_PLUS' ? 'MENU_PLUS' : 'FIXED';
  const priceValue = Number(data.price_value ?? data.price_total ?? 0) || 0;
  const tx = db.transaction(() => {
    db.prepare(`UPDATE promos SET name=?, label=?, description=?, price_total=?, price_mode=?, price_value=?, max_per_order=?, active=?, updated_at=datetime('now') WHERE id=?`)
      .run(data.name, data.label || data.name, data.description || '', priceValue, priceMode, priceValue, data.max_per_order || 1, data.active === false ? 0 : 1, id);
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
  return promoById(id);
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
 *   { id, name, label, description, price_mode, price_value, max_per_order,
 *     lines: [{ item_id?, group_id?, quantity, extra_id?, extra_price? }] }
 */
export function activePromosForBusinessDay(businessDay) {
  const db = getDb();
  return db.prepare('SELECT * FROM promos WHERE active = 1').all()
    .map(p => promoById(p.id))
    .filter(p => isPromoActiveForDay(p, businessDay))
    .map(p => ({
      id: p.id,
      name: p.name,
      label: p.label,
      description: p.description,
      price_mode: p.price_mode,
      price_value: p.price_value,
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
 * Seed de promos por defecto (idempotente, v16).
 *
 * v16 (2026-09-01): 6 promos con el modelo A/B de precio:
 *   - Jueves de Chelada 2x1        → MENU_PLUS 0, línea grupo Micheladas qty 2
 *     (la 1ª unidad paga, la 2ª gratis — BOGO).
 *   - Miércoles de Barra           → FIXED 1200, línea grupo Cerveza Artesanal.
 *   - Combo Michelada + Cerveza    → FIXED 4500, líneas grupo Micheladas +
 *     grupo Cerveza Artesanal.
 *   - Primera Visita               → FIXED 2500, línea grupo Micheladas.
 *   - Micheladas + Shot Gratis     → MENU_PLUS 0, línea grupo Micheladas +
 *     extra Shot (gratis).
 *   - Micheladas + Escarchado Gratis → MENU_PLUS 0, línea grupo Micheladas +
 *     extra Doble Escarchado (gratis).
 *
 * Idempotente por label/nombre. Migra promos legacy (pre-v16, con
 * price_mode='FIXED' y price_value=0) al modo correcto UNA vez (marcador:
 * FIXED + price_value 0 → significa "sin migrar").
 */
export function seedDefaultPromos(db) {
  const steps = [];
  const catByName = (name) => db.prepare('SELECT id FROM menu_categories WHERE name = ?').get(name);
  const micheladas = catByName('Micheladas Especiales');
  const cervezaArt = catByName('Cerveza Artesanal');

  // ── 0. Extras que eran MODIFIER (Shot, Escarchado) → grupo Micheladas ──
  if (micheladas) {
    for (const ex of [{ name: 'Shot', price: 1500 }, { name: 'Doble Escarchado', price: 500 }]) {
      const exists = db.prepare('SELECT id FROM category_extras WHERE category_id = ? AND name = ?').get(micheladas.id, ex.name);
      if (!exists) {
        const eid = randomUUID();
        db.prepare(`INSERT INTO category_extras (id, category_id, name, price, active, sort_order, created_at, updated_at)
          VALUES (?,?,?,?,1,0, datetime('now'), datetime('now'))`)
          .run(eid, micheladas.id, ex.name, ex.price);
        steps.push(`extra ${ex.name} sembrado`);
      }
    }
  }
  const extraByName = (name) => micheladas
    ? db.prepare('SELECT id FROM category_extras WHERE category_id = ? AND name = ?').get(micheladas.id, name)
    : null;
  const shot = extraByName('Shot');
  const escarchado = extraByName('Doble Escarchado');

  // ── 1. Promos de venta (solo si existen las categorías) ──
  const defaultPromos = [
    {
      name: 'Jueves de Chelada 2x1', label: '2x1',
      description: '2x1 en Micheladas Signature.', price_mode: 'MENU_PLUS', price_value: 0,
      lines: () => micheladas ? [{ group_id: micheladas.id, quantity: 2 }] : [],
    },
    {
      name: 'Miércoles de Barra', label: 'Miércoles de Barra',
      description: 'Cerveza Artesanal a precio especial.', price_mode: 'FIXED', price_value: 1200,
      lines: () => cervezaArt ? [{ group_id: cervezaArt.id, quantity: 1 }] : [],
    },
    {
      name: 'Combo Michelada + Cerveza', label: 'Combo',
      description: '1 Michelada Signature + 1 Cerveza Artesanal.', price_mode: 'FIXED', price_value: 4500,
      lines: () => (micheladas && cervezaArt) ? [{ group_id: micheladas.id, quantity: 1 }, { group_id: cervezaArt.id, quantity: 1 }] : [],
    },
    {
      name: 'Primera Visita', label: 'Primera Visita',
      description: 'Michelada Signature para nuevos.', price_mode: 'FIXED', price_value: 2500,
      lines: () => micheladas ? [{ group_id: micheladas.id, quantity: 1 }] : [],
    },
    {
      name: 'Micheladas + Shot Gratis', label: 'Micheladas + Shot Gratis',
      description: 'Elige tu michelada y el shot va gratis (precio del menú).', price_mode: 'MENU_PLUS', price_value: 0,
      lines: () => (micheladas && shot) ? [{ group_id: micheladas.id, quantity: 1, extra_id: shot.id, extra_price: 0 }] : [],
    },
    {
      name: 'Micheladas + Escarchado Gratis', label: 'Micheladas + Escarchado Gratis',
      description: 'Elige tu michelada y el doble escarchado va gratis (precio del menú).', price_mode: 'MENU_PLUS', price_value: 0,
      lines: () => (micheladas && escarchado) ? [{ group_id: micheladas.id, quantity: 1, extra_id: escarchado.id, extra_price: 0 }] : [],
    },
  ];

  for (const p of defaultPromos) {
    const exists = db.prepare('SELECT id, price_mode, price_value FROM promos WHERE label = ? OR name = ?').get(p.label, p.name);
    if (exists) {
      // Migración legacy → modo correcto (UNA vez): si la promo aún está en
      // FIXED con price_value=0 (recién creada por el ADD COLUMN v16 y sin
      // tocar por Admin), se migra al modo/valor del seed. Una vez migrada,
      // 2x1 queda MENU_PLUS (≠FIXED) y las de FIXED quedan con value>0.
      if (exists.price_mode === 'FIXED' && (Number(exists.price_value) || 0) === 0) {
        db.prepare(`UPDATE promos SET price_mode=?, price_value=?, price_total=?, updated_at=datetime('now') WHERE id=?`)
          .run(p.price_mode, p.price_value, p.price_value, exists.id);
        steps.push(`promo ${p.label} migrada a ${p.price_mode} ${p.price_value}`);
      }
      // El dueño activa con el toggle, no por defecto.
      db.prepare('UPDATE promos SET active = 0 WHERE id = ?').run(exists.id);
      if (!steps.some(s => s.includes('migrada') && s.includes(p.label))) {
        steps.push(`promo ${p.label} ya existe (active=0)`);
      }
      continue;
    }
    const id = randomUUID();
    const lines = p.lines();
    if (lines.length === 0) { steps.push(`promo ${p.label} sin categoría (seed skipped)`); continue; }
    const tx = db.transaction(() => {
      db.prepare(`INSERT INTO promos (id, name, label, description, price_total, price_mode, price_value, max_per_order, active, created_at, updated_at)
        VALUES (?,?,?,?,?,?,?,1,0, datetime('now'), datetime('now'))`)
        .run(id, p.name, p.label, p.description, p.price_value, p.price_mode, p.price_value);
      for (const l of lines) {
        db.prepare(`INSERT INTO promo_lines (id, promo_id, item_id, group_id, quantity, extra_id, extra_price)
          VALUES (?,?,?,?,?,?,?)`)
          .run(randomUUID(), id, l.item_id || null, l.group_id, l.quantity || 1, l.extra_id || null, l.extra_price ?? null);
      }
    });
    tx();
    steps.push(`promo ${p.label} sembrada`);
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
  promoById,
  resolvePromoPrice,
  promoLineMatchesItem,
  seedDefaultPromos,
};
