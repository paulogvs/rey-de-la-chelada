/**
 * ADMIN — ExtrasView (v15 2026-08-29): extras por GRUPO del menú.
 *
 * Cada grupo (ej. Pizzas, Micheladas) tiene sus propios extras, que aplican
 * a todos los items del grupo. El módulo KDS se hereda del grupo
 * (pizzas→cocina, micheladas→bar). El mesero los marca al abrir el item.
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
import { fetchMenuCategories } from '../../_shared/api/menuApi';
import {
  fetchCategoryExtras, createExtra, updateExtra, deleteExtra,
  type Extra,
} from '../../_shared/api/promosApi';

interface ExtrasViewProps {
  token: string;
  onToast: (type: 'success' | 'error' | 'warning', message: string) => void;
}

export function ExtrasView({ token, onToast }: ExtrasViewProps) {
  const [groups, setGroups] = useState<{ id: string; name: string }[]>([]);
  const [activeGroup, setActiveGroup] = useState<string>('');
  const [extras, setExtras] = useState<Extra[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Draft nuevo extra
  const [newName, setNewName] = useState('');
  const [newPrice, setNewPrice] = useState(0);

  const loadGroups = useCallback(async () => {
    const r = await fetchMenuCategories();
    if (r.ok) {
      const g = r.categories.map(c => ({ id: c.id, name: c.name }));
      setGroups(g);
      if (!activeGroup && g.length > 0) setActiveGroup(g[0].id);
    }
  }, [activeGroup]);

  useEffect(() => { loadGroups(); }, [loadGroups]);

  const loadExtras = useCallback(async (groupId: string) => {
    if (!groupId) return;
    const r = await fetchCategoryExtras(token, groupId);
    if (r.ok) setExtras(r.data?.extras ?? []);
  }, [token]);

  useEffect(() => { if (activeGroup) { setLoading(true); loadExtras(activeGroup).finally(() => setLoading(false)); } }, [activeGroup, loadExtras]);

  const handleCreate = useCallback(async () => {
    if (!activeGroup) return;
    if (!newName.trim()) { onToast('warning', 'Pon el nombre del extra'); return; }
    setSaving(true);
    try {
      const r = await createExtra(token, activeGroup, { name: newName.trim(), price: newPrice });
      if (r.ok) {
        onToast('success', 'Extra creado');
        setNewName(''); setNewPrice(0); loadExtras(activeGroup);
      } else onToast('error', r.error || 'Error al crear');
    } finally { setSaving(false); }
  }, [activeGroup, newName, newPrice, token, onToast, loadExtras]);

  const handleToggle = useCallback(async (extra: Extra) => {
    const r = await updateExtra(token, extra.id, { ...extra, active: extra.active === 1 ? 0 : 1 });
    if (r.ok) loadExtras(activeGroup);
    else onToast('error', r.error || 'Error');
  }, [token, activeGroup, loadExtras, onToast]);

  const handleDelete = useCallback(async (extra: Extra) => {
    if (!window.confirm(`¿Eliminar el extra "${extra.name}"?`)) return;
    const r = await deleteExtra(token, extra.id);
    if (r.ok) loadExtras(activeGroup);
    else onToast('error', r.error || 'Error');
  }, [token, activeGroup, loadExtras, onToast]);

  return (
    <div className="admin-view">
      <Card className="admin-section">
        <div className="admin-section__head"><h3>Extras por grupo</h3><Badge variant="info">KDS se hereda del grupo</Badge></div>

        {/* Selector de grupo */}
        <div className="admin-extras-group">
          <label className="form-field">
            <span className="form-field__label">Grupo del menú</span>
            <select className="form-input" value={activeGroup} onChange={e => setActiveGroup(e.target.value)}>
              {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </label>
        </div>

        {loading ? <Loader label="Cargando extras…" /> : (
          <>
            {/* Lista de extras del grupo */}
            {extras.length === 0 ? <p className="admin-muted">Este grupo no tiene extras.</p> : (
              <div className="admin-extras-list">
                {extras.map(extra => (
                  <div key={extra.id} className="admin-promo-row">
                    <div className="admin-promo-row__info">
                      <strong>{extra.name}</strong>
                      <span className="admin-muted">{formatMoney(extra.price)}</span>
                    </div>
                    <Badge variant={extra.active === 1 ? 'paid' : 'pending'}>{extra.active === 1 ? 'Activo' : 'Inactivo'}</Badge>
                    <div className="admin-promo-row__actions">
                      <Button variant="secondary" size="sm" onClick={() => handleToggle(extra)} title={extra.active === 1 ? 'Desactivar' : 'Activar'}>
                        <AppIcon name="check" size="sm" />
                      </Button>
                      <Button variant="secondary" size="sm" onClick={() => handleDelete(extra)}><AppIcon name="trash" size="sm" /></Button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Crear extra */}
            <div className="admin-extras-create">
              <FormField label="Nombre del extra" value={newName} onChange={e => setNewName(e.target.value)} placeholder="Ej: Extra queso" />
              <label className="form-field">
                <span className="form-field__label">Precio (Bs)</span>
                <MoneyInput value={newPrice} onChange={setNewPrice} variant="lg" placeholder="0,00" />
              </label>
              <Button variant="primary" onClick={handleCreate} loading={saving} disabled={saving} style={{ alignSelf: 'flex-end' }}>
                <AppIcon name="plus" size="sm" /> Agregar extra
              </Button>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}

export default ExtrasView;