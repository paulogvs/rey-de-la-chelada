import React from 'react';
import { Card } from '@/ui/components/Card';
import { MoneyInput } from '@/ui/components/MoneyInput/MoneyInput';
import { SegmentedControl, type SegmentedOption } from '@/ui/components/SegmentedControl';
import { formatMoney } from '../utils/format';
import { buildMixedPaymentPayload, previewAllocations, type PaymentAllocationInput } from '../utils/paymentAllocations';

interface MixedPaymentEditorProps {
  total: number;
  mode: 'simple' | 'mixed';
  method: 'cash' | 'qr';
  cashAmount: number;
  qrAmount: number;
  received: number;
  reference: string;
  onModeChange: (mode: 'simple' | 'mixed') => void;
  onMethodChange: (method: 'cash' | 'qr') => void;
  onCashAmountChange: (amount: number) => void;
  onQrAmountChange: (amount: number) => void;
  onReceivedChange: (amount: number) => void;
  onReferenceChange: (reference: string) => void;
  qrEnabled: boolean;
}

const MODE_OPTIONS: SegmentedOption[] = [
  { value: 'simple', label: 'Un método' },
  { value: 'mixed', label: 'Mixto' },
];

const METHOD_OPTIONS: SegmentedOption[] = [
  { value: 'cash', label: 'Efectivo' },
  { value: 'qr', label: 'QR' },
];

export function MixedPaymentEditor(props: MixedPaymentEditorProps) {
  const allocations: PaymentAllocationInput[] = props.mode === 'mixed'
    ? [
      ...(props.cashAmount > 0 ? [{ method: 'cash' as const, amount: props.cashAmount, received: props.received || undefined }] : []),
      ...(props.qrAmount > 0 ? [{ method: 'qr' as const, amount: props.qrAmount, reference: props.reference }] : []),
    ]
    : [{ method: props.method, amount: props.total, ...(props.method === 'cash' ? { received: props.received || props.total } : {}), ...(props.method === 'qr' ? { reference: props.reference } : {}) }];
  const preview = previewAllocations(props.total, allocations);

  return (
    <Card className="payment-panel__splits">
      <div className="payment-panel__splits-header"><h4>Forma de pago</h4></div>
      <SegmentedControl options={MODE_OPTIONS} value={props.mode} onChange={value => props.onModeChange(value as 'simple' | 'mixed')} />
      {props.mode === 'simple' ? (
        <>
          <SegmentedControl className="payment-panel__method" options={METHOD_OPTIONS} value={props.method} onChange={value => props.onMethodChange(value as 'cash' | 'qr')} />
          {props.method === 'cash' ? (
            <label className="payment-panel__cash-label" htmlFor="payment-received">
              Efectivo recibido
              <MoneyInput id="payment-received" value={props.received} onChange={props.onReceivedChange} placeholder="Bs" />
            </label>
          ) : <p className="payment-panel__qr-hint">El cliente transfiere {formatMoney(props.total)} por QR.</p>}
        </>
      ) : (
        <>
          <label className="payment-panel__cash-label" htmlFor="mixed-cash-amount">Efectivo aplicado</label>
          <MoneyInput id="mixed-cash-amount" value={props.cashAmount} onChange={props.onCashAmountChange} placeholder="Bs" />
          <label className="payment-panel__cash-label" htmlFor="mixed-cash-received">Efectivo recibido</label>
          <MoneyInput id="mixed-cash-received" value={props.received} onChange={props.onReceivedChange} placeholder="Bs" />
          <label className="payment-panel__cash-label" htmlFor="mixed-qr-amount">QR aplicado</label>
          <MoneyInput id="mixed-qr-amount" value={props.qrAmount} onChange={props.onQrAmountChange} placeholder="Bs" />
          <label className="payment-panel__cash-label" htmlFor="mixed-reference">Referencia QR (opcional)</label>
          <input id="mixed-reference" className="payment-panel__reference" value={props.reference} onChange={event => props.onReferenceChange(event.target.value)} />
        </>
      )}
      {props.mode === 'mixed' && (
        <div className="payment-panel__remaining">
          <span>Asignado: {formatMoney(preview.total)} · Saldo: {formatMoney(preview.remaining)}</span>
          {preview.change > 0 && <span>Vuelto: {formatMoney(preview.change)}</span>}
        </div>
      )}
      {props.mode === 'simple' && props.method === 'cash' && preview.change > 0 && (
        <p className="payment-panel__change">Cambio: <strong>{formatMoney(preview.change)}</strong></p>
      )}
      {props.mode === 'simple' && props.method === 'qr' && !props.qrEnabled && <p>El QR no está configurado.</p>}
      <span data-payment-valid={preview.valid && (props.mode === 'mixed' ? preview.total === props.total : true)} hidden />
    </Card>
  );
}

export { buildMixedPaymentPayload };
