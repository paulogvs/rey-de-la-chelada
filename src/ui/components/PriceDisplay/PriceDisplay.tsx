/**
 * PriceDisplay — Shows price with/without IVA breakdown, optional tip line
 *
 * Zero hardcoded colors — all from CSS variables
 * IVA is included in price by default (Bolivia standard)
 * Tip is NOT subject to IVA (separate line)
 */

import React, { useState } from 'react';
import { appConfig } from '@/core/config';
import './PriceDisplay.css';

export interface PriceDisplayProps {
  /** Total price with IVA included */
  priceWithIVA: number;
  /** Optional: IVA percentage (defaults to app config) */
  ivaPercentage?: number;
  /** Show IVA breakdown toggle */
  showBreakdown?: boolean;
  /** Show tip selection (for payment screens) */
  showTip?: boolean;
  /** Currency symbol (defaults to app config) */
  currencySymbol?: string;
  /** Large display mode (for KDS / totals) */
  large?: boolean;
  className?: string;
}

export function PriceDisplay({
  priceWithIVA,
  ivaPercentage,
  showBreakdown = false,
  showTip = false,
  currencySymbol,
  large = false,
  className = '',
}: PriceDisplayProps) {
  const config = appConfig.all;
  const symbol = currencySymbol || config.currency.symbol;
  const rate = (ivaPercentage ?? config.taxes.iva.percentage) / 100;
  const [breakdownOpen, setBreakdownOpen] = useState(false);
  const [selectedTip, setSelectedTip] = useState<number>(0);

  const base = Math.round((priceWithIVA / (1 + rate)) * 100) / 100;
  const ivaAmount = Math.round((priceWithIVA - base) * 100) / 100;
  const tipAmount = Math.round((priceWithIVA * (selectedTip / 100)) * 100) / 100;
  const totalWithTip = Math.round((priceWithIVA + tipAmount) * 100) / 100;

  const tipPresets = config.tipping.presetPercentages;

  const classes = [
    'price-display',
    large ? 'price-display--large' : '',
    className,
  ].filter(Boolean).join(' ');

  return (
    <div className={classes}>
      {/* Main Price */}
      <div className="price-display__main">
        <span className="price-display__amount">
          {symbol} {priceWithIVA.toFixed(2)}
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
            <span className="price-display__value">{symbol} {base.toFixed(2)}</span>
          </div>
          <div className="price-display__row">
            <span>IVA ({config.taxes.iva.percentage}%)</span>
            <span className="price-display__value">{symbol} {ivaAmount.toFixed(2)}</span>
          </div>
          <div className="price-display__divider" />
          <div className="price-display__row price-display__row--total">
            <span>Total</span>
            <span className="price-display__value">{symbol} {priceWithIVA.toFixed(2)}</span>
          </div>
        </div>
      )}

      {/* Tip Selection */}
      {showTip && config.tipping.enabled && (
        <div className="price-display__tip">
          <div className="price-display__tip-label">Propina</div>
          <div className="price-display__tip-options">
            {tipPresets.map(pct => (
              <button
                key={pct}
                className={`price-display__tip-btn ${selectedTip === pct ? 'active' : ''}`}
                onClick={() => setSelectedTip(pct)}
              >
                {pct === 0 ? 'Sin propina' : `${pct}%`}
              </button>
            ))}
            {config.tipping.allowCustom && (
              <button
                className={`price-display__tip-btn ${!tipPresets.includes(selectedTip) && selectedTip !== 0 ? 'active' : ''}`}
                onClick={() => {
                  const custom = prompt('Propina personalizada (Bs.):');
                  if (custom) {
                    const val = parseFloat(custom);
                    if (!isNaN(val)) setSelectedTip(val);
                  }
                }}
              >
                Personalizado
              </button>
            )}
          </div>
          {selectedTip > 0 && (
            <div className="price-display__row price-display__row--tip">
              <span>Propina ({selectedTip}%)</span>
              <span className="price-display__value">{symbol} {tipAmount.toFixed(2)}</span>
            </div>
          )}
          {selectedTip > 0 && (
            <>
              <div className="price-display__divider" />
              <div className="price-display__row price-display__row--total">
                <span>Total con propina</span>
                <span className="price-display__value">{symbol} {totalWithTip.toFixed(2)}</span>
              </div>
              <div className="price-display__note">* La propina no está sujeta a IVA</div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default PriceDisplay;
