/**
 * ADMIN — MenuView
 *
 * Gestión completa del menú desde la UI (modo admin):
 *   - Crear item (nombre, categoría, área barra/cocina, precio)
 *   - Editar item (nombre, precio, categoría, área, estado)
 *   - Activar/desactivar item (recomendado sobre borrar — conserva historial)
 *   - Borrar item SOLO si no tiene pedidos (409 si los tiene)
 *   - Importar items/categorías NUEVOS del seed (no pisa ediciones)
 *
 * Backend: server/routes/menu.js (CRUD ya existente + import-seed).
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
  importSeedItems,
  fetchMenuCategoriesAdmin,
  type AdminMenuItem,
  type MenuCategoryRow,
} from '../../_shared/api/adminApi';
import { formatMoney } from '../../_shared/utils/format';

interface MenuViewProps {
  token: string;
  onToast: (type: 'success' | 'error' | 'warning', message: string) => void;
}

interface ItemForm {
  name: string;
  category_id: string;
  area: 'bar' | 'cocina';
  price: number;
}

const EMPTY_FORM: ItemForm = { name: '', category_id: '', area: 'cocina', price: 0 };

export function MenuView({ token, onToast }: MenuViewProps) {
  const [items, setItems] = useState<AdminMenuItem[]>([]);
  const [categories, setCategories] = useState<MenuCategoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<ItemForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const [filter, setFilter] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [itemsRes, catsRes] = await Promise.all([
        fetchAdminMenuItems(token),
        fetchMenuCategoriesAdmin(token),
      ]);
      setItems(itemsRes.items);
      setCategories(catsRes.data?.categories ?? []);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const grouped = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const visible = q ? items.filter(i => i.name.toLowerCase().includes(q)) : items;
    const map = new Map<string, AdminMenuItem[]>();
    for (const item of visible) {
      const list = map.get(item.category_name) ?? [];
      list.push(item);
      map.set(item.category_name, list);
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [items, filter]);

  const startCreate = useCallback(() => {
    setEditingId(null);
    setForm({ ...EMPTY_FORM, category_id: categories[0]?.id ?? '' });
    setShowForm(true);
  }, [categories]);

  const startEdit = useCallback((item: AdminMenuItem) => {
    setShowForm(true);
    setEditingId(item.id);
    setForm({
      name: item.name,
      category_id: item.category_id,
      area: item.area === 'bar' ? 'bar' : 'cocina',
      price: item.price ?? 0,
    });
  }, []);

  const handleSave = useCallback(async () => {
    if (!form.name.trim() || !form.category_id) {
      onToast('warning', 'Nombre y categoría son requeridos');
      return;
    }
    setSaving(true);
    const price = form.price === 0 ? null : form.price;
    const result = editingId
      ? await updateMenuItem(token, editingId, { name: form.name.trim(), category_id: form.category_id, area: form.area, price })
      : await createMenuItem(token, { name: form.name.trim(), category_id: form.category_id, area: form.area, price });
    setSaving(false);

    if (result.ok) {
      onToast('success', editingId ? 'Item actualizado' : 'Item creado');
      setShowForm(false);
      setEditingId(null);
      await load();
    } else {
      const code = (result as { code?: string }).code;
      onToast('error', result.error || (code ? `Error (${code})` : 'Error al guardar'));
    }
  }, [form, editingId, token, onToast, load]);

  const handleToggle = useCallback(async (item: AdminMenuItem) => {
    const result = await toggleMenuItem(token, item.id);
    if (result.ok) {
      onToast('success', `${item.name}: ${result.data?.is_active ? 'activado' : 'desactivado'}`);
      setItems(prev => prev.map(i => (i.id === item.id ? { ...i, is_active: result.data?.is_active ? 1 : 0 } : i)));
    } else {
      onToast('error', result.error || 'Error al cambiar estado');
    }
  }, [token, onToast]);

  const handleDelete = useCallback(async (item: AdminMenuItem) => {
    if (!window.confirm(`¿Borrar "${item.name}" definitivamente? Solo se permite si no tiene pedidos. Para ocultar, usa desactivar.`)) return;
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

  const activeCount = items.filter(i => i.is_active === 1).length;

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
        <Button variant="primary" size="sm" onClick={startCreate}>
          <AppIcon name="plus" size="sm" /> Nuevo item
        </Button>
        <Button variant="secondary" size="sm" onClick={handleImport} loading={importing}>
          <AppIcon name="download" size="sm" /> Importar del seed
        </Button>
        <Button variant="secondary" size="sm" onClick={load} loading={loading}>
          <AppIcon name="refresh" size="sm" /> Refrescar
        </Button>
        <Badge variant="info">{activeCount}/{items.length} activos</Badge>
      </div>

      {showForm && (
        <Card className="admin-section">
          <h3>{editingId ? 'Editar item' : 'Nuevo item'}</h3>
          <div className="admin-menu-form">
            <FormField
              label="Nombre"
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              placeholder="Nombre del producto"
            />
            <label className="admin-menu-form__label" htmlFor="menu-item-category">Apartado</label>
            <select
              id="menu-item-category"
              className="form-input--mono"
              value={form.category_id}
              onChange={e => setForm(f => ({ ...f, category_id: e.target.value }))}
            >
              {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <label className="admin-menu-form__label" htmlFor="menu-item-area">Área</label>
            <select
              id="menu-item-area"
              className="form-input--mono"
              value={form.area}
              onChange={e => setForm(f => ({ ...f, area: e.target.value as 'bar' | 'cocina' }))}
            >
              <option value="bar">Barra</option>
              <option value="cocina">Cocina</option>
            </select>
            <label className="admin-menu-form__label" htmlFor="menu-item-price">Precio (Bs)</label>
            <MoneyInput
              id="menu-item-price"
              variant="sm" className="form-input--mono"
              value={form.price}
              onChange={cents => setForm(f => ({ ...f, price: cents }))}
              placeholder="0,00 (dejar 0 = sin precio)"
            />
            <div className="admin-menu-form__actions">
              <Button variant="primary" size="sm" onClick={handleSave} loading={saving}>
                {editingId ? 'Guardar cambios' : 'Crear item'}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => { setShowForm(false); setEditingId(null); }}>Cancelar</Button>
            </div>
          </div>
        </Card>
      )}

      <Card className="admin-section">
        {loading ? (
          <Loader label="Cargando menú…" />
        ) : grouped.length === 0 ? (
          <p className="admin-muted">Sin items. Crea uno o importa del seed.</p>
        ) : (
          grouped.map(([catName, catItems]) => (
            <div key={catName} className="admin-menu-cat">
              <h4 className="admin-menu-cat__title">{catName} <Badge variant="info">{catItems.length}</Badge></h4>
              {catItems.map(item => (
                <div key={item.id} className={`admin-menu-row ${item.is_active === 1 ? '' : 'admin-menu-row--inactive'}`}>
                  <div className="admin-menu-row__info">
                    <span className="admin-menu-row__name">{item.name}</span>
                    <span className="admin-menu-row__meta">
                      {item.price != null ? formatMoney(item.price) : '—'} · {item.area === 'bar' ? 'Barra' : 'Cocina'}
                      {item.is_active !== 1 && <Badge variant="cancelled">oculto</Badge>}
                    </span>
                  </div>
                  <div className="admin-menu-row__actions">
                    <Button variant="ghost" size="sm" onClick={() => startEdit(item)} title="Editar">
                      <AppIcon name="edit" size="sm" />
                    </Button>
                    <Button
                      variant="ghost" size="sm"
                      onClick={() => handleToggle(item)}
                      title={item.is_active === 1 ? 'Desactivar (ocultar)' : 'Activar (mostrar)'}
                    >
                      <AppIcon name={item.is_active === 1 ? 'eye-off' : 'eye'} size="sm" />
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => handleDelete(item)} title="Borrar (solo sin pedidos)">
                      <AppIcon name="trash" size="sm" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          ))
        )}
      </Card>
    </div>
  );
}

export default MenuView;