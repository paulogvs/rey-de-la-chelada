/**
 * ═══════════════════════════════════════════════════════════
 *  Menu Routes — Catálogo de productos (público + admin)
 *
 *  GET    /api/menu/categories        → Categorías activas
 *  GET    /api/menu/items             → Items activos (filtrable)
 *  GET    /api/menu/items/:id         → Item específico
 *  POST   /api/menu/categories        → Crear categoría (admin)
 *  PUT    /api/menu/categories/:id    → Actualizar categoría (admin)
 *  POST   /api/menu/items             → Crear item (admin)
 *  PUT    /api/menu/items/:id         → Actualizar item (admin)
 *  PATCH  /api/menu/items/:id/toggle  → Activar/desactivar (admin)
 *
 *  Alineado al SSOT: server/db/schema.js (menu_categories,
 *  menu_items, modifier_groups, modifier_options)
 * ═══════════════════════════════════════════════════════════
 */

import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDb } from '../db/index.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import {
  validateBulkPricesRequest,
  applyBulkPriceUpdates,
  validateModifierOptionUpdate,
  validateBulkModifierPricesRequest,
  applyBulkModifierPriceUpdates,
} from '../services/menu-bulk-updates.js';
import { createModifierGroupsForItem, createAdditionsModifiersForItem } from '../scripts/menu-modifier-helpers.js';
// v17 (2026-09-01): broadcast explícito por mutador — el middleware final
// router.use que envolvía res.json NUNCA interceptaba las rutas mutadoras
// (estaban registradas ANTES que el middleware), por eso crear/editar items
// no refrescaba el menú en meseros. Ahora cada mutador 2xx emite
// broadcastMenuChanged() explícitamente (debounce 1s dentro de la función).
import { broadcastMenuChanged } from '../services/order-broadcaster.js';

const router = Router();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SEED_PATH = path.resolve(__dirname, '../../src/core/data/menu-seed.json');

// ============================================================
// GET /api/menu/categories — Categorías activas
// ============================================================

router.get('/categories', (req, res) => {
  try {
    const db = getDb();
    const { include_inactive } = req.query;
    const where = include_inactive === 'true' ? '1=1' : 'is_active = 1';
    const categories = db.prepare(
      `SELECT id, name, description, emoji, sort_order, is_active, area
       FROM menu_categories WHERE ${where} ORDER BY sort_order ASC, name ASC`
    ).all();
    res.json({ success: true, categories });
  } catch (err) {
    console.error('[Menu] Categories error:', err.message);
    res.status(500).json({ success: false, error: 'Error al obtener categorías', code: 'CATEGORIES_ERROR' });
  }
});

// ============================================================
// GET /api/menu/items — Items activos (filtrable por categoría)
// ============================================================

