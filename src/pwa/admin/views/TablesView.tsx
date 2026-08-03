/**
 * ADMIN — TablesView
 *
 * Gestión de mesas:
 *   - Lista las 10 mesas con estado + capacidad
 *   - Agregar mesa (número + capacidad)
 *   - Eliminar mesa (solo sin pedidos activos)
 */

import React, { useState, useCallback, useEffect } from 'react';
import { Card } from '@/ui/components/Card';
import { Badge } from '@/ui/components/Badge';
import { Button } from '@/ui/components/Button';
import { QRDisplay } from '@/ui/components/QRDisplay';
import { securityEngine } from '@/core/config';
import { fetchTables, createTable, deleteTable, type Table } from '../../_shared/api/tablesApi';

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

  /** Genera el QR URL para una mesa (sesión de 3h, se renueva con pedido) */
  const getQrUrl = useCallback((tableNumber: number): string => {
    return securityEngine.generateQrUrl(tableNumber);
  }, []);

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
              <input
                type="number"
                min="1"
                max="50"
                className="admin-input admin-input--sm"
                value={newNumber}
                onChange={e => setNewNumber(e.target.value)}
                aria-label="Número de mesa"
              />
            </div>
            <div className="admin-tables__field">
              <label>Capacidad</label>
              <input
                type="number"
                min="1"
                max="20"
                className="admin-input admin-input--sm"
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
          <p className="admin-muted">Cargando mesas…</p>
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
                  onClick={() => setQrTable(t)}
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
              Sesión válida por 3 horas (se renueva con pedido activo).
            </p>
            <div className="admin-qr-modal__qr">
              <QRDisplay
                data={getQrUrl(qrTable.number)}
                size={220}
                label={`Mesa ${qrTable.number} — Rey de la Chelada`}
              />
            </div>
            <div className="admin-qr-modal__url admin-muted">
              {getQrUrl(qrTable.number)}
            </div>
            <Button variant="primary" onClick={() => window.print()}>
              🖨 Imprimir QR
            </Button>
          </Card>
        </div>
      )}
    </div>
  );
}
