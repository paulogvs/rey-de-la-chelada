/**
 * QRDisplay — QR code display component
 *
 * Renders a QR code for payments, menu access, table identification
 * Uses qrcode library to generate SVG/Canvas
 */

import React, { useEffect, useRef, useState } from 'react';
import './QRDisplay.css';

// We use the qrcode package (qrcode library installed in dependencies)
declare const QRCode: any;

export interface QRDisplayProps {
  /** Data to encode in QR */
  data: string;
  /** Label below the QR code */
  label?: string;
  /** Size in pixels (default: 200) */
  size?: number;
  /** Error correction level: L, M, Q, H */
  errorCorrection?: 'L' | 'M' | 'Q' | 'H';
  /** Show loading skeleton */
  loading?: boolean;
  className?: string;
}

export function QRDisplay({
  data,
  label,
  size = 200,
  errorCorrection = 'M',
  loading = false,
  className = '',
}: QRDisplayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!canvasRef.current || loading) return;

    try {
      // Read colors from CSS custom properties (Artículo II: ZERO HARDCODED VALUES)
      // Canvas API doesn't support CSS variables, so we read the computed values
      const root = document.documentElement;
      const computed = getComputedStyle(root);
      const qrDark = computed.getPropertyValue('--dorado-rey').trim() || '#D4AF37';
      const qrLight = computed.getPropertyValue('--bg').trim() || '#1A0F0A';

      import('qrcode').then(QRCode => {
        QRCode.toCanvas(canvasRef.current, data, {
          width: size,
          margin: 2,
          color: {
            dark: qrDark,
            light: qrLight,
          },
          errorCorrectionLevel: errorCorrection,
        }, (err: Error | null) => {
          if (err) {
            console.error('[QRDisplay] Failed to generate:', err);
            setError('Error al generar QR');
          }
        });
      });
    } catch (err) {
      console.error('[QRDisplay] Failed to load qrcode:', err);
      setError('Error al cargar generador QR');
    }
  }, [data, size, errorCorrection, loading]);

  if (loading) {
    return (
      <div className={`qr-display ${className}`} aria-label="Cargando código QR">
        <div className="qr-display__skeleton" style={{ width: size, height: size }} />
        {label && <div className="skeleton-line skeleton-line--w60" />}
      </div>
    );
  }

  if (error) {
    return (
      <div className={`qr-display qr-display--error ${className}`}>
        <div className="qr-display__placeholder" style={{ width: size, height: size }}>
          <span>⚠</span>
        </div>
        <span className="qr-display__error-text">{error}</span>
      </div>
    );
  }

  return (
    <div className={`qr-display ${className}`}>
      <canvas ref={canvasRef} className="qr-display__canvas" />
      {label && <span className="qr-display__label">{label}</span>}
    </div>
  );
}

export default QRDisplay;