router.get('/items', (req, res) => {
  try {
    const db = getDb();
    const { category_id, search, available, include_inactive } = req.query;

    let sql = `
      SELECT mi.id, mi.name, mi.subtitle, mi.description, mi.price, mi.currency,
             mi.iva_percentage, mi.image_url, mi.is_active, mi.is_available,
             mi.preparation_time, mi.sort_order, mi.area,
             mi.price_variable, mi.promo_price,
             mc.id as category_id, mc.name as category_name
      FROM menu_items mi
      JOIN menu_categories mc ON mi.category_id = mc.id
      WHERE 1=1
    `;
    const params = [];

    if (include_inactive !== 'true') {
      sql += ' AND mi.is_active = 1';
    }

    if (category_id) {
      sql += ' AND mi.category_id = ?';
      params.push(category_id);
    }

    if (search) {
      sql += ' AND (mi.name LIKE ? OR mi.description LIKE ?)';
      params.push(`%${search}%`, `%${search}%`);
    }

    if (available === 'true') {
      sql += ' AND mi.is_available = 1';
    }

    sql += ' ORDER BY mc.sort_order ASC, mi.sort_order ASC, mi.name ASC';

    const items = db.prepare(sql).all(...params);

    // Optional: attach modifierGroups (pizza sizes, extras) so the
    // clientes PWA can render size selection without N detail calls.
    if (req.query.include_modifiers === 'true' && items.length > 0) {
      const itemIds = items.map(i => i.id);
      const placeholders = itemIds.map(() => '?').join(',');
      const groups = db.prepare(`
        SELECT mg.id, mg.menu_item_id, mg.name, mg.type, mg.required,
               mg.min_select, mg.max_select, mg.sort_order
        FROM modifier_groups mg
        WHERE mg.menu_item_id IN (${placeholders})
        ORDER BY mg.menu_item_id ASC, mg.sort_order ASC
      `).all(...itemIds);
      const groupIds = groups.map(g => g.id);
      let options = [];
      if (groupIds.length > 0) {
        const gPlaceholders = groupIds.map(() => '?').join(',');
        options = db.prepare(`
          SELECT id, group_id, name, price_adjustment, is_default, sort_order
          FROM modifier_options
          WHERE group_id IN (${gPlaceholders})
          ORDER BY group_id ASC, sort_order ASC
        `).all(...groupIds);
      }
      const optionsByGroup = new Map();
      for (const o of options) {
        const list = optionsByGroup.get(o.group_id) ?? [];
        list.push({ id: o.id, name: o.name, priceAdjustment: o.price_adjustment, isDefault: o.is_default === 1 });
        optionsByGroup.set(o.group_id, list);
      }
      const groupsByItem = new Map();
      for (const g of groups) {
        const list = groupsByItem.get(g.menu_item_id) ?? [];
        list.push({
          id: g.id,
          name: g.name,
          type: g.type,
          required: g.required === 1,
          minSelect: g.min_select,
          maxSelect: g.max_select,
          options: optionsByGroup.get(g.id) ?? [],
        });
        groupsByItem.set(g.menu_item_id, list);
      }
      for (const item of items) {
        item.modifierGroups = groupsByItem.get(item.id) ?? [];
      }
    }

    res.json({ success: true, items });
  } catch (err) {
    console.error('[Menu] Items error:', err.message);
    res.status(500).json({ success: false, error: 'Error al obtener items', code: 'ITEMS_ERROR' });
  }
});

// ============================================================
// GET /api/menu/items/:id — Item específico + modifiers
// ============================================================

router.get('/items/:id', (req, res) => {
  try {
    const db = getDb();
    const item = db.prepare(`
      SELECT mi.*, mc.name as category_name
      FROM menu_items mi
      JOIN menu_categories mc ON mi.category_id = mc.id
      WHERE mi.id = ?
    `).get(req.params.id);

    if (!item) {
      return res.status(404).json({ success: false, error: 'Item no encontrado', code: 'ITEM_NOT_FOUND' });
    }

    // Get modifiers for this item
    const modifiers = db.prepare(`
      SELECT mg.id, mg.name, mg.type, mg.required, mg.min_select, mg.max_select,
             mo.id as option_id, mo.name as option_name,
             mo.price_adjustment as option_price, mo.is_default as option_default
      FROM modifier_groups mg
      LEFT JOIN modifier_options mo ON mg.id = mo.group_id
      WHERE mg.menu_item_id = ?
      ORDER BY mg.sort_order, mo.sort_order
    `).all(item.id);

    // v15: extras del GRUPO (categoría) del item — aparecen como "Extras"
    // en el detalle del item para que el mesero los marque.
    const categoryExtras = db.prepare(`
      SELECT id as extra_id, name as extra_name, price as extra_price
      FROM category_extras WHERE category_id = ? AND active = 1
      ORDER BY sort_order, name
    `).all(item.category_id);

    res.json({ success: true, item, modifiers, category_extras: categoryExtras });
  } catch (err) {
    console.error('[Menu] Item detail error:', err.message);
    res.status(500).json({ success: false, error: 'Error al obtener item', code: 'ITEM_DETAIL_ERROR' });
  }
});

// ============================================================
// Admin: POST /api/menu/categories
// ============================================================

