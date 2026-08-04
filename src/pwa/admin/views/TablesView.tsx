/**
 * ADMIN — TablesView
 *
 * Gestión de mesas:
 *   - Lista las 10 mesas con estado + capacidad
 *   - Agregar mesa (número + capacidad)
 *   - Eliminar mesa (solo sin pedidos activos)
 *   - QR server-side por mesa (sesión en SQLite, URL con host real)
 */

import React, { useState, useCallback, useEffect } from 'react';
import { Card } from '@/ui/components/Card';
import { Badge } from '@/ui/components/Badge';
import { Button } from '@/ui/components/Button';
import { Loader } from '@/ui/components/Loader';
import { EmptyState } from '@/ui/components/EmptyState';
import { FormField } from '@/ui/components/FormField';
import { QRDisplay } from '@/ui/components/QRDisplay';
import { fetchTables, createTable, deleteTable, type Table } from '../../_shared/api/tablesApi';
import { getStaticTableQrUrl } from '../../_shared/api/clientSessionsApi';

interface TablesViewProps {
  token: string;
  onToast: (type: 'success' | 'error' | 'warning', message: string) => void;
}

const STATUS_BADGE: Record<string, 'ready' | 'pending' | 'cancelled' | 'preparing' | 'paid'> = {
  free: 'ready',
  occupied: 'pending',
  ordered: 'preparing',
  serving: 'preparing',
  payment: 'cancelled',
  closed: 'paid',
};

const STATUS_LABEL: Record<string, string> = {
  free: 'Libre',
  occupied: 'Ocupada',
  ordered: 'En pedido',
  serving: 'Sirviendo',
  payment: 'En pago',
  closed: 'Cerrada',
};

