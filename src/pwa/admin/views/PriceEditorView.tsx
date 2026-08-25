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
import { Loader } from '@/ui/components/Loader';
import { FormField } from '@/ui/components/FormField';
import { MoneyInput } from '@/ui/components/MoneyInput/MoneyInput';
import { AppIcon } from '@/ui/components/AppIcon/AppIcon';
import {
  fetchAdminMenuItems,
  updateMenuItemPrice,
  type AdminMenuItem,
} from '../../_shared/api/adminApi';
import { fetchMenuCategories, type MenuCategory } from '../../_shared/api/menuApi';
import { formatMoney } from '../../_shared/utils/format';

interface PriceEditorViewProps {
  token: string;
  onToast: (type: 'success' | 'error' | 'warning', message: string) => void;
}

interface ItemDraft {
  /** Precio en CENTAVOS (entero) — contrato v11. */
  value: number;
  saving: boolean;
  saved: 'ok' | 'err' | null;
}

/**
 * Etiqueta descriptiva para items SIN precio base (UI admin).
 * Por diseño hay 3 casos legítimos sin precio:
 *   - price_variable=1        → "Precio manual" (mesero define al momento)
 *   - categoría Pizzas        → "Por tamaño" (Mediana/Familiar, la variante define el precio)
 *   - categoría Promociones   → "Variable 2x1" / "Variable" (promo con lógica propia)
 */
function priceLabel(item: AdminMenuItem): string {
  if (item.price_variable === 1) return 'Precio manual';
  const cat = (item.category_name ?? '').toLowerCase();
  if (cat.includes('pizza')) return 'Por tamaño';
  if (cat.includes('promocion')) {
    return item.name.toLowerCase().includes('2x1') ? 'Variable 2x1' : 'Variable';
  }
  return 'Sin precio';
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

  // La alerta cuenta SOLO productos facturables sin precio base (barra/cocina).
  // Las promociones (ej. "Jueves de Chelada 2x1") tienen lógica propia de
  // cálculo (módulo promotions) y NO son productos — no afectan la alerta.
  const nullCount = useMemo(
    () => items.filter(i => i.price == null && i.category_name !== 'Promociones').length,
    [items]
  );

  const handleDraftChange = useCallback((id: string, cents: number) => {
    setDrafts(prev => ({ ...prev, [id]: { value: cents, saving: false, saved: null } }));
  }, []);

  const handleSave = useCallback(async (item: AdminMenuItem) => {
    const draft = drafts[item.id];
    // MoneyInput ya entrega centavos (parseMoneyInput) — el server SIEMPRE
    // recibe el precio en centavos enteros (contrato v11).
    const price = draft?.value;
    if (draft == null || price == null || Number.isNaN(price) || price < 0) {
      setDrafts(prev => ({ ...prev, [item.id]: { value: 0, saving: false, saved: 'err' } }));
      onToast('error', 'Precio inválido');
      return;
    }

    setDrafts(prev => ({ ...prev, [item.id]: { value: price, saving: true, saved: null } }));
    const result = await updateMenuItemPrice(token, item.id, price);
    if (result.ok) {
      setItems(prev => prev.map(i => (i.id === item.id ? { ...i, price } : i)));
      setDrafts(prev => ({ ...prev, [item.id]: { value: price, saving: false, saved: 'ok' } }));
      onToast('success', `${item.name}: ${formatMoney(price)}`);
    } else {
      setDrafts(prev => ({ ...prev, [item.id]: { value: price, saving: false, saved: 'err' } }));
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
        <FormField
          type="search"
          variant="constrained" className="form-input--mono admin-toolbar__search"
          placeholder="Buscar por nombre…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          aria-label="Buscar item"
        />
        <select
          className="form-input--mono"
          value={categoryId}
          onChange={e => setCategoryId(e.target.value)}
          aria-label="Filtrar por categoría"
        >
          <option value="">Todas las categorías</option>
          {categories.map(c => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        <Button variant="secondary" size="sm" onClick={load} loading={loading}>
          <AppIcon name="refresh" size="sm" /> Refrescar
        </Button>
        <Badge variant={nullCount > 0 ? 'pending' : 'paid'}>
          {nullCount} sin precio base
        </Badge>
      </div>

      {allNull && (
        <Card className="admin-section">
          <p className="admin-muted">
            Todos los items están SIN PRECIO. Usa <strong>Carga Masiva</strong> para
            setear precios reales en un solo paso.
          </p>
        </Card>
      )}

      <Card className="admin-section">
        {loading ? (
          <Loader label="Cargando menú…" />
        ) : filtered.length === 0 ? (
          <p className="admin-muted">Sin resultados.</p>
        ) : (
          <div className="admin-price-list">
            {filtered.map(item => {
              const draft = drafts[item.id];
              return (
                <div key={item.id} className="admin-price-row">
                  <div className="admin-price-row__info">
                    <span className="admin-price-row__name">{item.name}</span>
                    <span className="admin-price-row__cat">{item.category_name}</span>
                    {item.price == null && <Badge variant="pending">{priceLabel(item)}</Badge>}
                  </div>
                  <div className="admin-price-row__edit">
                    <div className="admin-price-input">
                      <span className="admin-price-input__prefix">Bs</span>
                      <MoneyInput
                        variant="sm" className="form-input--mono"
                        value={draft?.value ?? item.price ?? 0}
                        placeholder="—"
                        onChange={cents => handleDraftChange(item.id, cents)}
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
                      {draft?.saved === 'ok' ? <AppIcon name="check" size="sm" /> : draft?.saved === 'err' ? <AppIcon name="x" size="sm" /> : 'Guardar'}
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
