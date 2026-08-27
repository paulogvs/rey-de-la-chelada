/**
 * ADMIN — MenuPanel (panel ÚNICO de menú)
 *
 * Reemplaza las 5 vistas anteriores (Menú, Apartados, Precios, Carga
 * Masiva, Tamaños) en UNA sola, con layout de cards por apartado:
 *
 *   - Header de apartado: emoji + nombre + contador + acciones
 *     (renombrar / ocultar / eliminar si vacía / + agregar item)
 *   - Por item: precio INLINE (se guarda solo al perder foco), ajuste
 *     "Familiar +Bs" para pizzas, y acciones (editar / ocultar / eliminar)
 *   - Toolbar: crear apartado, importar del seed, buscar, refrescar
 *
 * Guardado INLINE automático (decisión del dueño 2026-08-25): al cambiar
 * un precio se PATCH al server y se muestra check verde. Sin botón
 * "guardar todo".
 */

import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { Card } from '@/ui/components/Card';
import { Badge } from '@/ui/components/Badge';
import { Button } from '@/ui/components/Button';
import { Loader } from '@/ui/components/Loader';
import { FormField } from '@/ui/components/FormField';
import { MoneyInput } from '@/ui/components/MoneyInput/MoneyInput';
import { AppIcon } from '@/ui/components/AppIcon/AppIcon';
import {
  fetchAdminMenuItems,
  createMenuItem,
  updateMenuItem,
  toggleMenuItem,
  deleteMenuItem,
  createMenuCategory,
  updateMenuCategory,
  deleteMenuCategory,
  fetchMenuCategoriesAdmin,
  importSeedItems,
  updateMenuItemPrice,
  fetchModifierOptions,
  updateModifierOptionPrice,
  type AdminMenuItem,
  type MenuCategoryRow,
  type ModifierOptionRow,
} from '../../_shared/api/adminApi';

interface MenuPanelProps {
  token: string;
  onToast: (type: 'success' | 'error' | 'warning', message: string) => void;
}

interface ItemDraft {
  saving: boolean;
  saved: 'ok' | 'err' | null;
}

