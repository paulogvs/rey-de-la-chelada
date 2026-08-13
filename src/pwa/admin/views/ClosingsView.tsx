/**
 * ADMIN — ClosingsView
 *
 * Historial de cortes de caja cerrados (GET /api/payments/closings):
 *   - Fecha, apertura, cierre, esperado vs real, diferencia, conciliado
 *   - Nota: el corte ACTUAL se abre/cierra en la PWA /caja
 */

import React, { useState, useCallback, useEffect } from 'react';
import { Card } from '@/ui/components/Card';
import { Badge } from '@/ui/components/Badge';
import { Button } from '@/ui/components/Button';
import { Loader } from '@/ui/components/Loader';
import { fetchClosings, type ClosingRow } from '../../_shared/api/adminApi';
import { localDateTimeStr } from '../../_shared/utils/localDate';
import { formatMoney } from '../../_shared/utils/format';

interface ClosingsViewProps {
  token: string;
  onToast: (type: 'success' | 'error' | 'warning', message: string) => void;
}

function fmtDateTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 16).replace('T', ' ');
  return localDateTimeStr(d);
}

export function ClosingsView({ token, onToast }: ClosingsViewProps) {
  const [closings, setClosings] = useState<ClosingRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await fetchClosings(token);
      setClosings(result.closings);
    } catch {
      onToast('error', 'Error al cargar historial de cortes');
    } finally {
      setLoading(false);
    }
  }, [token, onToast]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="admin-view">
      <div className="admin-toolbar">
        <Badge variant="info">{closings.length} corte(s) registrado(s)</Badge>
        <Button variant="secondary" size="sm" onClick={load} loading={loading}>↻ Refrescar</Button>
      </div>

      <Card className="admin-section">
        <p className="admin-muted">
          El corte de caja <strong>actual</strong> se abre y cierra en la PWA <strong>/caja</strong>.
          Aquí ves el historial de cierres ya completados.
        </p>
      </Card>

      {loading ? (
        <Card className="admin-section"><Loader label="Cargando cortes…" /></Card>
      ) : closings.length === 0 ? (
        <Card className="admin-section"><p className="admin-muted">Aún no hay cortes cerrados.</p></Card>
      ) : (
        <Card className="admin-section">
          <div className="admin-closings-list">
            {closings.map(c => {
              const diff = c.cash_difference;
              const reconciled = c.is_reconciled === 1;
              return (
                <div key={c.id} className="admin-closing-row">
                  <div className="admin-closing-row__head">
                    <span className="admin-closing-row__date">
                      {fmtDateTime(c.closed_at)}
                    </span>
                    <Badge variant={diff === 0 ? 'paid' : reconciled ? 'info' : 'cancelled'}>
                      {diff === 0 ? 'Cuadrado' : reconciled ? 'Conciliado' : 'Diferencia'}
                    </Badge>
                  </div>
                  <div className="admin-closing-row__nums">
                    <span>Esperado <strong>{formatMoney(Number(c.expected_cash))}</strong></span>
                    <span>Real <strong>{formatMoney(Number(c.actual_cash))}</strong></span>
                    <span className={diff < 0 ? 'admin-closing-row__neg' : 'admin-closing-row__pos'}>
                      Dif. {diff >= 0 ? '+' : ''}{formatMoney(Number(diff))}
                    </span>
                  </div>
                  <div className="admin-closing-row__meta">
                    <span>Abierto: {fmtDateTime(c.opened_at)} {c.opened_by_name ? `por ${c.opened_by_name}` : ''}</span>
                    <span>Cierre: {c.closed_by_name ? `por ${c.closed_by_name}` : ''}</span>
                    {c.notes && <span className="admin-closing-row__notes">"{c.notes}"</span>}
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      )}
    </div>
  );
}
