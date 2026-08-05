/**
 * CategoryButton + MenuBanner + PageHeader + CustomerActions —
 * small presentational pieces of the clientes PWA menu page, extracted
 * so MenuPage stays under 300 lines.
 */

import { useState } from 'react';
import { Badge } from '@/ui/components/Badge';

/** Category filter bar item */
export function CategoryButton({
  label,
  emoji,
  active,
  onClick,
}: {
  label: string;
  emoji?: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className={`clientes-categories__btn ${active ? 'active' : ''}`}
      onClick={onClick}
    >
      {emoji && <span className="clientes-categories__emoji">{emoji}</span>}
      {label}
    </button>
  );
}

/**
 * Full-width hero banner above the header.
 * Hides itself if the image is missing (404 / network error).
 * The path is data served by the Express /menu-photos mount.
 */
export function MenuBanner() {
  const [imgError, setImgError] = useState(false);
  if (imgError) return null;
  return (
    <img
      src="/menu-photos/micheladas/header-micheladas.png"
      alt="Rey de la Chelada"
      className="clientes-banner"
      onError={() => setImgError(true)}
    />
  );
}

/** Page header: logo + brand + mesa badge + session alert. */
export function PageHeader({
  tableNumber,
  sessionValid,
  sessionError,
}: {
  tableNumber: number;
  sessionValid: boolean;
  sessionError?: string;
}) {
  // Logo fallback: keep text-only brand if the image is missing
  const [logoError, setLogoError] = useState(false);
  return (
    <header className="clientes-header">
      <div className="clientes-header__brand">
        {!logoError && (
          <img
            src="/logo/rey_de_la_chelada_logo.png"
            alt=""
            className="clientes-header__logo"
            onError={() => setLogoError(true)}
          />
        )}
        <h1>Rey de la Chelada</h1>
        {tableNumber > 0 && (
          <Badge variant="info">Mesa {tableNumber}</Badge>
        )}
      </div>
      {!sessionValid && sessionError && (
        <div className="clientes-alert clientes-alert--error">
          {sessionError}
        </div>
      )}
    </header>
  );
}

/** Floating customer actions (call waiter / request bill). */
export function CustomerActions({
  canCallWaiter,
  canRequestBill,
  isReadOnly,
  isValid,
  onCallWaiter,
  onRequestBill,
}: {
  canCallWaiter: boolean;
  canRequestBill: boolean;
  isReadOnly: boolean;
  isValid: boolean;
  onCallWaiter: () => void;
  onRequestBill: () => void;
}) {
  // FASE 1: llamar mesero está disponible con sesión válida (con o sin
  // pedido activo). Pedir cuenta requiere pedido activo.
  if (canCallWaiter) {
    return (
      <footer className="clientes-actions">
        <button
          className="clientes-actions__btn clientes-actions__btn--call animate-fade-in-up"
          onClick={onCallWaiter}
        >
          Llamar Mesero
        </button>
        {canRequestBill && (
          <button
            className="clientes-actions__btn clientes-actions__btn--bill animate-fade-in-up"
            onClick={onRequestBill}
          >
            Pedir Cuenta
          </button>
        )}
      </footer>
    );
  }
  if (isReadOnly && !canCallWaiter && isValid) {
    return (
      <footer className="clientes-actions clientes-actions--readonly">
        <p>Escanea el QR para llamar al mesero.</p>
      </footer>
    );
  }
  return null;
}
