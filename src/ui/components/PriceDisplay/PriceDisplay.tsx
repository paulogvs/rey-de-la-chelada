/**
 * PriceDisplay — Shows price with/without IVA breakdown
 *
 * Zero hardcoded colors — all from CSS variables
 * IVA is included in price by default (Bolivia standard)
 * FASE 3: propina eliminada de la app (se da directo al mesero).
 */

import React, { useState } from 'react';
import { appConfig } from '@/core/config';
import { formatMoney } from '@/pwa/_shared/utils/format';
import './PriceDisplay.css';

export interface PriceDisplayProps {
  /** Total price with IVA included, en CENTAVOS (entero) — null = show "—" placeholder */
  priceWithIVA: number | null;
  /** Optional: IVA percentage (defaults to app config) */
  ivaPercentage?: number;
  /** Show IVA breakdown toggle */
  showBreakdown?: boolean;
  /** Currency symbol (deprecated — la moneda está unificada en formatMoney) */
  currencySymbol?: string;
  /** Large display mode (for KDS / totals) */
  large?: boolean;
  className?: string;
}

export function PriceDisplay({
  priceWithIVA,
  ivaPercentage,
  showBreakdown = false,
  large = false,
  className = '',
}: PriceDisplayProps) {
  const config = appConfig.all;
  const rate = (ivaPercentage ?? config.taxes.iva.percentage) / 100;
  const [breakdownOpen, setBreakdownOpen] = useState(false);

  const classes = [
    'price-display',
    large ? 'price-display--large' : '',
    className,
  ].filter(Boolean).join(' ');

  // Null price: show placeholder
  if (priceWithIVA == null) {
    return (
      <div className={classes}>
        <div className="price-display__main">
          <span className="price-display__amount price-display__amount--null">—</span>
        </div>
      </div>
    );
  }

  // Total y desglose en CENTAVOS (contrato SSOT): base = total/(1+rate), iva = total - base.
  const base = Math.round(priceWithIVA / (1 + rate));
  const ivaAmount = priceWithIVA - base;

  return (
    <div className={classes}>
      {/* Main Price */}
      <div className="price-display__main">
        <span className="price-display__amount">
          {formatMoney(priceWithIVA)}
        </span>
        {showBreakdown && (
          <button
            className="price-display__toggle"
            onClick={() => setBreakdownOpen(!breakdownOpen)}
            aria-expanded={breakdownOpen}
          >
            {breakdownOpen ? 'Ocultar' : 'Ver'} detalle
          </button>
        )}
      </div>

      {/* IVA Breakdown */}
      {showBreakdown && breakdownOpen && (
        <div className="price-display__breakdown">
          <div className="price-display__row">
            <span>Subtotal (sin IVA)</span>
            <span className="price-display__value">{formatMoney(base)}</span>
          </div>
          <div className="price-display__row">
            <span>IVA ({config.taxes.iva.percentage}%)</span>
            <span className="price-display__value">{formatMoney(ivaAmount)}</span>
          </div>
          <div className="price-display__divider" />
          <div className="price-display__row price-display__row--total">
            <span>Total</span>
            <span className="price-display__value">{formatMoney(priceWithIVA)}</span>
          </div>
        </div>
      )}
    </div>
  );
}

export default PriceDisplay;
