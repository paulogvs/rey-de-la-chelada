/**
 * ADMIN — ModifierOptionsView
 *
 * Precios de opciones de mods (tamaños de pizza: Mediana/Familiar/XL).
 *   - Lista por item de menú (Hawaiana, La Rey, La Tóxica, Vegetariana)
 *   - Edición inline → PATCH /api/menu/modifier-options/:id/price
 *   - Guardar todo → POST /api/menu/modifier-options/bulk-prices
 */

import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { Card } from '@/ui/components/Card';
import { Badge } from '@/ui/components/Badge';
import { Button } from '@/ui/components/Button';
import { Loader } from '@/ui/components/Loader';
import { FormField } from '@/ui/components/FormField';
import { AppIcon } from '@/ui/components/AppIcon/AppIcon';
import {
  fetchModifierOptions,
  updateModifierOptionPrice,
  bulkUpdateModifierPrices,
  type ModifierOptionRow,
} from '../../_shared/api/adminApi';

interface ModifierOptionsViewProps {
  token: string;
  onToast: (type: 'success' | 'error' | 'warning', message: string) => void;
}

interface FieldState {
  value: string;
  saved: 'ok' | 'err' | null;
}

export function ModifierOptionsView({ token, onToast }: ModifierOptionsViewProps) {
  const [options, setOptions] = useState<ModifierOptionRow[]>([]);
  const [fields, setFields] = useState<Record<string, FieldState>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await fetchModifierOptions(token);
      setOptions(result.options);
      setFields({});
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const groups = useMemo(() => {
    const map = new Map<string, { itemName: string; options: ModifierOptionRow[] }>();
    for (const opt of options) {
      if (!map.has(opt.menu_item_id)) {
        map.set(opt.menu_item_id, { itemName: opt.menu_item_name, options: [] });
      }
      map.get(opt.menu_item_id)!.options.push(opt);
    }
    return Array.from(map.values());
  }, [options]);

  const handleChange = useCallback((id: string, value: string) => {
    setFields(prev => ({ ...prev, [id]: { value, saved: null } }));
  }, []);

  const handleSaveOne = useCallback(async (opt: ModifierOptionRow) => {
    const field = fields[opt.id];
    const priceAdjustment = Number(field?.value);
    if (field == null || Number.isNaN(priceAdjustment) || priceAdjustment < 0) {
      onToast('error', 'Precio inválido');
      return;
    }
    setFields(prev => ({ ...prev, [opt.id]: { value: String(priceAdjustment), saved: null } }));
    const result = await updateModifierOptionPrice(token, opt.id, priceAdjustment);
    if (result.ok) {
      setOptions(prev => prev.map(o => (o.id === opt.id ? { ...o, price_adjustment: priceAdjustment } : o)));
      onToast('success', `${opt.menu_item_name} · ${opt.name}: +Bs. ${priceAdjustment.toFixed(2)}`);
    } else {
      onToast('error', `Error al guardar ${opt.name}`);
    }
    setTimeout(() => {
      setFields(prev => { const n = { ...prev }; delete n[opt.id]; return n; });
    }, 2000);
  }, [token, fields, onToast]);

  const handleSaveAll = useCallback(async () => {
    const updates = options
      .filter(o => fields[o.id]?.value !== '')
      .map(o => ({ id: o.id, priceAdjustment: Number(fields[o.id].value) }))
      .filter(u => !Number.isNaN(u.priceAdjustment) && u.priceAdjustment >= 0);

    if (updates.length === 0) {
      onToast('warning', 'Escribe al menos un precio para guardar');
      return;
    }

    setSaving(true);
    const result = await bulkUpdateModifierPrices(token, updates);
    setSaving(false);

    if (result.ok) {
      const okIds = new Set(result.errors.map(e => e.id));
      setFields(prev => {
        const next: Record<string, FieldState> = {};
        for (const u of updates) {
          next[u.id] = { value: String(u.priceAdjustment), saved: okIds.has(u.id) ? 'err' : 'ok' };
        }
        return { ...prev, ...next };
      });
      setOptions(prev => prev.map(o => {
        const u = updates.find(x => x.id === o.id);
        return u ? { ...o, price_adjustment: u.priceAdjustment } : o;
      }));
      onToast(
        result.failed > 0 ? 'warning' : 'success',
        `${result.updated} tamaño(s) guardado(s)${result.failed > 0 ? `, ${result.failed} fallaron` : ''}`
      );
    } else {
      onToast('error', 'Error al guardar tamaños');
    }

    setTimeout(() => {
      setFields(prev => {
        const next = { ...prev };
        for (const u of updates) delete next[u.id];
        return next;
      });
    }, 2500);
  }, [options, fields, token, onToast]);

  const filledCount = useMemo(
    () => Object.values(fields).filter(f => f.value !== '').length,
    [fields]
  );

  return (
    <div className="admin-view">
      <Card className="admin-section">
        <p className="admin-muted">
          Precios de <strong>tamaños</strong> (ajuste sobre el precio base del item, BOB).
          Ej: pizza Mediana +0, Familiar +15, XL +25.
        </p>
        <div className="admin-toolbar">
          <Button variant="primary" onClick={handleSaveAll} loading={saving} disabled={filledCount === 0}>
            <AppIcon name="save" size="sm" /> Guardar {filledCount > 0 ? `${filledCount} tamaño(s)` : 'todo'}
          </Button>
          <Button variant="secondary" size="sm" onClick={load} loading={loading}><AppIcon name="refresh" size="sm" /> Refrescar</Button>
          <Badge variant="info">{options.length} opciones</Badge>
        </div>
      </Card>

      {loading ? (
        <Card className="admin-section"><Loader label="Cargando tamaños…" /></Card>
      ) : (
        groups.map(group => (
          <Card key={group.itemName} className="admin-section">
            <h3>{group.itemName}</h3>
            <div className="admin-bulk-grid">
              {group.options.map(opt => {
                const field = fields[opt.id];
                const value = field?.value ?? String(opt.price_adjustment ?? 0);
                return (
                  <div key={opt.id} className="admin-bulk-item">
                    <span className="admin-bulk-item__name">{opt.name}</span>
                    <div className="admin-price-input">
                      <span className="admin-price-input__prefix">+Bs.</span>
                      <FormField
                        type="number"
                        min="0"
                        step="0.5"
                        variant="sm" className="form-input--mono"
                        value={value}
                        onChange={e => handleChange(opt.id, e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') handleSaveOne(opt); }}
                        aria-label={`Precio de ${opt.name} de ${opt.menu_item_name}`}
                      />
                      <Button variant="ghost" size="sm" onClick={() => handleSaveOne(opt)} disabled={!fields[opt.id]}>
                        {field?.saved === 'ok' ? <AppIcon name="check" size="sm" /> : field?.saved === 'err' ? <AppIcon name="x" size="sm" /> : 'OK'}
                      </Button>
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