router.post('/categories', requireAuth, requireRole('admin'), (req, res) => {
  try {
    const { name, description, emoji, sort_order, area } = req.body;
    if (!name) {
      return res.status(400).json({ success: false, error: 'Nombre requerido', code: 'NAME_REQUIRED' });
    }

    const db = getDb();
    const id = randomUUID();
    const catArea = area === 'bar' ? 'bar' : 'cocina';
    db.prepare(
      'INSERT INTO menu_categories (id, name, description, emoji, sort_order, area) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(id, name, description || '', emoji || '🍽', sort_order ?? 0, catArea);

    const category = db.prepare('SELECT * FROM menu_categories WHERE id = ?').get(id);
    broadcastMenuChanged();
    res.status(201).json({ success: true, category });
  } catch (err) {
    console.error('[Menu] Create category error:', err.message);
    res.status(500).json({ success: false, error: 'Error al crear categoría', code: 'CATEGORY_CREATE_ERROR' });
  }
});

// ============================================================
// Admin: PUT /api/menu/categories/:id
// ============================================================

router.put('/categories/:id', requireAuth, requireRole('admin'), (req, res) => {
  try {
    const { name, description, emoji, sort_order, is_active, area } = req.body;
    const db = getDb();

    const existing = db.prepare('SELECT id FROM menu_categories WHERE id = ?').get(req.params.id);
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Categoría no encontrada', code: 'CATEGORY_NOT_FOUND' });
    }

    const updates = [];
    const params = [];
    if (name) { updates.push('name = ?'); params.push(name); }
    if (description !== undefined) { updates.push('description = ?'); params.push(description); }
    if (emoji !== undefined) { updates.push('emoji = ?'); params.push(emoji); }
    if (sort_order !== undefined) { updates.push('sort_order = ?'); params.push(sort_order); }
    if (is_active !== undefined) { updates.push('is_active = ?'); params.push(is_active ? 1 : 0); }
    // v17: área del grupo. Si cambia → FORZAR todos los items del grupo a esa área.
    const changeArea = area === 'bar' || area === 'cocina';
    if (changeArea) { updates.push('area = ?'); params.push(area); }

    if (updates.length === 0) {
      return res.status(400).json({ success: false, error: 'Nada que actualizar', code: 'NO_UPDATES' });
    }

    updates.push('updated_at = datetime(\'now\')');
    params.push(req.params.id);
    db.prepare(`UPDATE menu_categories SET ${updates.join(', ')} WHERE id = ?`).run(...params);

    // "FORZAR TODO": al cambiar el área del grupo, heredarla a todos sus items.
    if (changeArea) {
      db.prepare(`UPDATE menu_items SET area = ?, updated_at = datetime('now') WHERE category_id = ?`).run(area, req.params.id);
    }

    const updated = db.prepare('SELECT * FROM menu_categories WHERE id = ?').get(req.params.id);
    broadcastMenuChanged();
    res.json({ success: true, category: updated });
  } catch (err) {
    console.error('[Menu] Update category error:', err.message);
    res.status(500).json({ success: false, error: 'Error al actualizar categoría', code: 'CATEGORY_UPDATE_ERROR' });
  }
});

// ============================================================
// Admin: POST /api/menu/items
// ============================================================

