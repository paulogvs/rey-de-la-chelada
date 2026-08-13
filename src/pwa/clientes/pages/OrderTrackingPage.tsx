/**
 * PWA CLIENTES — Pantalla de seguimiento del pedido
 *
 * "El pedido activo es el permiso": una vez que el cliente envía su pedido
 * (POST /api/client-orders), esta pantalla muestra el estado en vivo:
 *
 *   called     → "El mesero se acerca…" (espera de confirmación)
 *   confirmed  → "Pedido confirmado"
 *   preparing  → "En preparación" (bar/cocina trabajando)
 *   ready      → "¡Tu pedido está listo!"
 *   served     → "¡Disfruta tu pedido!"
 *   paid       → pantalla de agradecimiento + reset
 *
 * El estado se refresca cada 5s vía GET /api/client-orders/:id.
 */

import React, { useMemo } from 'react';
import { ToastInline } from '@/ui/components/Toast';
import { AppIcon } from '@/ui/components/AppIcon/AppIcon';
import { formatMoney } from '@/pwa/_shared/utils/format';
import { statusLabel, isTerminalStatus } from '../hooks/useClientOrder';
import type { TrackedOrder } from '../hooks/useClientOrder';
import './OrderTrackingPage.css';

/** Step indices for the progress stepper (non-terminal statuses only). */
const STEP_ORDER: string[] = ['called', 'confirmed', 'preparing', 'ready', 'served'];

interface OrderTrackingPageProps {
  order: TrackedOrder;
  error: string | null;
  polling: boolean;
  onReset: () => void;
}

export function OrderTrackingPage({ order, error, polling, onReset }: OrderTrackingPageProps) {
  const paid = order.status === 'paid';
  const cancelled = order.status === 'cancelled';

  const currentStep = useMemo(() => {
    const idx = STEP_ORDER.indexOf(order.status);
    return idx === -1 ? 0 : idx;
  }, [order.status]);

  // Thanks screen
  if (paid) {
    return (
      <div className="tracking-page tracking-page--thanks">
        <div className="tracking-hero">
          <div className="tracking-hero__icon" aria-hidden="true"><AppIcon name="check" size="xl" /></div>
          <h1 className="tracking-hero__title">¡Gracias por tu visita!</h1>
          <p className="tracking-hero__subtitle">
            Tu pedido fue pagado. ¡Vuelve pronto, Rey de la Chelada!
          </p>
          <div className="tracking-receipt">
            <span className="tracking-receipt__label">Mesa</span>
            <span className="tracking-receipt__value">{order.tableNumber}</span>
            <span className="tracking-receipt__label">Total pagado</span>
            <span className="tracking-receipt__value">{formatMoney(order.total)}</span>
          </div>
        </div>
        <button className="tracking-btn tracking-btn--primary" onClick={onReset}>
          Nuevo pedido
        </button>
      </div>
    );
  }

  // Cancelled screen
  if (cancelled) {
    return (
      <div className="tracking-page">
        <div className="tracking-hero">
          <div className="tracking-hero__icon" aria-hidden="true"><AppIcon name="info" size="xl" /></div>
          <h1 className="tracking-hero__title">Pedido cancelado</h1>
          <p className="tracking-hero__subtitle">
            El pedido fue cancelado. Si necesitas ayuda, llama a un mesero.
          </p>
        </div>
        <button className="tracking-btn tracking-btn--primary" onClick={onReset}>
          Volver al menú
        </button>
      </div>
    );
  }

  // Active tracking screen
  return (
    <div className="tracking-page" data-status={order.status}>
      <header className="tracking-header">
        <div className="tracking-header__table">
          <span className="tracking-header__label">Mesa</span>
          <strong className="tracking-header__number">{order.tableNumber}</strong>
        </div>
        {polling && (
          <span className="tracking-live" aria-label="Actualización en vivo">
            <span className="tracking-live__dot" aria-hidden="true" />
            En vivo
          </span>
        )}
      </header>

      <section className="tracking-status" key={order.status} aria-live="polite">
        <div className="tracking-status__icon" aria-hidden="true">
          {order.status === 'ready' || order.status === 'served'
            ? <AppIcon name="check" size="xl" />
            : <AppIcon name="clock" size="xl" />}
        </div>
        <h1 className="tracking-status__title">{statusLabel(order.status)}</h1>
        {order.status === 'called' && (
          <p className="tracking-status__hint">
            Un mesero confirmará tu pedido en un momento.
          </p>
        )}
      </section>

      {/* Progress stepper */}
      <section className="tracking-stepper" aria-hidden="true">
        {STEP_ORDER.map((step, i) => (
          <React.Fragment key={step}>
            {i > 0 && <span className={`tracking-stepper__line ${i <= currentStep ? 'done' : ''}`} />}
            <span
              className={`tracking-stepper__dot ${i <= currentStep ? 'done' : ''}`}
            >
              {i < currentStep ? <AppIcon name="check" size="sm" /> : i + 1}
            </span>
          </React.Fragment>
        ))}
      </section>
      <p className="tracking-stepper__labels">
        {STEP_ORDER.map((step, i) => (
          <span
            key={step}
            className={`tracking-stepper__label ${i <= currentStep ? 'active' : ''}`}
          >
            {statusLabel(step)}
          </span>
        ))}
      </p>

      <section className="tracking-summary">
        <div className="tracking-summary__row">
          <span>Total (incluye IVA)</span>
          <strong>{formatMoney(order.total)}</strong>
        </div>
      </section>

      {error && <ToastInline type="error" message={error} />}

      <div className="tracking-actions">
        <button className="tracking-btn tracking-btn--ghost" onClick={onReset}>
          Volver al menú
        </button>
      </div>
    </div>
  );
}

export default OrderTrackingPage;

export { isTerminalStatus };
