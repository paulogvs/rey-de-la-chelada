/**
 * ADMIN — PromosView (v15 2026-08-29): panel de promos data-driven.
 *
 * Crea/edita/activa/desactiva promos. Modelo: set de líneas
 * (items del menú o grupos + extras) + precio total puesto por Admin.
 * Programador de días: día de la semana y/o rango de fechas.
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
import {
  fetchAdminPromos, createAdminPromo, updateAdminPromo, toggleAdminPromo, deleteAdminPromo,
  type Promo, type PromoLine, type PromoSchedule,
} from '../../_shared/api/promosApi';

interface PromosViewProps {
  token: string;
  onToast: (type: 'success' | 'error' | 'warning', message: string) => void;
}

const DOW_LABELS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

interface MenuEntry { id: string; name: string; category_name?: string; }

interface DraftLine extends PromoLine { key: number; _label: string; }

export function PromosView({ token, onToast }: PromosViewProps) {
  const [promos, setPromos] = useState<Promo[]>([]);
  const [items, setItems] = useState<MenuEntry[]>([]);
  const [categories, setCategories] = useState<MenuEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Promo | null>(null);
  const [saving, setSaving] = useState(false);

  // Draft del formulario
  const [name, setName] = useState('');
  const [price, setPrice] = useState(0);
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [dows, setDows] = useState<number[]>([]);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

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
        // categorías únicas para el armador por grupo
        const cats: MenuEntry[] = [];
        const seen = new Set<string>();
        for (const i of entries) {
          const cn = i.category_name || '';
          if (cn && !seen.has(cn)) { seen.add(cn); cats.push({ id: cn, name: cn }); }
        }
        setCategories(cats);
      }
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const resetDraft = useCallback(() => {
    setName(''); setPrice(0); setLines([]); setDows([]); setStartDate(''); setEndDate('');
  }, []);

  const startEdit = useCallback((promo: Promo) => {
    setEditing(promo);
    setName(promo.name);
    setPrice(promo.price_total);
    setLines((promo.lines || []).map((l, i) => ({
      ...l,
      key: i,
      _label: l.item_id ? (items.find(x => x.id === l.item_id)?.name || 'Item') : (l.group_id || 'Grupo'),
    })));
    setDows((promo.schedule || []).filter(s => s.day_of_week != null).map(s => s.day_of_week as number));
    const range = (promo.schedule || []).find(s => s.start_date || s.end_date);
    setStartDate(range?.start_date || '');
    setEndDate(range?.end_date || '');
  }, [items]);

  const addLine = useCallback((kind: 'item' | 'group', id: string, label: string) => {
    setLines(prev => [...prev, {
      key: Date.now() + Math.random(),
      ...(kind === 'item' ? { item_id: id } : { group_id: id }),
      quantity: 1,
      _label: label,
    }]);
  }, []);

  const removeLine = useCallback((key: number) => {
    setLines(prev => prev.filter(l => l.key !== key));
  }, []);

  const toggleDow = useCallback((d: number) => {
    setDows(prev => prev.includes(d) ? prev.filter(x => x !== d) : [...prev, d]);
  }, []);

  const handleSave = useCallback(async () => {
    if (!name.trim()) { onToast('warning', 'Pon un nombre a la promo'); return; }
    if (lines.length === 0) { onToast('warning', 'Agrega al menos un item/grupo a la promo'); return; }
    if (price <= 0) { onToast('warning', 'Pon el precio de la promo'); return; }
    setSaving(true);
    try {
      const schedule: PromoSchedule[] = [
        ...dows.map(d => ({ day_of_week: d })),
        ...(startDate || endDate ? [{ start_date: startDate || null, end_date: endDate || null }] : []),
      ];
      const data = {
        name: name.trim(),
        label: name.trim(),
        price_total: price,
        lines: lines.map(({ item_id, group_id, quantity, extra_id, extra_price }) => ({ item_id, group_id, quantity, extra_id, extra_price })),
        schedule,
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
  }, [name, lines, price, dows, startDate, endDate, editing, token, onToast, resetDraft, load]);

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
      {loading ? <Loader block label="Cargando promos…" /> : (
        <>
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
                      <span className="admin-muted">{promo.price_total > 0 ? formatMoney(promo.price_total) : '—'} · {promo.lines.length} línea(s)</span>
                    </div>
                    <Badge variant={promo.active === 1 ? 'paid' : 'pending'}>{promo.active === 1 ? 'Activa' : 'Inactiva'}</Badge>
                    <div className="admin-promo-row__actions">
                      <Button variant="secondary" size="sm" onClick={() => startEdit(promo)}><AppIcon name="edit" size="sm" /></Button>
                      <Button variant="secondary" size="sm" onClick={() => handleToggle(promo)} title={promo.active === 1 ? 'Desactivar' : 'Activar'}>
                        <AppIcon name="check" size="sm" />
                      </Button>
                      <Button variant="secondary" size="sm" onClick={() => handleDelete(promo)}><AppIcon name="trash" size="sm" /></Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* Formulario crear/editar */}
          <Card className="admin-section">
            <div className="admin-section__head"><h3>{editing ? 'Editar promo' : 'Nueva promo'}</h3><Badge variant="info">set de items + precio</Badge></div>
            <div className="admin-promo-form">
              <FormField label="Nombre de la promo" value={name} onChange={e => setName(e.target.value)} placeholder="Ej: 2x1 Quesadillas" />
              <label className="form-field">
                <span className="form-field__label">Precio de la promo (Bs)</span>
                <MoneyInput value={price} onChange={setPrice} variant="lg" placeholder="0,00" />
              </label>

              {/* Armador de líneas */}
              <div className="admin-promo-lines">
                <span className="form-field__label">Items / Grupos de la promo</span>
                {lines.map(line => (
                  <div key={line.key} className="admin-promo-line">
                    <span>{line._label} × {line.quantity || 1}</span>
                    <button type="button" onClick={() => removeLine(line.key)} aria-label="Quitar línea"><AppIcon name="x" size="sm" /></button>
                  </div>
                ))}
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

              {/* Programador de días */}
              <div className="admin-promo-schedule">
                <span className="form-field__label">Días de la semana</span>
                <div className="admin-promo-dows">
                  {DOW_LABELS.map((d, idx) => (
                    <button key={idx} type="button"
                      className={`admin-promo-dow ${dows.includes(idx) ? 'active' : ''}`}
                      onClick={() => toggleDow(idx)}>{d}</button>
                  ))}
                </div>
                <div className="admin-promo-range">
                  <FormField type="date" variant="sm" label="Desde" value={startDate} onChange={e => setStartDate(e.target.value)} />
                  <FormField type="date" variant="sm" label="Hasta" value={endDate} onChange={e => setEndDate(e.target.value)} />
                </div>
              </div>

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