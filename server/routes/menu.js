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
import { getDb } from '../db/index.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import {
  validateBulkPricesRequest,
  applyBulkPriceUpdates,
  validateModifierOptionUpdate,
  validateBulkModifierPricesRequest,
  applyBulkModifierPriceUpdates,
} from '../services/menu-bulk-updates.js';

const router = Router();

// ============================================================
// GET /api/menu/categories — Categorías activas
// ============================================================

router.get('/categories', (req, res) => {
  try {
    const db = getDb();
    const { include_inactive } = req.query;
    const where = include_inactive === 'true' ? '1=1' : 'is_active = 1';
    const categories = db.prepare(
      `SELECT id, name, description, emoji, sort_order, is_active
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

    res.json({ success: true, item, modifiers });
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
    const { name, description, emoji, sort_order } = req.body;
    if (!name) {
      return res.status(400).json({ success: false, error: 'Nombre requerido', code: 'NAME_REQUIRED' });
    }

    const db = getDb();
    const id = randomUUID();
    db.prepare(
      'INSERT INTO menu_categories (id, name, description, emoji, sort_order) VALUES (?, ?, ?, ?, ?)'
    ).run(id, name, description || '', emoji || '🍽', sort_order ?? 0);

    const category = db.prepare('SELECT * FROM menu_categories WHERE id = ?').get(id);
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
    const { name, description, emoji, sort_order, is_active } = req.body;
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

    if (updates.length === 0) {
      return res.status(400).json({ success: false, error: 'Nada que actualizar', code: 'NO_UPDATES' });
    }

    updates.push('updated_at = datetime(\'now\')');
    params.push(req.params.id);
    db.prepare(`UPDATE menu_categories SET ${updates.join(', ')} WHERE id = ?`).run(...params);

    const updated = db.prepare('SELECT * FROM menu_categories WHERE id = ?').get(req.params.id);
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
    const { name, subtitle, description, price, currency, category_id, image_url, sort_order, is_available, area, preparation_time } = req.body;

    if (!name || price === undefined || !category_id) {
      return res.status(400).json({
        success: false,
        error: 'Nombre, precio y categoría son requeridos',
        code: 'ITEM_DATA_REQUIRED',
      });
    }

    const db = getDb();

    // Verify category exists
    const cat = db.prepare('SELECT id FROM menu_categories WHERE id = ?').get(category_id);
    if (!cat) {
      return res.status(404).json({ success: false, error: 'Categoría no encontrada', code: 'CATEGORY_NOT_FOUND' });
    }

    const id = randomUUID();
    // Booleanos JS → 0/1 (SQLite no acepta true/false al bindear)
    const availableInt = is_available ? 1 : 0;
    db.prepare(`
      INSERT INTO menu_items (id, category_id, name, subtitle, description, price, currency,
                              image_url, is_available, sort_order, area, preparation_time)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, category_id, name, subtitle || '', description || '', price,
      currency || 'BOB', image_url || '', availableInt, sort_order ?? 0,
      area || 'cocina', preparation_time ?? 15
    );

    const item = db.prepare('SELECT * FROM menu_items WHERE id = ?').get(id);
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
    const fields = ['name', 'subtitle', 'description', 'price', 'currency', 'category_id', 'image_url',
                    'sort_order', 'is_available', 'is_active', 'area', 'preparation_time', 'iva_percentage'];
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

    if (updates.length === 0) {
      return res.status(400).json({ success: false, error: 'Nada que actualizar', code: 'NO_UPDATES' });
    }

    updates.push('updated_at = datetime(\'now\')');
    params.push(req.params.id);
    db.prepare(`UPDATE menu_items SET ${updates.join(', ')} WHERE id = ?`).run(...params);

    const updated = db.prepare('SELECT * FROM menu_items WHERE id = ?').get(req.params.id);
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

export default router;
