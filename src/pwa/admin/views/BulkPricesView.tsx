/**
 * ADMIN — BulkPricesView
 *
 * Carga masiva de precios:
 *   - Grid de TODOS los items agrupados por categoría
 *   - Input de precio por item (0.5 step, BOB)
 *   - Botón "Guardar todo" → POST /api/menu/items/bulk-prices
 *   - Feedback por item (ok/error) + resumen updated/failed
 */

import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { Card } from '@/ui/components/Card';
import { Badge } from '@/ui/components/Badge';
import { Button } from '@/ui/components/Button';
import { Loader } from '@/ui/components/Loader';
import { FormField } from '@/ui/components/FormField';
import { AppIcon } from '@/ui/components/AppIcon/AppIcon';
import {
  fetchAdminMenuItems,
  bulkUpdateItemPrices,
  type AdminMenuItem,
} from '../../_shared/api/adminApi';
import { fetchMenuCategories, type MenuCategory } from '../../_shared/api/menuApi';

interface BulkPricesViewProps {
  token: string;
  onToast: (type: 'success' | 'error' | 'warning', message: string) => void;
}

interface FieldState {
  value: string;
  saved: 'ok' | 'err' | null;
}

export function BulkPricesView({ token, onToast }: BulkPricesViewProps) {
  const [items, setItems] = useState<AdminMenuItem[]>([]);
  const [categories, setCategories] = useState<MenuCategory[]>([]);
  const [fields, setFields] = useState<Record<string, FieldState>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [itemsRes, catsRes] = await Promise.all([
        fetchAdminMenuItems(token),
        fetchMenuCategories(),
      ]);
      setItems(itemsRes.items);
      setCategories(catsRes.categories);
      setFields({});
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  // Group items by category (preserving menu category order)
  const groups = useMemo(() => {
    return categories
      .map(cat => ({
        category: cat,
        items: items.filter(i => i.category_id === cat.id),
      }))
      .filter(g => g.items.length > 0);
  }, [items, categories]);

  const handleChange = useCallback((id: string, value: string) => {
    setFields(prev => ({ ...prev, [id]: { value, saved: null } }));
  }, []);

  // Collect only items with a valid numeric value (>= 0)
  const collectUpdates = useCallback((): Array<{ id: string; price: number }> => {
    const updates: Array<{ id: string; price: number }> = [];
    for (const item of items) {
      const field = fields[item.id];
      if (!field || field.value === '') continue;
      const price = Number(field.value);
      if (Number.isNaN(price) || price < 0) continue;
      updates.push({ id: item.id, price });
    }
    return updates;
  }, [items, fields]);

  const handleSaveAll = useCallback(async () => {
    const updates = collectUpdates();
    if (updates.length === 0) {
      onToast('warning', 'Escribe al menos un precio para guardar');
      return;
    }

    setSaving(true);
    const result = await bulkUpdateItemPrices(token, updates);
    setSaving(false);

    if (result.ok) {
      // Mark saved status per updated id
      const okIds = new Set(result.errors.map(e => e.id));
      setFields(prev => {
        const next: Record<string, FieldState> = {};
        for (const u of updates) {
          next[u.id] = { value: String(u.price), saved: okIds.has(u.id) ? 'err' : 'ok' };
        }
        return { ...prev, ...next };
      });
      // Refresh server prices so the UI shows canonical values
      setItems(prev => prev.map(i => {
        const u = updates.find(x => x.id === i.id);
        return u ? { ...i, price: u.price } : i;
      }));
      onToast(
        result.failed > 0 ? 'warning' : 'success',
        `${result.updated} precio(s) guardado(s)${result.failed > 0 ? `, ${result.failed} fallaron` : ''}`
      );
    } else {
      onToast('error', 'Error al guardar precios masivos');
    }

    // Clear saved feedback after 2.5s
    setTimeout(() => {
      setFields(prev => {
        const next = { ...prev };
        for (const u of updates) delete next[u.id];
        return next;
      });
    }, 2500);
  }, [collectUpdates, token, onToast]);

  const filledCount = useMemo(
    () => Object.values(fields).filter(f => f.value !== '').length,
    [fields]
  );

  return (
    <div className="admin-view">
      <Card className="admin-section">
        <p className="admin-muted">
          Escribe los precios (BOB) de los productos. Los que dejes vacíos se mantienen
          igual. {filledCount > 0 && <strong>{filledCount} listo(s) para guardar.</strong>}
        </p>
        <div className="admin-toolbar">
          <Button variant="primary" onClick={handleSaveAll} loading={saving} disabled={filledCount === 0}>
            <AppIcon name="save" size="sm" /> Guardar {filledCount > 0 ? `${filledCount} precio(s)` : 'todo'}
          </Button>
          <Button variant="secondary" size="sm" onClick={load} loading={loading}>
            <AppIcon name="refresh" size="sm" /> Refrescar
          </Button>
        </div>
      </Card>

      {loading ? (
        <Card className="admin-section"><Loader label="Cargando menú…" /></Card>
      ) : (
        groups.map(group => (
          <Card key={group.category.id} className="admin-section">
            <h3>{group.category.name}
              <Badge variant="info">{group.items.length}</Badge>
            </h3>
            <div className="admin-bulk-grid">
              {group.items.map(item => {
                const field = fields[item.id];
                const value = field?.value ?? (item.price != null ? String(item.price) : '');
                return (
                  <div key={item.id} className="admin-bulk-item">
                    <span className="admin-bulk-item__name" title={item.name}>
                      {item.name}
                      {item.price == null && <Badge variant="pending">—</Badge>}
                    </span>
                    <div className="admin-price-input">
                      <span className="admin-price-input__prefix">Bs</span>
                      <FormField
                        type="text"
                        inputMode="decimal"
                        variant="sm" className="form-input--mono"
                        value={value}
                        placeholder="—"
                        onChange={e => handleChange(item.id, e.target.value.replace(',', '.'))}
                        aria-label={`Precio de ${item.name}`}
                      />
                      {field?.saved === 'ok' && <span className="admin-bulk-item__ok"><AppIcon name="check" size="sm" /></span>}
                      {field?.saved === 'err' && <span className="admin-bulk-item__err"><AppIcon name="x" size="sm" /></span>}
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        ))
      )}
    </div>
  );
}
