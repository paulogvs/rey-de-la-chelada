/**
 * ADMIN — SettingsView (v14 2026-08-28)
 *
 * Configuración del restaurante SIN tocar código:
 *   - Datos fiscales: NIT, IVA %, nombre, dirección, teléfono, eslogan
 *   - Impresora térmica: nombre (vacío = predeterminada de Windows),
 *     ancho de papel 58/80mm, y botón "Probar impresión"
 *
 * Fuente: GET/PUT /api/settings + POST /api/print/test
 */

import React, { useState, useCallback, useEffect } from 'react';
import { Card } from '@/ui/components/Card';
import { Badge } from '@/ui/components/Badge';
import { Button } from '@/ui/components/Button';
import { Loader } from '@/ui/components/Loader';
import { FormField } from '@/ui/components/FormField';
import { fetchSettings, saveSettings, printTestTicket } from '../../_shared/api/printApi';

interface SettingsViewProps {
  token: string;
  onToast: (type: 'success' | 'error' | 'warning', message: string) => void;
}

interface FormState {
  nit: string;
  business_name: string;
  address: string;
  phone: string;
  slogan: string;
  iva_rate: string;
  printer_name: string;
  paper_width: '58mm' | '80mm';
}

const EMPTY_FORM: FormState = {
  nit: '',
  business_name: '',
  address: '',
  phone: '',
  slogan: '',
  iva_rate: '13',
  printer_name: '',
  paper_width: '80mm',
};

export function SettingsView({ token, onToast }: SettingsViewProps) {
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await fetchSettings(token);
      if (result.ok && result.settings) {
        setForm(prev => ({
          ...prev,
          ...result.settings!,
          paper_width: result.effective?.paperSize ?? '80mm',
        }));
      }
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const set = useCallback((key: keyof FormState, value: string) => {
    setSaved(false);
    setForm(prev => ({ ...prev, [key]: value }));
  }, []);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      const result = await saveSettings(token, {
        nit: form.nit.trim(),
        business_name: form.business_name.trim(),
        address: form.address.trim(),
        phone: form.phone.trim(),
        slogan: form.slogan.trim(),
        iva_rate: form.iva_rate.trim(),
        printer_name: form.printer_name.trim(),
        paper_width: form.paper_width,
      });
      if (result.ok) {
        setSaved(true);
        onToast('success', 'Configuración guardada');
      } else {
        onToast('error', result.error || 'Error al guardar configuración');
      }
    } finally {
      setSaving(false);
    }
  }, [token, form, onToast]);

  const handleTestPrint = useCallback(async () => {
    setTesting(true);
    try {
      const result = await printTestTicket(token);
      if (result.ok) {
        onToast('success', 'Ticket de prueba enviado a la impresora');
      } else {
        onToast('error', `Impresión falló: ${result.error || 'revisa la impresora en Windows'}`);
      }
    } finally {
      setTesting(false);
    }
  }, [token, onToast]);

  const nitMissing = !form.nit.trim();

  return (
    <div className="admin-view">
      {loading ? (
        <Loader block label="Cargando configuración…" />
      ) : (
        <>
          {nitMissing && (
            <Card className="admin-card">
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <Badge variant="pending">Pendiente</Badge>
                <span>
                  <strong>Completa el NIT del restaurante</strong> — sin NIT, los tickets y el QR de
                  verificación SIN no se imprimen correctamente.
                </span>
              </div>
            </Card>
          )}

          <Card className="admin-card">
            <div className="admin-card__header">
              <h3>Datos fiscales del restaurante</h3>
              <Badge variant="info">Ticket + QR SIN</Badge>
            </div>
            <div className="admin-settings-grid">
              <FormField
                label="NIT (obligatorio)"
                variant="mono"
                value={form.nit}
                onChange={e => set('nit', e.target.value)}
                placeholder="ej. 1029394029"
              />
              <FormField
                label="IVA %"
                variant="sm"
                value={form.iva_rate}
                onChange={e => set('iva_rate', e.target.value)}
                inputMode="decimal"
              />
              <FormField
                label="Nombre del negocio"
                value={form.business_name}
                onChange={e => set('business_name', e.target.value)}
                placeholder="Rey de la Chelada"
              />
              <FormField
                label="Dirección"
                value={form.address}
                onChange={e => set('address', e.target.value)}
                placeholder="Cochabamba, Bolivia"
              />
              <FormField
                label="Teléfono"
                value={form.phone}
                onChange={e => set('phone', e.target.value)}
                placeholder="4 1234567"
              />
              <FormField
                label="Eslogan (opcional)"
                value={form.slogan}
                onChange={e => set('slogan', e.target.value)}
              />
            </div>
          </Card>

          <Card className="admin-card">
            <div className="admin-card__header">
              <h3>Impresora térmica</h3>
              <Badge variant="info">ESC/POS · solo Caja</Badge>
            </div>
            <div className="admin-settings-grid">
              <FormField
                label="Nombre en Windows (vacío = impresora predeterminada)"
                variant="mono"
                value={form.printer_name}
                onChange={e => set('printer_name', e.target.value)}
                placeholder="ej. XP-80C (o déjalo vacío)"
              />
              <label className="form-field">
                <span className="form-field__label">Ancho del papel</span>
                <select
                  className="form-input"
                  value={form.paper_width}
                  onChange={e => set('paper_width', e.target.value as '58mm' | '80mm')}
                >
                  <option value="80mm">80mm (comanda estándar)</option>
                  <option value="58mm">58mm (ticket delgado)</option>
                </select>
              </label>
            </div>
            <div style={{ marginTop: 16, display: 'flex', gap: 12, alignItems: 'center' }}>
              <Button variant="secondary" onClick={handleTestPrint} disabled={testing}>
                {testing ? 'Imprimiendo…' : 'Probar impresión'}
              </Button>
              {saved && <Badge variant="success">Guardado</Badge>}
            </div>
          </Card>

          <div className="admin-settings-actions">
            <Button onClick={handleSave} disabled={saving}>
              {saving ? 'Guardando…' : 'Guardar configuración'}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}