/**
 * ADMIN — PromosView (v16 2026-09-01): panel de promos data-driven.
 *
 * Crea/edita/activa/desactiva promos. Modelo: set de líneas
 * (items del menú o grupos + extras) + MODO de precio:
 *   - PRECIO FIJO (FIXED)  → el armador pone el precio TOTAL del pack.
 *   - MENÚ + AJUSTE (MENU_PLUS) → el armador pone un ajuste; el precio =
 *     item.menu_price + ajuste (grupo+extra) con 1ª unidad pagada y resto
 *     gratis si la línea tiene cantidad > 1 (2x1/BOGO).
 * Cada línea puede llevar UN extra (precio 0 = gratis).
 */

import React, { useState, useCallback, useEffect } from 'react';
import { Card } from '@/ui/components/Card';
import { Badge } from '@/ui/components/Badge';
import { Button } from '@/ui/components/Button';
import { Loader } from '@/ui/components/Loader';
import { FormField } from '@/ui/components/FormField';
import { MoneyInput } from '@/ui/components/MoneyInput/MoneyInput';
import { AppIcon } from '@/ui/components/AppIcon/AppIcon';
import { formatMoney } from '../../_shared/utils/format';
import { fetchAdminMenuItems } from '../../_shared/api/adminApi';
import { fetchMenuCategories } from '../../_shared/api/menuApi';
import { fetchCategoryExtras } from '../../_shared/api/promosApi';
import {
  fetchAdminPromos, createAdminPromo, updateAdminPromo, toggleAdminPromo, deleteAdminPromo,
  type Promo, type PromoLine,
} from '../../_shared/api/promosApi';

interface PromosViewProps {
  token: string;
  onToast: (type: 'success' | 'error' | 'warning', message: string) => void;
}

interface MenuEntry { id: string; name: string; category_name?: string; }
interface ExtraOption { id: string; name: string; price: number; }

interface DraftLine extends PromoLine { key: number; _label: string; }

type PriceMode = 'FIXED' | 'MENU_PLUS';

