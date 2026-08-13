/**
 * CategoryButton + MenuBanner + PageHeader + CustomerActions —
 * small presentational pieces of the clientes PWA menu page, extracted
 * so MenuPage stays under 300 lines.
 */

import { useState } from 'react';
import { Badge } from '@/ui/components/Badge';
import { AppIcon } from '@/ui/components/AppIcon/AppIcon';

/** Category filter bar item */
export function CategoryButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className={`clientes-categories__btn ${active ? 'active' : ''}`}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

/**
 * Full-width hero banner above the header.
 * Hides itself if the image is missing (404 / network error).
 * The path is data served by the Express /menu-photos mount.
 * Envuelto en un contenedor para el gradiente dorado + textura.
 */
export function MenuBanner() {
  const [imgError, setImgError] = useState(false);
  if (imgError) return null;
  return (
    <div className="clientes-banner" aria-hidden="true">
      <img
        src="/menu-photos/micheladas/header-micheladas.png"
        alt="Rey de la Chelada"
        className="clientes-banner__img"
        onError={() => setImgError(true)}
      />
    </div>
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
          className="clientes-actions__btn clientes-actions__btn--call"
          onClick={onCallWaiter}
        >
          <AppIcon name="bell" size="md" />
          Llamar Mesero
        </button>
        {canRequestBill && (
          <button
            className="clientes-actions__btn clientes-actions__btn--bill"
            onClick={onRequestBill}
          >
            <AppIcon name="receipt" size="md" />
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
