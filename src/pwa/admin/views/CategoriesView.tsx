/**
 * ADMIN — CategoriesView
 *
 * Gestión de apartados (categorías) del menú — Barra y Comida:
 *   - Crear apartado (nombre, emoji, área implícita por uso)
 *   - Renombrar / cambiar emoji
 *   - Desactivar (oculta apartado y sus items del menú público)
 *   - Borrar SOLO si está vacía (409 si tiene items)
 *
 * Backend: server/routes/menu.js (CRUD categories ya existente + DELETE).
 */

import React, { useState, useCallback, useEffect } from 'react';
import { Card } from '@/ui/components/Card';
import { Badge } from '@/ui/components/Badge';
import { Button } from '@/ui/components/Button';
import { Loader } from '@/ui/components/Loader';
import { FormField } from '@/ui/components/FormField';
import { AppIcon } from '@/ui/components/AppIcon/AppIcon';
import {
  fetchMenuCategoriesAdmin,
  createMenuCategory,
  updateMenuCategory,
  deleteMenuCategory,
  fetchAdminMenuItems,
  type MenuCategoryRow,
} from '../../_shared/api/adminApi';

interface CategoriesViewProps {
  token: string;
  onToast: (type: 'success' | 'error' | 'warning', message: string) => void;
}

export function CategoriesView({ token, onToast }: CategoriesViewProps) {
  const [categories, setCategories] = useState<MenuCategoryRow[]>([]);
  const [itemCounts, setItemCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState('');
  const [newEmoji, setNewEmoji] = useState('🍽');
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editEmoji, setEditEmoji] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [catsRes, itemsRes] = await Promise.all([
        fetchMenuCategoriesAdmin(token),
        fetchAdminMenuItems(token),
      ]);
      setCategories(catsRes.data?.categories ?? []);
      const counts: Record<string, number> = {};
      for (const item of itemsRes.items) {
        counts[item.category_id] = (counts[item.category_id] ?? 0) + 1;
      }
      setItemCounts(counts);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const handleCreate = useCallback(async () => {
    if (!newName.trim()) {
      onToast('warning', 'Nombre requerido');
      return;
    }
    setCreating(true);
    const result = await createMenuCategory(token, { name: newName.trim(), emoji: newEmoji || '🍽' });
    setCreating(false);
    if (result.ok) {
      onToast('success', `Apartado "${newName.trim()}" creado`);
      setNewName('');
      setNewEmoji('🍽');
      await load();
    } else {
      onToast('error', result.error || 'Error al crear apartado');
    }
  }, [newName, newEmoji, token, onToast, load]);

  const startEdit = useCallback((cat: MenuCategoryRow) => {
    setEditingId(cat.id);
    setEditName(cat.name);
    setEditEmoji(cat.emoji || '🍽');
  }, []);

  const handleSaveEdit = useCallback(async () => {
    if (!editingId || !editName.trim()) return;
    const result = await updateMenuCategory(token, editingId, { name: editName.trim(), emoji: editEmoji || '🍽' });
    if (result.ok) {
      onToast('success', 'Apartado actualizado');
      setEditingId(null);
      await load();
    } else {
      onToast('error', result.error || 'Error al actualizar');
    }
  }, [editingId, editName, editEmoji, token, onToast, load]);

  const handleToggle = useCallback(async (cat: MenuCategoryRow) => {
    const result = await updateMenuCategory(token, cat.id, { is_active: cat.is_active !== 1 });
    if (result.ok) {
      onToast('success', `${cat.name}: ${cat.is_active === 1 ? 'desactivado' : 'activado'}`);
      await load();
    } else {
      onToast('error', result.error || 'Error al cambiar estado');
    }
  }, [token, onToast, load]);

  const handleDelete = useCallback(async (cat: MenuCategoryRow) => {
    const count = itemCounts[cat.id] ?? 0;
    if (count > 0) {
      onToast('warning', `Tiene ${count} item(s) — vacíala o desactívala antes de borrar`);
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
  }, [token, onToast, load, itemCounts]);

  return (
    <div className="admin-view">
      <div className="admin-toolbar">
        <Badge variant="info">{categories.length} apartados</Badge>
        <Button variant="secondary" size="sm" onClick={load} loading={loading}>
          <AppIcon name="refresh" size="sm" /> Refrescar
        </Button>
      </div>

      <Card className="admin-section">
        <h3>Nuevo apartado</h3>
        <div className="admin-menu-form">
          <FormField
            label="Nombre"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            placeholder="Ej: Cócteles Especiales"
          />
          <FormField
            label="Emoji"
            value={newEmoji}
            onChange={e => setNewEmoji(e.target.value)}
            placeholder="🍽"
            maxLength={4}
          />
          <div className="admin-menu-form__actions">
            <Button variant="primary" size="sm" onClick={handleCreate} loading={creating}>
              <AppIcon name="plus" size="sm" /> Crear apartado
            </Button>
          </div>
        </div>
      </Card>

      <Card className="admin-section">
        {loading ? (
          <Loader label="Cargando apartados…" />
        ) : (
          categories.map(cat => (
            <div key={cat.id} className={`admin-menu-row ${cat.is_active === 1 ? '' : 'admin-menu-row--inactive'}`}>
              {editingId === cat.id ? (
                <div className="admin-menu-form admin-menu-form--inline">
                  <FormField value={editName} onChange={e => setEditName(e.target.value)} aria-label="Nombre del apartado" />
                  <FormField value={editEmoji} onChange={e => setEditEmoji(e.target.value)} aria-label="Emoji" maxLength={4} />
                  <Button variant="primary" size="sm" onClick={handleSaveEdit}><AppIcon name="check" size="sm" /></Button>
                  <Button variant="ghost" size="sm" onClick={() => setEditingId(null)}><AppIcon name="x" size="sm" /></Button>
                </div>
              ) : (
                <>
                  <div className="admin-menu-row__info">
                    <span className="admin-menu-row__name">{cat.emoji} {cat.name}</span>
                    <span className="admin-menu-row__meta">
                      {itemCounts[cat.id] ?? 0} item(s)
                      {cat.is_active !== 1 && <Badge variant="cancelled">oculto</Badge>}
                    </span>
                  </div>
                  <div className="admin-menu-row__actions">
                    <Button variant="ghost" size="sm" onClick={() => startEdit(cat)} title="Renombrar">
                      <AppIcon name="edit" size="sm" />
                    </Button>
                    <Button
                      variant="ghost" size="sm"
                      onClick={() => handleToggle(cat)}
                      title={cat.is_active === 1 ? 'Ocultar apartado' : 'Mostrar apartado'}
                    >
                      <AppIcon name={cat.is_active === 1 ? 'eye-off' : 'eye'} size="sm" />
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => handleDelete(cat)} title="Borrar (solo si vacía)">
                      <AppIcon name="trash" size="sm" />
                    </Button>
                  </div>
                </>
              )}
            </div>
          ))
        )}
      </Card>
    </div>
  );
}

export default CategoriesView;