export function TablesView({ token, onToast }: TablesViewProps) {
  const [tables, setTables] = useState<Table[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [newNumber, setNewNumber] = useState('');
  const [newCapacity, setNewCapacity] = useState('4');
  const [creating, setCreating] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [qrTable, setQrTable] = useState<Table | null>(null);
  const [qrUrl, setQrUrl] = useState('');
  const [qrLoading, setQrLoading] = useState(false);

  /** Abre el modal QR con la URL ESTÁTICA (sin sid) para la mesa */
  const openQr = useCallback(async (table: Table) => {
    setQrTable(table);
    setQrUrl('');
    setQrLoading(true);
    // Opción A: URL estática estable → el QR es único e imprimible una vez.
    // La sesión se crea lazy en el servidor cuando el cliente abre la URL.
    const result = await getStaticTableQrUrl(token, table.number);
    setQrLoading(false);
    if (result.ok && result.url) {
      setQrUrl(result.url);
    } else {
      onToast('error', result.error ?? 'Error al generar QR');
    }
  }, [token, onToast]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await fetchTables(token);
      setTables(result.tables);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const handleCreate = useCallback(async () => {
    const number = parseInt(newNumber, 10);
    const capacity = parseInt(newCapacity, 10);
    if (Number.isNaN(number) || number < 1 || number > 50) {
      onToast('error', 'Número de mesa inválido (1-50)');
      return;
    }
    if (Number.isNaN(capacity) || capacity < 1) {
      onToast('error', 'Capacidad inválida');
      return;
    }

    setCreating(true);
    const result = await createTable(token, { number, capacity });
    setCreating(false);
    if (result.ok && result.table) {
      setTables(prev => [...prev, result.table!].sort((a, b) => a.number - b.number));
      setShowAdd(false);
      setNewNumber('');
      onToast('success', `Mesa ${number} creada`);
    } else {
      onToast('error', result.error ?? 'Error al crear mesa');
    }
  }, [token, newNumber, newCapacity, onToast]);

  const handleDelete = useCallback(async (table: Table) => {
    if (!window.confirm(`¿Eliminar Mesa ${table.number}? No se puede si tiene pedidos activos.`)) return;
    setDeletingId(table.id);
    const result = await deleteTable(token, table.id);
    setDeletingId(null);
    if (result.ok) {
      setTables(prev => prev.filter(t => t.id !== table.id));
      onToast('success', `Mesa ${table.number} eliminada`);
    } else {
      onToast('error', result.error ?? 'Error al eliminar mesa');
    }
  }, [token, onToast]);

  const freeCount = tables.filter(t => t.status === 'free').length;

  return (
    <div className="admin-view">
      <div className="admin-toolbar">
        <Badge variant="info">{tables.length} mesas · {freeCount} libres</Badge>
        <Button variant="primary" size="sm" onClick={() => setShowAdd(s => !s)}>
          {showAdd ? '✕ Cerrar' : '+ Agregar mesa'}
        </Button>
        <Button variant="secondary" size="sm" onClick={load} loading={loading}>↻ Refrescar</Button>
      </div>

      {showAdd && (
        <Card className="admin-section">
          <h3>Nueva mesa</h3>
          <div className="admin-tables__config">
            <div className="admin-tables__field">
              <label>Número</label>
              <FormField
                type="number"
                min="1"
                max="50"
                variant="sm" className="form-input--mono"
                value={newNumber}
                onChange={e => setNewNumber(e.target.value)}
                aria-label="Número de mesa"
              />
            </div>
            <div className="admin-tables__field">
              <label>Capacidad</label>
              <FormField
                type="number"
                min="1"
                max="20"
                variant="sm" className="form-input--mono"
                value={newCapacity}
                onChange={e => setNewCapacity(e.target.value)}
                aria-label="Capacidad de mesa"
              />
            </div>
            <Button variant="primary" onClick={handleCreate} loading={creating}>Crear mesa</Button>
          </div>
        </Card>
      )}

      <Card className="admin-section">
        {loading ? (
          <Loader label="Cargando mesas…" />
        ) : tables.length === 0 ? (
          <EmptyState compact icon="🪑" message="No hay mesas configuradas todavía" />
        ) : (
          <div className="admin-tables__list">
            {tables.map(t => (
              <div key={t.id} className="admin-tables__item">
                <span className="admin-tables__number">Mesa {t.number}</span>
                <Badge variant={STATUS_BADGE[t.status] ?? 'info'}>
                  {STATUS_LABEL[t.status] ?? t.status}
                </Badge>
                <span className="admin-tables__capacity">{t.capacity} pers. · {t.section}</span>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => openQr(t)}
                  title="Ver/imprimir QR del menú de esta mesa"
                >
                  QR
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  loading={deletingId === t.id}
                  onClick={() => handleDelete(t)}
                  disabled={t.status !== 'free'}
                  title={t.status !== 'free' ? 'Solo se eliminan mesas libres' : 'Eliminar mesa'}
                >
                  🗑
                </Button>
              </div>
            ))}
          </div>
        )}
      </Card>

      {qrTable && (
        <div className="admin-modal-overlay" onClick={() => setQrTable(null)}>
          <Card className="admin-qr-modal" onClick={e => e.stopPropagation()}>
            <div className="admin-qr-modal__head">
              <h3>QR — Mesa {qrTable.number}</h3>
              <Button variant="ghost" size="sm" onClick={() => setQrTable(null)}>✕</Button>
            </div>
            <p className="admin-muted">
              El cliente escanea este código para abrir el menú digital de la mesa.
              <br />
              QR ESTÁTICO — esta URL es estable y se imprime una sola vez
              (la sesión se crea automáticamente al escanear).
            </p>
            <div className="admin-qr-modal__qr">
              {qrLoading ? (
                <Loader label="Generando QR…" />
              ) : qrUrl ? (
                <QRDisplay
                  data={qrUrl}
                  size={220}
                  label={`Mesa ${qrTable.number} — Rey de la Chelada`}
                />
              ) : (
                <p className="admin-muted">Error al generar el QR. Intenta de nuevo.</p>
              )}
            </div>
            <div className="admin-qr-modal__url admin-muted">
              {qrUrl}
            </div>
            <Button variant="primary" onClick={() => window.print()} disabled={!qrUrl}>
              🖨 Imprimir QR
            </Button>
          </Card>
        </div>
      )}
    </div>
  );
}
