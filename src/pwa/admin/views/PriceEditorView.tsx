/**
 * ADMIN — PriceEditorView
 *
 * Editor inline de precios de items del menú:
 *   - Búsqueda por nombre + filtro por categoría
 *   - Edición inline (input numérico + Enter) → PATCH /api/menu/items/:id/price
 *   - Badge "SIN PRECIO" en items con price null
 *   - Feedback por item (guardado/error)
 */

import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { Card } from '@/ui/components/Card';
import { Badge } from '@/ui/components/Badge';
import { Button } from '@/ui/components/Button';
import {
  fetchAdminMenuItems,
  updateMenuItemPrice,
  type AdminMenuItem,
} from '../../_shared/api/adminApi';
import { fetchMenuCategories, type MenuCategory } from '../../_shared/api/menuApi';

interface PriceEditorViewProps {
  token: string;
  onToast: (type: 'success' | 'error' | 'warning', message: string) => void;
}

interface ItemDraft {
  value: string;
  saving: boolean;
  saved: 'ok' | 'err' | null;
}

export function PriceEditorView({ token, onToast }: PriceEditorViewProps) {
  const [items, setItems] = useState<AdminMenuItem[]>([]);
  const [categories, setCategories] = useState<MenuCategory[]>([]);
  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [loading, setLoading] = useState(true);
  const [drafts, setDrafts] = useState<Record<string, ItemDraft>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [itemsRes, catsRes] = await Promise.all([
        fetchAdminMenuItems(token),
        fetchMenuCategories(),
      ]);
      setItems(itemsRes.items);
      setCategories(catsRes.categories);
      // Reset drafts on fresh load
      setDrafts({});
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter(i => {
      if (categoryId && i.category_id !== categoryId) return false;
      if (q && !i.name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [items, search, categoryId]);

  const nullCount = useMemo(() => items.filter(i => i.price == null).length, [items]);

  const handleDraftChange = useCallback((id: string, value: string) => {
    setDrafts(prev => ({ ...prev, [id]: { value, saving: false, saved: null } }));
  }, []);

  const handleSave = useCallback(async (item: AdminMenuItem) => {
    const draft = drafts[item.id];
    const price = Number(draft?.value);
    if (draft == null || Number.isNaN(price) || price < 0) {
      setDrafts(prev => ({ ...prev, [item.id]: { value: '', saving: false, saved: 'err' } }));
      onToast('error', 'Precio inválido');
      return;
    }

    setDrafts(prev => ({ ...prev, [item.id]: { value: String(price), saving: true, saved: null } }));
    const result = await updateMenuItemPrice(token, item.id, price);
    if (result.ok) {
      setItems(prev => prev.map(i => (i.id === item.id ? { ...i, price } : i)));
      setDrafts(prev => ({ ...prev, [item.id]: { value: String(price), saving: false, saved: 'ok' } }));
      onToast('success', `${item.name}: Bs. ${price.toFixed(2)}`);
    } else {
      setDrafts(prev => ({ ...prev, [item.id]: { value: String(price), saving: false, saved: 'err' } }));
      onToast('error', `Error al guardar ${item.name}`);
    }
    // Clear saved feedback after a moment
    setTimeout(() => {
      setDrafts(prev => {
        const next = { ...prev };
        delete next[item.id];
        return next;
      });
    }, 2000);
  }, [token, drafts, onToast]);

  const allNull = nullCount > 0 && nullCount === items.length;

  return (
    <div className="admin-view">
      <div className="admin-toolbar">
        <input
          type="search"
          className="admin-input admin-toolbar__search"
          placeholder="Buscar por nombre…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          aria-label="Buscar item"
        />
        <select
          className="admin-input"
          value={categoryId}
          onChange={e => setCategoryId(e.target.value)}
          aria-label="Filtrar por categoría"
        >
          <option value="">Todas las categorías</option>
          {categories.map(c => (
            <option key={c.id} value={c.id}>{c.emoji} {c.name}</option>
          ))}
        </select>
        <Button variant="secondary" size="sm" onClick={load} loading={loading}>
          ↻ Refrescar
        </Button>
        <Badge variant={nullCount > 0 ? 'pending' : 'paid'}>
          {nullCount} sin precio
        </Badge>
      </div>

      {allNull && (
        <Card className="admin-section">
          <p className="admin-muted">
            ⚠️ Todos los items están SIN PRECIO. Usa <strong>Carga Masiva</strong> para
            setear precios reales en un solo paso.
          </p>
        </Card>
      )}

      <Card className="admin-section">
        {loading ? (
          <p className="admin-muted">Cargando menú…</p>
        ) : filtered.length === 0 ? (
          <p className="admin-muted">Sin resultados.</p>
        ) : (
          <div className="admin-price-list">
            {filtered.map(item => {
              const draft = drafts[item.id];
              const value = draft?.value ?? (item.price != null ? String(item.price) : '');
              return (
                <div key={item.id} className="admin-price-row">
                  <div className="admin-price-row__info">
                    <span className="admin-price-row__name">{item.name}</span>
                    <span className="admin-price-row__cat">{item.category_name}</span>
                    {item.price == null && <Badge variant="pending">SIN PRECIO</Badge>}
                  </div>
                  <div className="admin-price-row__edit">
                    <div className="admin-price-input">
                      <span className="admin-price-input__prefix">Bs.</span>
                      <input
                        type="number"
                        min="0"
                        step="0.5"
                        className="admin-input admin-input--sm"
                        value={value}
                        placeholder="—"
                        onChange={e => handleDraftChange(item.id, e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') handleSave(item); }}
                        aria-label={`Precio de ${item.name}`}
                      />
                    </div>
                    <Button
                      variant="secondary"
                      size="sm"
                      loading={draft?.saving}
                      disabled={draft == null || draft.saved !== null}
                      onClick={() => handleSave(item)}
                    >
                      {draft?.saved === 'ok' ? '✓' : draft?.saved === 'err' ? '✗' : 'Guardar'}
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}