export function MenuPanel({ token, onToast }: MenuPanelProps) {
  const [items, setItems] = useState<AdminMenuItem[]>([]);
  const [categories, setCategories] = useState<MenuCategoryRow[]>([]);
  const [modOptions, setModOptions] = useState<ModifierOptionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');
  const [importing, setImporting] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, ItemDraft>>({});
  // Crear/editar apartado
  const [catForm, setCatForm] = useState<{ open: boolean; id: string | null; name: string; emoji: string }>({
    open: false, id: null, name: '', emoji: '🍽',
  });
  // Crear/editar item
  const [itemForm, setItemForm] = useState<{
    open: boolean; id: string | null; categoryId: string; name: string; area: 'bar' | 'cocina';
  }>({ open: false, id: null, categoryId: '', name: '', area: 'cocina' });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [itemsRes, catsRes, modsRes] = await Promise.all([
        fetchAdminMenuItems(token),
        fetchMenuCategoriesAdmin(token),
        fetchModifierOptions(token),
      ]);
      setItems(itemsRes.items);
      setCategories(catsRes.data?.categories ?? []);
      setModOptions(modsRes.options);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  // Mapa: item_id → opción "Familiar" (pizzas con tamaño)
  const familiarByItem = useMemo(() => {
    const map = new Map<string, ModifierOptionRow>();
    for (const opt of modOptions) {
      if (opt.name === 'Familiar') map.set(opt.menu_item_id, opt);
    }
    return map;
  }, [modOptions]);

  const grouped = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const visible = q ? items.filter(i => i.name.toLowerCase().includes(q)) : items;
    const map = new Map<string, AdminMenuItem[]>();
    for (const item of visible) {
      const cat = categories.find(c => c.id === item.category_id);
      const key = cat?.name ?? item.category_name ?? '—';
      const list = map.get(key) ?? [];
      list.push(item);
      map.set(key, list);
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [items, categories, filter]);

  const activeCount = items.filter(i => i.is_active === 1).length;

  // ── Precio inline ────────────────────────────────────────────
  const handlePriceChange = useCallback((id: string, cents: number) => {
    setDrafts(prev => ({ ...prev, [id]: { saving: false, saved: null } }));
    setItems(prev => prev.map(i => (i.id === id ? { ...i, price: cents } : i)));
  }, []);

  const handlePriceBlur = useCallback(async (item: AdminMenuItem) => {
    const draft = drafts[item.id];
    if (!draft || item.price == null || Number.isNaN(item.price) || item.price < 0) return;
    setDrafts(prev => ({ ...prev, [item.id]: { saving: true, saved: null } }));
    const result = await updateMenuItemPrice(token, item.id, item.price);
    setDrafts(prev => ({ ...prev, [item.id]: { saving: false, saved: result.ok ? 'ok' : 'err' } }));
    if (!result.ok) {
      onToast('error', `Error al guardar ${item.name}: ${result.error || ''}`);
      await load();
    }
    setTimeout(() => {
      setDrafts(prev => { const n = { ...prev }; delete n[item.id]; return n; });
    }, 2000);
  }, [drafts, token, onToast, load]);

  // ── Ajuste Familiar inline (pizzas) ──────────────────────────
  const handleFamiliarChange = useCallback((optId: string, cents: number) => {
    setDrafts(prev => ({ ...prev, [`fam-${optId}`]: { saving: false, saved: null } }));
    setModOptions(prev => prev.map(o => (o.id === optId ? { ...o, price_adjustment: cents } : o)));
  }, []);

  const handleFamiliarBlur = useCallback(async (opt: ModifierOptionRow) => {
    const draft = drafts[`fam-${opt.id}`];
    if (!draft || Number.isNaN(opt.price_adjustment) || opt.price_adjustment < 0) return;
    setDrafts(prev => ({ ...prev, [`fam-${opt.id}`]: { saving: true, saved: null } }));
    const result = await updateModifierOptionPrice(token, opt.id, opt.price_adjustment);
    setDrafts(prev => ({ ...prev, [`fam-${opt.id}`]: { saving: false, saved: result.ok ? 'ok' : 'err' } }));
    if (!result.ok) {
      onToast('error', `Error al guardar ajuste de ${opt.name}`);
      await load();
    }
    setTimeout(() => {
      setDrafts(prev => { const n = { ...prev }; delete n[`fam-${opt.id}`]; return n; });
    }, 2000);
  }, [drafts, token, onToast, load]);

  // ── Acciones de item ─────────────────────────────────────────
  const handleToggleItem = useCallback(async (item: AdminMenuItem) => {
    const result = await toggleMenuItem(token, item.id);
    if (result.ok) {
      onToast('success', `${item.name}: ${result.data?.is_active ? 'activado' : 'desactivado'}`);
      setItems(prev => prev.map(i => (i.id === item.id ? { ...i, is_active: result.data?.is_active ? 1 : 0 } : i)));
    } else {
      onToast('error', result.error || 'Error al cambiar estado');
    }
  }, [token, onToast]);

  const handleDeleteItem = useCallback(async (item: AdminMenuItem) => {
    if (!window.confirm(`¿Borrar "${item.name}" definitivamente? Solo si no tiene pedidos. Para ocultar usa el ojo.`)) return;
    const result = await deleteMenuItem(token, item.id);
    if (result.ok) {
      onToast('success', `${item.name} eliminado`);
      await load();
    } else if (result.code === 'ITEM_HAS_ORDERS') {
      onToast('warning', result.error || 'Tiene pedidos — desactívalo en vez de borrarlo');
    } else {
      onToast('error', result.error || 'Error al eliminar');
    }
  }, [token, onToast, load]);

  // ── Acciones de apartado ─────────────────────────────────────
  const handleSaveCategory = useCallback(async () => {
    if (!catForm.name.trim()) {
      onToast('warning', 'Nombre requerido');
      return;
    }
    const result = catForm.id
      ? await updateMenuCategory(token, catForm.id, { name: catForm.name.trim(), emoji: catForm.emoji || '🍽' })
      : await createMenuCategory(token, { name: catForm.name.trim(), emoji: catForm.emoji || '🍽' });
    if (result.ok) {
      onToast('success', catForm.id ? 'Apartado actualizado' : 'Apartado creado');
      setCatForm({ open: false, id: null, name: '', emoji: '🍽' });
      await load();
    } else {
      onToast('error', result.error || 'Error con el apartado');
    }
  }, [catForm, token, onToast, load]);

  const handleToggleCategory = useCallback(async (cat: MenuCategoryRow) => {
    const result = await updateMenuCategory(token, cat.id, { is_active: cat.is_active !== 1 });
    if (result.ok) {
      onToast('success', `${cat.name}: ${cat.is_active === 1 ? 'oculto' : 'visible'}`);
      await load();
    } else {
      onToast('error', result.error || 'Error al cambiar estado');
    }
  }, [token, onToast, load]);

  const handleDeleteCategory = useCallback(async (cat: MenuCategoryRow) => {
    const count = items.filter(i => i.category_id === cat.id).length;
    if (count > 0) {
      onToast('warning', `Tiene ${count} item(s) — vacíala o ocúltala antes de borrar`);
      return;
    }
    if (!window.confirm(`¿Borrar el apartado "${cat.name}"?`)) return;
    const result = await deleteMenuCategory(token, cat.id);
    if (result.ok) {
      onToast('success', 'Apartado eliminado');
      await load();
    } else {
      onToast('error', result.error || 'Error al eliminar');
    }
  }, [items, token, onToast, load]);

  // ── Crear/editar item ────────────────────────────────────────
  const handleSaveItem = useCallback(async () => {
    if (!itemForm.name.trim() || !itemForm.categoryId) {
      onToast('warning', 'Nombre y apartado requeridos');
      return;
    }
    const result = itemForm.id
      ? await updateMenuItem(token, itemForm.id, { name: itemForm.name.trim(), category_id: itemForm.categoryId, area: itemForm.area })
      : await createMenuItem(token, { name: itemForm.name.trim(), category_id: itemForm.categoryId, area: itemForm.area, price: null });
    if (result.ok) {
      onToast('success', itemForm.id ? 'Item actualizado' : 'Item creado');
      setItemForm({ open: false, id: null, categoryId: '', name: '', area: 'cocina' });
      await load();
    } else {
      onToast('error', result.error || 'Error al guardar item');
    }
  }, [itemForm, token, onToast, load]);

  const handleImport = useCallback(async () => {
    if (!window.confirm('Importar items y apartados NUEVOS del seed? No pisa nada existente.')) return;
    setImporting(true);
    const result = await importSeedItems(token);
    setImporting(false);
    if (result.ok) {
      onToast('success', result.data?.message || 'Importación completada');
      await load();
    } else {
      onToast('error', result.error || 'Error al importar del seed');
    }
  }, [token, onToast, load]);

  return (
    <div className="admin-view">
      <div className="admin-toolbar">
        <FormField
          type="search"
          variant="constrained" className="form-input--mono admin-toolbar__search"
          placeholder="Buscar item…"
          value={filter}
          onChange={e => setFilter(e.target.value)}
          aria-label="Buscar item"
        />
        <Button variant="primary" size="sm" onClick={() => setCatForm({ open: true, id: null, name: '', emoji: '🍽' })}>
          <AppIcon name="plus" size="sm" /> Nuevo apartado
        </Button>
        <Button variant="secondary" size="sm" onClick={handleImport} loading={importing}>
          <AppIcon name="download" size="sm" /> Importar del seed
        </Button>
        <Button variant="secondary" size="sm" onClick={load} loading={loading}>
          <AppIcon name="refresh" size="sm" /> Refrescar
        </Button>
        <Badge variant="info">{activeCount}/{items.length} activos</Badge>
      </div>

      {catForm.open && (
        <Card className="admin-section">
          <h3>{catForm.id ? 'Renombrar apartado' : 'Nuevo apartado'}</h3>
          <div className="admin-menu-form admin-menu-form--inline">
            <FormField
              label="Nombre"
              value={catForm.name}
              onChange={e => setCatForm(f => ({ ...f, name: e.target.value }))}
              placeholder="Ej: Cócteles Especiales"
            />
            <FormField
              label="Emoji"
              value={catForm.emoji}
              onChange={e => setCatForm(f => ({ ...f, emoji: e.target.value }))}
              maxLength={4}
            />
            <div className="admin-menu-form__actions">
              <Button variant="primary" size="sm" onClick={handleSaveCategory}>
                {catForm.id ? 'Guardar' : 'Crear apartado'}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setCatForm({ open: false, id: null, name: '', emoji: '🍽' })}>Cancelar</Button>
            </div>
          </div>
        </Card>
      )}

      {itemForm.open && (
        <Card className="admin-section">
          <h3>{itemForm.id ? 'Editar item' : 'Nuevo item'}</h3>
          <div className="admin-menu-form admin-menu-form--inline">
            <FormField
              label="Nombre"
              value={itemForm.name}
              onChange={e => setItemForm(f => ({ ...f, name: e.target.value }))}
              placeholder="Nombre del producto"
            />
            <label className="admin-menu-form__label" htmlFor="menu-panel-cat">Apartado</label>
            <select
              id="menu-panel-cat"
              className="form-input--mono"
              value={itemForm.categoryId}
              onChange={e => setItemForm(f => ({ ...f, categoryId: e.target.value }))}
            >
              {categories.map(c => <option key={c.id} value={c.id}>{c.emoji} {c.name}</option>)}
            </select>
            <label className="admin-menu-form__label" htmlFor="menu-panel-area">Área</label>
            <select
              id="menu-panel-area"
              className="form-input--mono"
              value={itemForm.area}
              onChange={e => setItemForm(f => ({ ...f, area: e.target.value as 'bar' | 'cocina' }))}
            >
              <option value="bar">Barra</option>
              <option value="cocina">Cocina</option>
            </select>
            <div className="admin-menu-form__actions">
              <Button variant="primary" size="sm" onClick={handleSaveItem}>
                {itemForm.id ? 'Guardar cambios' : 'Crear item'}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setItemForm({ open: false, id: null, categoryId: '', name: '', area: 'cocina' })}>Cancelar</Button>
            </div>
          </div>
        </Card>
      )}

      {loading ? (
        <Card className="admin-section"><Loader label="Cargando menú…" /></Card>
      ) : grouped.length === 0 ? (
        <Card className="admin-section"><p className="admin-muted">Sin items. Crea un apartado o importa del seed.</p></Card>
      ) : (
        grouped.map(([catName, catItems]) => {
          const cat = categories.find(c => c.name === catName);
          return (
            <Card key={catName} className="admin-section">
              <div className="admin-menu-cat__header">
                <h3>{cat?.emoji ?? '🍽'} {catName} <Badge variant="info">{catItems.length}</Badge></h3>
                <div className="admin-menu-cat__actions">
                  {cat && (
                    <>
                      <Button variant="ghost" size="sm" onClick={() => setCatForm({ open: true, id: cat.id, name: cat.name, emoji: cat.emoji || '🍽' })} title="Renombrar">
                        <AppIcon name="edit" size="sm" />
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => handleToggleCategory(cat)} title={cat.is_active === 1 ? 'Ocultar apartado' : 'Mostrar apartado'}>
                        <AppIcon name={cat.is_active === 1 ? 'eye-off' : 'eye'} size="sm" />
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => handleDeleteCategory(cat)} title="Borrar apartado (solo vacío)">
                        <AppIcon name="trash" size="sm" />
                      </Button>
                    </>
                  )}
                  <Button variant="secondary" size="sm" onClick={() => setItemForm({ open: true, id: null, categoryId: cat?.id ?? '', name: '', area: 'cocina' })}>
                    <AppIcon name="plus" size="sm" /> Agregar item
                  </Button>
                </div>
              </div>
              <div className="admin-bulk-grid">
                {catItems.map(item => {
                  const draft = drafts[item.id];
                  const familiar = familiarByItem.get(item.id);
                  const famDraft = familiar ? drafts[`fam-${familiar.id}`] : null;
                  return (
                    <div key={item.id} className={`admin-bulk-item ${item.is_active === 1 ? '' : 'admin-menu-row--inactive'}`}>
                      <div className="admin-bulk-item__name" title={item.name}>
                        {item.name}
                        {item.is_active !== 1 && <Badge variant="cancelled">oculto</Badge>}
                      </div>
                      <div className="admin-bulk-item__row">
                        <div className="admin-bulk-item__prices">
                          <div className="admin-price-input">
                            <span className="admin-price-input__prefix">Bs</span>
                            <MoneyInput
                              variant="sm" className="form-input--mono"
                              value={item.price ?? 0}
                              placeholder="—"
                              onChange={cents => handlePriceChange(item.id, cents)}
                              onBlur={() => handlePriceBlur(item)}
                              aria-label={`Precio de ${item.name}`}
                            />
                            {draft?.saving && <span className="admin-bulk-item__saving">…</span>}
                            {draft?.saved === 'ok' && <span className="admin-bulk-item__ok"><AppIcon name="check" size="sm" /></span>}
                            {draft?.saved === 'err' && <span className="admin-bulk-item__err"><AppIcon name="x" size="sm" /></span>}
                          </div>
                          {familiar && (
                            <div className="admin-price-input admin-price-input--familiar">
                              <span className="admin-price-input__prefix">Fam +Bs</span>
                              <MoneyInput
                                variant="sm" className="form-input--mono"
                                value={familiar.price_adjustment}
                                placeholder="0"
                                onChange={cents => handleFamiliarChange(familiar.id, cents)}
                                onBlur={() => handleFamiliarBlur(familiar)}
                                aria-label={`Ajuste Familiar de ${item.name}`}
                              />
                              {famDraft?.saving && <span className="admin-bulk-item__saving">…</span>}
                              {famDraft?.saved === 'ok' && <span className="admin-bulk-item__ok"><AppIcon name="check" size="sm" /></span>}
                              {famDraft?.saved === 'err' && <span className="admin-bulk-item__err"><AppIcon name="x" size="sm" /></span>}
                            </div>
                          )}
                        </div>
                        <div className="admin-bulk-item__actions">
                          <Button variant="ghost" size="sm" onClick={() => setItemForm({ open: true, id: item.id, categoryId: item.category_id, name: item.name, area: item.area === 'bar' ? 'bar' : 'cocina' })} title="Editar">
                            <AppIcon name="edit" size="sm" />
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => handleToggleItem(item)} title={item.is_active === 1 ? 'Ocultar' : 'Mostrar'}>
                            <AppIcon name={item.is_active === 1 ? 'eye-off' : 'eye'} size="sm" />
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => handleDeleteItem(item)} title="Borrar (solo sin pedidos)">
                            <AppIcon name="trash" size="sm" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>
          );
        })
      )}
    </div>
  );
}

export default MenuPanel;