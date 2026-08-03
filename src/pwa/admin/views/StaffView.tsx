/**
 * ADMIN — StaffView
 *
 * Gestión de personal (3 roles fijos: admin, mesero, kds):
 *   - Muestra rol + display name + shift
 *   - Cambio de PIN por rol (PUT /api/staff/:id)
 *   - Cambio de nombre visible
 *   - Nota: PINs se guardan hasheados — no se pueden mostrar
 */

import React, { useState, useCallback, useEffect } from 'react';
import { Card } from '@/ui/components/Card';
import { Badge } from '@/ui/components/Badge';
import { Button } from '@/ui/components/Button';
import { fetchStaff, updateStaff, type AdminStaff } from '../../_shared/api/adminApi';

interface StaffViewProps {
  token: string;
  onToast: (type: 'success' | 'error' | 'warning', message: string) => void;
}

const ROLE_LABEL: Record<string, string> = {
  admin: 'Administrador',
  mesero: 'Mesero',
  kds: 'KDS (Cocina/Barra)',
};

const ROLE_BADGE: Record<string, 'preparing' | 'info' | 'pending'> = {
  admin: 'preparing',
  mesero: 'info',
  kds: 'pending',
};

interface PinDraft {
  pin: string;
  saving: boolean;
}

export function StaffView({ token, onToast }: StaffViewProps) {
  const [staff, setStaff] = useState<AdminStaff[]>([]);
  const [loading, setLoading] = useState(true);
  const [pins, setPins] = useState<Record<string, PinDraft>>({});
  const [names, setNames] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await fetchStaff(token);
      setStaff(result.staff);
      setNames(prev => {
        const next = { ...prev };
        for (const s of result.staff) {
          if (next[s.id] === undefined) next[s.id] = s.display_name;
        }
        return next;
      });
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const handlePinChange = useCallback((id: string, pin: string) => {
    setPins(prev => ({ ...prev, [id]: { pin, saving: false } }));
  }, []);

  const handleNameChange = useCallback((id: string, displayName: string) => {
    setNames(prev => ({ ...prev, [id]: displayName }));
  }, []);

  const handleSavePin = useCallback(async (member: AdminStaff) => {
    const draft = pins[member.id];
    if (!draft || draft.pin.length < 4 || draft.pin.length > 6) {
      onToast('error', 'PIN debe tener 4-6 dígitos');
      return;
    }
    setPins(prev => ({ ...prev, [member.id]: { ...prev[member.id], saving: true } }));
    const result = await updateStaff(token, member.id, { pin: draft.pin });
    if (result.ok) {
      onToast('success', `PIN de ${ROLE_LABEL[member.role]} actualizado`);
      setPins(prev => {
        const next = { ...prev };
        delete next[member.id];
        return next;
      });
    } else {
      onToast('error', 'Error al actualizar PIN');
      setPins(prev => ({ ...prev, [member.id]: { ...prev[member.id], saving: false } }));
    }
  }, [token, pins, onToast]);

  const handleSaveName = useCallback(async (member: AdminStaff) => {
    const name = names[member.id];
    if (!name || name.trim() === '' || name === member.display_name) return;
    const result = await updateStaff(token, member.id, { display_name: name.trim() });
    if (result.ok) {
      setStaff(prev => prev.map(s => (s.id === member.id ? { ...s, display_name: name.trim() } : s)));
      onToast('success', 'Nombre actualizado');
    } else {
      onToast('error', 'Error al actualizar nombre');
    }
  }, [token, names, onToast]);

  return (
    <div className="admin-view">
      <Card className="admin-section">
        <p className="admin-muted">
          3 roles fijos (admin / mesero / kds). El PIN es compartido por rol y se guarda
          <strong> hasheado</strong> — no se puede mostrar, solo se puede reemplazar.
        </p>
      </Card>

      {loading ? (
        <Card className="admin-section"><p className="admin-muted">Cargando personal…</p></Card>
      ) : (
        staff.map(member => {
          const pinDraft = pins[member.id];
          return (
            <Card key={member.id} className="admin-section">
              <div className="admin-staff-row">
                <div className="admin-staff-row__info">
                  <Badge variant={ROLE_BADGE[member.role]}>
                    {ROLE_LABEL[member.role] ?? member.role}
                  </Badge>
                  <span className="admin-staff-row__name">{member.display_name}</span>
                  <Badge variant={member.is_active ? 'paid' : 'cancelled'}>
                    {member.is_active ? 'Activo' : 'Inactivo'}
                  </Badge>
                  {member.current_shift && <Badge variant="info">{member.current_shift}</Badge>}
                </div>

                <div className="admin-staff-row__actions">
                  <div className="admin-staff-field">
                    <label>Nombre visible</label>
                    <div className="admin-staff-inline">
                      <input
                        className="admin-input admin-input--sm"
                        value={names[member.id] ?? member.display_name}
                        onChange={e => handleNameChange(member.id, e.target.value)}
                        aria-label={`Nombre de ${ROLE_LABEL[member.role]}`}
                      />
                      <Button variant="ghost" size="sm" onClick={() => handleSaveName(member)}>OK</Button>
                    </div>
                  </div>

                  <div className="admin-staff-field">
                    <label>Nuevo PIN (4-6 dígitos)</label>
                    <div className="admin-staff-inline">
                      <input
                        type="password"
                        inputMode="numeric"
                        maxLength={6}
                        className="admin-input admin-input--sm"
                        value={pinDraft?.pin ?? ''}
                        placeholder="••••"
                        onChange={e => handlePinChange(member.id, e.target.value)}
                        aria-label={`Nuevo PIN de ${ROLE_LABEL[member.role]}`}
                      />
                      <Button
                        variant="secondary"
                        size="sm"
                        loading={pinDraft?.saving}
                        disabled={!pinDraft || pinDraft.pin.length < 4}
                        onClick={() => handleSavePin(member)}
                      >
                        Cambiar PIN
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            </Card>
          );
        })
      )}
    </div>
  );
}