export function PromosView({ token, onToast }: PromosViewProps) {
  const [promos, setPromos] = useState<Promo[]>([]);
  const [items, setItems] = useState<MenuEntry[]>([]);
  const [categories, setCategories] = useState<MenuEntry[]>([]);
  const [extrasByCat, setExtrasByCat] = useState<Record<string, ExtraOption[]>>({});
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Promo | null>(null);
  const [saving, setSaving] = useState(false);

  // Draft del formulario
  const [name, setName] = useState('');
  const [priceMode, setPriceMode] = useState<PriceMode>('FIXED');
  const [priceValue, setPriceValue] = useState(0);
  const [lines, setLines] = useState<DraftLine[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [p, its] = await Promise.all([fetchAdminPromos(token), fetchAdminMenuItems(token)]);
      if (p.ok) setPromos(p.data?.promos ?? []);
      if (its.ok) {
        const entries: MenuEntry[] = (its.data?.items ?? []).map((i: { id: string; name: string; category_name?: string }) => ({
          id: i.id, name: i.name, category_name: i.category_name,
        }));
        setItems(entries);
      }
      // Categorías REALES (id UUID de menu_categories) para el armador de grupos.
      const catsRes = await fetchMenuCategories();
      if (catsRes.ok) {
        const realCats: MenuEntry[] = (catsRes.categories ?? []).map(c => ({ id: c.id, name: c.name }));
        setCategories(realCats);
      }
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  // Cargar extras del grupo bajo demanda (para el select de extra por línea).
  const loadExtras = useCallback(async (categoryId: string) => {
    if (extrasByCat[categoryId]) return;
    const r = await fetchCategoryExtras(token, categoryId);
    if (r.ok) {
      const list: ExtraOption[] = (r.data?.extras ?? []).map(e => ({ id: e.id, name: e.name, price: e.price }));
      setExtrasByCat(prev => ({ ...prev, [categoryId]: list }));
    }
  }, [token, extrasByCat]);

  const resetDraft = useCallback(() => {
    setName(''); setPriceMode('FIXED'); setPriceValue(0); setLines([]);
  }, []);

  const startEdit = useCallback((promo: Promo) => {
    setEditing(promo);
    setName(promo.name);
    setPriceMode(promo.price_mode === 'MENU_PLUS' ? 'MENU_PLUS' : 'FIXED');
    setPriceValue(promo.price_value ?? promo.price_total ?? 0);
    setLines((promo.lines || []).map((l, i) => ({
      ...l,
      key: i,
      _label: l.item_id ? (items.find(x => x.id === l.item_id)?.name || 'Item') : ((categories.find(c => c.id === l.group_id)?.name) || 'Grupo'),
    })));
  }, [items, categories]);

  const addLine = useCallback((kind: 'item' | 'group', id: string, label: string) => {
    if (kind === 'group') void loadExtras(id);
    setLines(prev => [...prev, {
      key: Date.now() + Math.random(),
      ...(kind === 'item' ? { item_id: id } : { group_id: id }),
      quantity: 1,
      extra_id: null,
      extra_price: null,
      _label: label,
    }]);
  }, [loadExtras]);

  const removeLine = useCallback((key: number) => {
    setLines(prev => prev.filter(l => l.key !== key));
  }, []);

  // v16: extra por línea — al cambiar el grupo también se resetea el extra.
  const setLineExtra = useCallback((key: number, extraId: string, extraPrice: number) => {
    setLines(prev => prev.map(l => l.key === key
      ? { ...l, extra_id: extraId || null, extra_price: extraId ? extraPrice : null }
      : l));
  }, []);

  const updateLineQuantity = useCallback((key: number, quantity: number) => {
    setLines(prev => prev.map(l => l.key === key ? { ...l, quantity } : l));
  }, []);

  const handleSave = useCallback(async () => {
    if (!name.trim()) { onToast('warning', 'Pon un nombre a la promo'); return; }
    if (lines.length === 0) { onToast('warning', 'Agrega al menos un item/grupo a la promo'); return; }
    if (priceValue <= 0 && priceMode === 'FIXED') { onToast('warning', 'Pon el precio (total) de la promo'); return; }
    setSaving(true);
    try {
      const data = {
        name: name.trim(),
        label: name.trim(),
        price_mode: priceMode,
        price_value: priceValue,
        schedule: [],
        lines: lines.map(({ item_id, group_id, quantity, extra_id, extra_price }) => ({
          item_id, group_id, quantity, extra_id, extra_price,
        })),
      };
      const result = editing
        ? await updateAdminPromo(token, editing.id, data)
        : await createAdminPromo(token, data);
      if (result.ok) {
        onToast('success', editing ? 'Promo actualizada' : 'Promo creada');
        resetDraft(); setEditing(null); load();
      } else {
        onToast('error', result.error || 'Error al guardar');
      }
    } finally {
      setSaving(false);
    }
  }, [name, lines, priceMode, priceValue, editing, token, onToast, resetDraft, load]);

  const handleToggle = useCallback(async (promo: Promo) => {
    const r = await toggleAdminPromo(token, promo.id, promo.active !== 1);
    if (r.ok) load();
    else onToast('error', r.error || 'Error');
  }, [token, load, onToast]);

  const handleDelete = useCallback(async (promo: Promo) => {
    if (!window.confirm(`¿Eliminar la promo "${promo.name}"?`)) return;
    const r = await deleteAdminPromo(token, promo.id);
    if (r.ok) load();
    else onToast('error', r.error || 'Error');
  }, [token, load, onToast]);

  return (
    <div className="admin-view">
      {loading ? <Loader block label="Cargando promos…" /> : (        <>
          {/* Lista de promos */}
          <Card className="admin-section">
            <div className="admin-section__head">
              <h3>Promos ({promos.length})</h3>
              <Button variant="secondary" size="sm" onClick={() => { resetDraft(); setEditing(null); }} disabled={!!editing}>
                <AppIcon name="plus" size="sm" /> Nueva
              </Button>
            </div>
            {promos.length === 0 ? <p className="admin-muted">Sin promos creadas todavía.</p> : (
              <div className="admin-promos-list">
                {promos.map(promo => (
                  <div key={promo.id} className="admin-promo-row">
                    <div className="admin-promo-row__info">
                      <strong>{promo.label}</strong>
                      <span className="admin-muted">
                        {promo.price_mode === 'MENU_PLUS'
                          ? (promo.price_value ? `Menú + ${formatMoney(promo.price_value)}` : 'Precio del menú')
                          : formatMoney(promo.price_value ?? promo.price_total ?? 0)}
                        {' '}· {promo.lines.length} línea(s)
                      </span>
                    </div>
                    <Badge variant={promo.active === 1 ? 'paid' : 'pending'}>{promo.active === 1 ? 'Activa' : 'Inactiva'}</Badge>
                    <div className="admin-promo-row__actions">
                      <Button variant="secondary" size="sm" onClick={() => startEdit(promo)}><AppIcon name="edit" size="sm" /></Button>
                      <label className="admin-switch" title={promo.active === 1 ? 'Desactivar' : 'Activar'}>
                        <input type="checkbox" checked={promo.active === 1} onChange={() => handleToggle(promo)} />
                        <span className="admin-switch__slider" />
                      </label>
                      <Button variant="secondary" size="sm" onClick={() => handleDelete(promo)}><AppIcon name="trash" size="sm" /></Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* Formulario crear/editar */}
          <Card className="admin-section">
            <div className="admin-section__head"><h3>{editing ? 'Editar promo' : 'Nueva promo'}</h3><Badge variant="info">set de items + modo A/B</Badge></div>
            <div className="admin-promo-form">
              <FormField label="Nombre de la promo" value={name} onChange={e => setName(e.target.value)} placeholder="Ej: 2x1 Quesadillas" />

              {/* v16: ¿cómo se cobra la promo? */}
              <label className="form-field">
                <span className="form-field__label">¿Cómo se cobra?</span>
                <select
                  className="form-input"
                  value={priceMode}
                  onChange={e => setPriceMode(e.target.value as PriceMode)}
                >
                  <option value="FIXED">Precio FIJO (total de la promo)</option>
                  <option value="MENU_PLUS">Menú + ajuste (precio del item + extra)</option>
                </select>
              </label>
              <label className="form-field">
                <span className="form-field__label">
                  {priceMode === 'FIXED' ? 'Precio total de la promo (Bs)' : 'Ajuste sobre el precio del menú (Bs)'}
                </span>
                <MoneyInput value={priceValue} onChange={setPriceValue} variant="lg" placeholder="0,00" />
              </label>
              {priceMode === 'MENU_PLUS' && (
                <p className="admin-muted" style={{ fontSize: 12 }}>
                  💡 Con una línea de cantidad &gt; 1, la 1ª unidad paga y el resto va GRATIS (2x1).
                </p>
              )}

              {/* Armador de líneas */}
              <div className="admin-promo-lines">
                <span className="form-field__label">Items / Grupos de la promo</span>
                {lines.map(line => {
                  const catExtras = line.group_id ? (extrasByCat[line.group_id] || []) : [];
                  return (
                    <div key={line.key} className="admin-promo-line">
                      <span>{line._label} ×
                        <input
                          type="number"
                          min={1}
                          value={line.quantity || 1}
                          style={{ width: 48, marginInline: 4 }}
                          onChange={e => updateLineQuantity(line.key, Math.max(1, Number(e.target.value) || 1))}
                          aria-label="Cantidad"
                        />
                      </span>
                      {/* v16: extra opcional de la línea */}
                      {line.group_id && (
                        <select
                          defaultValue=""
                          onChange={e => {
                            const ex = catExtras.find(x => x.id === e.target.value);
                            setLineExtra(line.key, ex ? ex.id : '', ex ? ex.price : 0);
                            e.target.value = '';
                          }}
                          title="Agregar extra (0 = gratis)"
                        >
                          <option value="">+ Extra…</option>
                          {catExtras.map(ex => (
                            <option key={ex.id} value={ex.id}>{ex.name} ({ex.price ? formatMoney(ex.price) : 'gratis'})</option>
                          ))}
                        </select>
                      )}
                      {line.extra_id && (
                        <span className="admin-muted" style={{ fontSize: 12 }}>
                          → {catExtras.find(x => x.id === line.extra_id)?.name || 'Extra'} (+{formatMoney(line.extra_price ?? 0)})
                          <button type="button" onClick={() => setLineExtra(line.key, '', 0)} aria-label="Quitar extra"><AppIcon name="x" size="sm" /></button>
                        </span>
                      )}
                      <button type="button" onClick={() => removeLine(line.key)} aria-label="Quitar línea"><AppIcon name="x" size="sm" /></button>
                    </div>
                  );
                })}
                <div className="admin-promo-picker">
                  <select defaultValue="" onChange={e => {
                    const v = e.target.value;
                    if (v) { const it = items.find(x => x.id === v); if (it) addLine('item', v, it.name); e.target.value = ''; }
                  }}>
                    <option value="">+ Agregar item…</option>
                    {items.map(i => <option key={i.id} value={i.id}>{i.name} ({i.category_name || '—'})</option>)}
                  </select>
                  <select defaultValue="" onChange={e => {
                    const v = e.target.value;
                    if (v) { addLine('group', v, v); e.target.value = ''; }
                  }}>
                    <option value="">+ Agregar grupo…</option>
                    {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
              </div>

              <p className="admin-muted" style={{ fontSize: 13 }}>
                💡 Actívala/desactívala con el toggle en la lista, según el día que la necesites.
              </p>

              <div className="admin-promo-actions">
                <Button variant="secondary" onClick={() => { resetDraft(); setEditing(null); }} disabled={saving}>Cancelar</Button>
                <Button variant="primary" onClick={handleSave} loading={saving} disabled={saving}>
                  {editing ? 'Guardar cambios' : 'Crear promo'}
                </Button>
              </div>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}

export default PromosView;
