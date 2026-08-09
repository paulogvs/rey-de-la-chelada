/**
 * WaiterCallsBoard — pending client requests (call waiter / request bill)
 *
 * API-driven: lists calls from GET /api/waiter-calls, exposes
 * accept / complete / cancel actions.
 */

import React from 'react';
import { Button } from '@/ui/components/Button';
import { Card } from '@/ui/components/Card';
import { Badge } from '@/ui/components/Badge';
import { EmptyState } from '@/ui/components/EmptyState';
import { Loader } from '@/ui/components/Loader';
import type { WaiterCall } from '../_shared/api/waiterCallsApi';

interface WaiterCallsBoardProps {
  calls: WaiterCall[];
  loading: boolean;
  error: string | null;
  onAccept: (callId: string) => Promise<{ ok: boolean; code: string | null }>;
  onComplete: (callId: string) => Promise<{ ok: boolean; code: string | null }>;
  onCancel: (callId: string) => Promise<{ ok: boolean; code: string | null }>;
  onRefresh: () => void;
}

export function WaiterCallsBoard({
  calls,
  loading,
  error,
  onAccept,
  onComplete,
  onCancel,
  onRefresh,
}: WaiterCallsBoardProps) {
  const pending = calls.filter(c => c.status === 'pending');
  const others = calls.filter(c => c.status !== 'pending');

  return (
    <div className="waiter-calls">
      <div className="waiter-calls__header">
        <h2>Llamadas pendientes ({pending.length})</h2>
        <button className="waiter-calls__refresh" onClick={onRefresh}>⟳</button>
      </div>

      {error && <p className="waiter-calls__error">{error}</p>}
      {loading && pending.length === 0 && <Loader label="Cargando…" />}

      {pending.length === 0 && !loading && (
        <EmptyState compact icon="🔔" message="Sin llamadas pendientes" />
      )}

      {pending.map(call => (
        <Card key={call.id} padded={false} className="waiter-calls__call">
          <div className="waiter-calls__call-info">
            <span className="waiter-calls__call-table">Mesa {call.tableNumber}</span>
            <Badge variant={call.callType === 'request_bill' ? 'warning' : 'info'}>
              {call.callType === 'request_bill' ? 'Pide la cuenta' : 'Llama al mesero'}
            </Badge>
            <span className="waiter-calls__call-time">
              {new Date(call.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
          </div>
          <div className="waiter-calls__call-actions">
            <Button variant="primary" size="md" onClick={() => onAccept(call.id)}>
              Atender
            </Button>
            <Button variant="ghost" size="md" onClick={() => onCancel(call.id)}>
              Cancelar
            </Button>
          </div>
        </Card>
      ))}

      {others.length > 0 && (
        <>
          <h3 className="waiter-calls__section">Atendidas</h3>
          {others.map(call => (
            <Card key={call.id} padded={false} className="waiter-calls__call waiter-calls__call--done">
              <div className="waiter-calls__call-info">
                <span className="waiter-calls__call-table">Mesa {call.tableNumber}</span>
                <Badge variant="success">
                  {call.status === 'accepted' ? 'En camino' : 'Completada'}
                </Badge>
              </div>
              {call.status === 'accepted' && (
                <div className="waiter-calls__call-actions">
                  <Button variant="secondary" size="md" onClick={() => onComplete(call.id)}>
                    Marcar lista
                  </Button>
                </div>
              )}
            </Card>
          ))}
        </>
      )}
    </div>
  );
}

export default WaiterCallsBoard;