router.post('/items', requireAuth, requireRole('admin'), (req, res) => {
  try {
    const { name, subtitle, description, price, currency, category_id, image_url, sort_order, is_available, preparation_time } = req.body;

    if (!name || price === undefined || !category_id) {
      return res.status(400).json({
        success: false,
        error: 'Nombre, precio y categoría son requeridos',
        code: 'ITEM_DATA_REQUIRED',
      });
    }

    const db = getDb();

    // Verify category exists
    // v17: el área del item se HEREDA del grupo (menu_categories.area).
    const cat = db.prepare('SELECT id, area FROM menu_categories WHERE id = ?').get(category_id);
    if (!cat) {
      return res.status(404).json({ success: false, error: 'Categoría no encontrada', code: 'CATEGORY_NOT_FOUND' });
    }

    const id = randomUUID();
    // v18: un item creado SIEMPRE queda DISPONIBLE (is_available=1) salvo que el
    //      admin lo indique explícitamente. Esto evita que items nuevos queden
    //      ocultos en meseros por no mandar is_available.
    const availableInt = is_available === false ? 0 : (is_available === true ? 1 : 1);
    // La estrategia "FORZAR TODO": el item hereda el área del grupo, no del body.
    const itemArea = cat.area === 'bar' ? 'bar' : 'cocina';
    db.prepare(`
      INSERT INTO menu_items (id, category_id, name, subtitle, description, price, currency,
                              image_url, is_available, sort_order, area, preparation_time)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, category_id, name, subtitle || '', description || '', price,
      currency || 'BOB', image_url || '', availableInt, sort_order ?? 0,
      itemArea, preparation_time ?? 15
    );

    const item = db.prepare('SELECT * FROM menu_items WHERE id = ?').get(id);
    broadcastMenuChanged();
    res.status(201).json({ success: true, item });
  } catch (err) {
    console.error('[Menu] Create item error:', err.message);
    res.status(500).json({ success: false, error: 'Error al crear item', code: 'ITEM_CREATE_ERROR' });
  }
});

// ============================================================
// Admin: PUT /api/menu/items/:id
// ============================================================

router.put('/items/:id', requireAuth, requireRole('admin'), (req, res) => {
  try {
    // v17: `area` NO se edita desde el body — el item SIEMPRE hereda el área
    // de su GRUPO (menu_categories.area). Si cambia el apartado (category_id),
    // el área se recalcula; la estrategia "FORZAR TODO" ya lo hizo al cambiar
    // el área del grupo.
    const fields = ['name', 'subtitle', 'description', 'price', 'currency', 'category_id', 'image_url',
                    'sort_order', 'is_available', 'is_active', 'preparation_time', 'iva_percentage'];
    const db = getDb();

    const existing = db.prepare('SELECT id FROM menu_items WHERE id = ?').get(req.params.id);
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Item no encontrado', code: 'ITEM_NOT_FOUND' });
    }

    const updates = [];
    const params = [];
    for (const field of fields) {
      if (req.body[field] !== undefined) {
        updates.push(`${field} = ?`);
        params.push(typeof req.body[field] === 'boolean' ? (req.body[field] ? 1 : 0) : req.body[field]);
      }
    }

    // v17 "FORZAR TODO": si el item cambia de GRUPO → hereda el área del nuevo
    // grupo (menu_categories.area). El body.area ya no es la fuente.
    if (req.body.category_id !== undefined) {
      const newCat = db.prepare('SELECT area FROM menu_categories WHERE id = ?').get(req.body.category_id);
      if (newCat) {
        const forcedArea = newCat.area === 'bar' ? 'bar' : 'cocina';
        updates.push('area = ?');
        params.push(forcedArea);
      }
    }

    if (updates.length === 0) {
      return res.status(400).json({ success: false, error: 'Nada que actualizar', code: 'NO_UPDATES' });
    }

    updates.push('updated_at = datetime(\'now\')');
    params.push(req.params.id);
    db.prepare(`UPDATE menu_items SET ${updates.join(', ')} WHERE id = ?`).run(...params);

    const updated = db.prepare('SELECT * FROM menu_items WHERE id = ?').get(req.params.id);
    broadcastMenuChanged();
    res.json({ success: true, item: updated });
  } catch (err) {
    console.error('[Menu] Update item error:', err.message);
    res.status(500).json({ success: false, error: 'Error al actualizar item', code: 'ITEM_UPDATE_ERROR' });
  }
});

// ============================================================
// Admin: PATCH /api/menu/items/:id/toggle — Activar/desactivar
// ============================================================

router.patch('/items/:id/toggle', requireAuth, requireRole('admin'), (req, res) => {
  try {
    const db = getDb();
    const item = db.prepare('SELECT id, is_active FROM menu_items WHERE id = ?').get(req.params.id);
    if (!item) {
      return res.status(404).json({ success: false, error: 'Item no encontrado', code: 'ITEM_NOT_FOUND' });
    }

    const newActive = item.is_active ? 0 : 1;
    db.prepare('UPDATE menu_items SET is_active = ? WHERE id = ?').run(newActive, req.params.id);

    broadcastMenuChanged();
    res.json({
      success: true,
      is_active: !!newActive,
      message: `Item ${newActive ? 'activado' : 'desactivado'}`,
    });
  } catch (err) {
    console.error('[Menu] Toggle error:', err.message);
    res.status(500).json({ success: false, error: 'Error al cambiar estado', code: 'ITEM_TOGGLE_ERROR' });
  }
});

// ============================================================
// Admin: PATCH /api/menu/items/:id/price — Quick price update
// ============================================================

router.patch('/items/:id/price', requireAuth, requireRole('admin'), (req, res) => {
  try {
    const { price } = req.body;
    if (typeof price !== 'number' || Number.isNaN(price)) {
      return res.status(400).json({
        success: false, error: 'price numérico requerido', code: 'PRICE_REQUIRED',
      });
    }
    if (price < 0) {
      return res.status(400).json({
        success: false, error: 'price no puede ser negativo', code: 'PRICE_NEGATIVE',
      });
    }

    const db = getDb();
    const existing = db.prepare('SELECT id FROM menu_items WHERE id = ?').get(req.params.id);
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Item no encontrado', code: 'ITEM_NOT_FOUND' });
    }

    db.prepare(`
      UPDATE menu_items SET price = ?, updated_at = datetime('now') WHERE id = ?
    `).run(price, req.params.id);

    const updated = db.prepare('SELECT id, name, price FROM menu_items WHERE id = ?').get(req.params.id);
    broadcastMenuChanged();
    res.json({ success: true, item: updated, message: 'Precio actualizado' });
  } catch (err) {
    console.error('[Menu] Price update error:', err.message);
    res.status(500).json({ success: false, error: 'Error al actualizar precio', code: 'PRICE_UPDATE_ERROR' });
  }
});

// ============================================================
// Admin: POST /api/menu/items/bulk-prices — Bulk price update
// ============================================================

router.post('/items/bulk-prices', requireAuth, requireRole('admin'), (req, res) => {
  try {
    const validation = validateBulkPricesRequest(req.body);
    if (!validation.valid) {
      return res.status(400).json({
        success: false, error: validation.error, code: 'INVALID_BULK_REQUEST',
      });
    }

    const db = getDb();
    const result = applyBulkPriceUpdates(db, req.body.updates);

    broadcastMenuChanged();
    res.json({
      success: true,
      updated: result.updated,
      failed: result.failed,
      errors: result.errors,
      message: `${result.updated} precio(s) actualizado(s)`,
    });
  } catch (err) {
    console.error('[Menu] Bulk price update error:', err.message);
    res.status(500).json({ success: false, error: 'Error al actualizar precios', code: 'BULK_PRICE_ERROR' });
  }
});

// ============================================================
// GET /api/menu/modifier-options — Todas las opciones de mods
// (pizza sizes, etc) con su item y grupo — para el panel admin
// ============================================================

router.get('/modifier-options', requireAuth, requireRole('admin'), (req, res) => {
  try {
    const db = getDb();
    const options = db.prepare(`
      SELECT mo.id, mo.name, mo.price_adjustment, mo.is_default, mo.sort_order,
             mg.id as group_id, mg.name as group_name,
             mi.id as menu_item_id, mi.name as menu_item_name
      FROM modifier_options mo
      JOIN modifier_groups mg ON mo.group_id = mg.id
      JOIN menu_items mi ON mg.menu_item_id = mi.id
      ORDER BY mi.name ASC, mo.sort_order ASC
    `).all();
    res.json({ success: true, options, count: options.length });
  } catch (err) {
    console.error('[Menu] Modifier options error:', err.message);
    res.status(500).json({ success: false, error: 'Error al obtener opciones', code: 'MODIFIER_OPTIONS_ERROR' });
  }
});

// ============================================================
// Admin: PATCH /api/menu/modifier-options/:id/price
// ============================================================

router.patch('/modifier-options/:id/price', requireAuth, requireRole('admin'), (req, res) => {
  try {
    const { priceAdjustment } = req.body;
    const validation = validateModifierOptionUpdate({ id: req.params.id, priceAdjustment });
    if (!validation.valid) {
      return res.status(400).json({ success: false, error: validation.error, code: 'INVALID_MODIFIER_PRICE' });
    }

    const db = getDb();
    const existing = db.prepare('SELECT id, name FROM modifier_options WHERE id = ?').get(req.params.id);
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Opción no encontrada', code: 'MODIFIER_OPTION_NOT_FOUND' });
    }

    db.prepare('UPDATE modifier_options SET price_adjustment = ? WHERE id = ?')
      .run(priceAdjustment, req.params.id);

    const updated = db.prepare('SELECT id, name, price_adjustment FROM modifier_options WHERE id = ?').get(req.params.id);
    broadcastMenuChanged();
    res.json({ success: true, option: updated, message: 'Precio de opción actualizado' });
  } catch (err) {
    console.error('[Menu] Modifier option price error:', err.message);
    res.status(500).json({ success: false, error: 'Error al actualizar opción', code: 'MODIFIER_PRICE_ERROR' });
  }
});

// ============================================================
// Admin: POST /api/menu/modifier-options/bulk-prices
// ============================================================

router.post('/modifier-options/bulk-prices', requireAuth, requireRole('admin'), (req, res) => {
  try {
    const validation = validateBulkModifierPricesRequest(req.body);
    if (!validation.valid) {
      return res.status(400).json({ success: false, error: validation.error, code: 'INVALID_BULK_REQUEST' });
    }

    const db = getDb();
    const result = applyBulkModifierPriceUpdates(db, req.body.updates);

    broadcastMenuChanged();
    res.json({
      success: true,
      updated: result.updated,
      failed: result.failed,
      errors: result.errors,
      message: `${result.updated} opción(es) actualizada(s)`,
    });
  } catch (err) {
    console.error('[Menu] Bulk modifier price error:', err.message);
    res.status(500).json({ success: false, error: 'Error al actualizar opciones', code: 'BULK_MODIFIER_PRICE_ERROR' });
  }
});

// ============================================================
// Admin: DELETE /api/menu/items/:id — Borrar item (solo si NO
// tiene pedidos; el historial nunca se rompe). Para ocultar sin
// borrar, usar PATCH /items/:id/toggle (desactivar — recomendado).
// ============================================================

router.delete('/items/:id', requireAuth, requireRole('admin'), (req, res) => {
  try {
    const db = getDb();
    const item = db.prepare('SELECT id FROM menu_items WHERE id = ?').get(req.params.id);
    if (!item) {
      return res.status(404).json({ success: false, error: 'Item no encontrado', code: 'ITEM_NOT_FOUND' });
    }

    const orderCount = db.prepare(
      'SELECT COUNT(*) AS n FROM order_items WHERE menu_item_id = ?'
    ).get(req.params.id).n;
    if (orderCount > 0) {
      return res.status(409).json({
        success: false,
        error: `Este item tiene ${orderCount} pedido(s) — desactívalo en vez de borrarlo (conserva el historial)`,
        code: 'ITEM_HAS_ORDERS',
        orderCount,
      });
    }

    const tx = db.transaction(() => {
      // Eliminar opciones y grupos de modificadores del item
      const groups = db.prepare('SELECT id FROM modifier_groups WHERE menu_item_id = ?').all(req.params.id);
      for (const g of groups) {
        db.prepare('DELETE FROM modifier_options WHERE group_id = ?').run(g.id);
      }
      db.prepare('DELETE FROM modifier_groups WHERE menu_item_id = ?').run(req.params.id);
      db.prepare('DELETE FROM menu_items WHERE id = ?').run(req.params.id);
    });
    tx();

    broadcastMenuChanged();
    res.json({ success: true, message: 'Item eliminado', deleted: true });
  } catch (err) {
    console.error('[Menu] Delete item error:', err.message);
    res.status(500).json({ success: false, error: 'Error al eliminar item', code: 'ITEM_DELETE_ERROR' });
  }
});

// ============================================================
// Admin: DELETE /api/menu/categories/:id — Borrar categoría
// (solo si está vacía — si tiene items, desactívala o vacíala).
// ============================================================

router.delete('/categories/:id', requireAuth, requireRole('admin'), (req, res) => {
  try {
    const db = getDb();
    const cat = db.prepare('SELECT id FROM menu_categories WHERE id = ?').get(req.params.id);
    if (!cat) {
      return res.status(404).json({ success: false, error: 'Categoría no encontrada', code: 'CATEGORY_NOT_FOUND' });
    }

    const itemCount = db.prepare(
      'SELECT COUNT(*) AS n FROM menu_items WHERE category_id = ?'
    ).get(req.params.id).n;
    if (itemCount > 0) {
      return res.status(409).json({
        success: false,
        error: `La categoría tiene ${itemCount} item(s) — vacíala o desactívala antes de borrar`,
        code: 'CATEGORY_NOT_EMPTY',
        itemCount,
      });
    }

    db.prepare('DELETE FROM menu_categories WHERE id = ?').run(req.params.id);
    broadcastMenuChanged();
    res.json({ success: true, message: 'Categoría eliminada', deleted: true });
  } catch (err) {
    console.error('[Menu] Delete category error:', err.message);
    res.status(500).json({ success: false, error: 'Error al eliminar categoría', code: 'CATEGORY_DELETE_ERROR' });
  }
});

// ============================================================
// Admin: POST /api/menu/import-seed — Importar SOLO items y
// categorías NUEVOS del seed local (menu-seed.json).
//
// Modo admin (MENU_MANAGEMENT=admin en PROD): el bootstrap NO
// re-importa el seed en cada reinicio. Este endpoint permite traer
// mejoras de menú desde DEV (push → pull en PROD → import) SIN pisar
// precios/ediciones existentes: solo crea lo que NO existe.
//
// Contrato: nunca toca items/categorías existentes. Devuelve resumen.
// ============================================================

router.post('/import-seed', requireAuth, requireRole('admin'), (req, res) => {
  try {
    const db = getDb();
    let seed;
    try {
      seed = JSON.parse(fs.readFileSync(SEED_PATH, 'utf8'));
    } catch {
      return res.status(500).json({ success: false, error: 'No se pudo leer el seed local', code: 'SEED_READ_ERROR' });
    }

    const areas = ['BAR', 'COCINA'];
    const createdCategories = [];
    const createdItems = [];
    const skippedCategories = [];
    const skippedItems = [];

    const tx = db.transaction(() => {
      for (const areaKey of areas) {
        const areaData = seed?.restobar?.menu?.[areaKey];
        if (!areaData?.categorias) continue;
        const areaLower = areaKey === 'BAR' ? 'bar' : 'cocina';

        for (const cat of areaData.categorias) {
          const catName = cat.nombre_categoria;
          let existingCat = db.prepare('SELECT id FROM menu_categories WHERE name = ?').get(catName);
          if (!existingCat) {
            const catId = randomUUID();
            db.prepare(
              'INSERT INTO menu_categories (id, name, description, emoji, sort_order, area) VALUES (?, ?, ?, ?, ?, ?)'
            ).run(catId, catName, '', '🍽', 0, areaLower);
            existingCat = { id: catId };
            createdCategories.push(catName);
          } else {
            skippedCategories.push(catName);
          }

          const items = Array.isArray(cat.items) ? cat.items : [];
          for (const seedItem of items) {
            const name = seedItem.nombre;
            const existingItem = db.prepare(
              'SELECT id FROM menu_items WHERE name = ? AND category_id = ?'
            ).get(name, existingCat.id);
            if (existingItem) {
              skippedItems.push(name);
              continue;
            }

            const itemId = randomUUID();
            const sizeVariants = cat.variantes_tamanos && seedItem.precios
              ? seedItem.precios
              : null;
            const priceVariable = seedItem.precio_variable === undefined
              ? 0
              : (seedItem.precio_variable ? 1 : 0);

            db.prepare(`
              INSERT INTO menu_items (id, category_id, name, subtitle, description, price, price_variable,
                                      promo_price, currency, is_active, is_available, preparation_time,
                                      sort_order, area, size_variants, image_url)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'BOB', 1, 1, ?, ?, ?, ?, ?)
            `).run(
              itemId, existingCat.id, name,
              seedItem.subtitulo || '', seedItem.descripcion || '',
              seedItem.precio ?? null, priceVariable, seedItem.promo_price ?? null,
              areaLower === 'bar' ? 5 : 15, 0, areaLower,
              sizeVariants ? JSON.stringify(sizeVariants) : null, seedItem.image_url || null
            );

            if (sizeVariants) createModifierGroupsForItem(db, itemId, sizeVariants);
            if (Array.isArray(seedItem.adicionales)) createAdditionsModifiersForItem(db, itemId, seedItem.adicionales);
            createdItems.push(name);
          }
        }
      }
    });
    tx();

    broadcastMenuChanged();
    res.json({
      success: true,
      message: `Importación: ${createdItems.length} item(s) creado(s), ${createdCategories.length} apartado(s) creado(s)`,
      createdItems,
      createdCategories,
      skippedItems: skippedItems.length,
      skippedCategories: skippedCategories.length,
    });
  } catch (err) {
    console.error('[Menu] Import seed error:', err.message);
    res.status(500).json({ success: false, error: 'Error al importar del seed', code: 'IMPORT_SEED_ERROR' });
  }
});

export default router;
