/**
 * LoginScreen — PIN login for staff PWAs (meseros/caja/admin)
 *
 * Shared component: enter 4-digit PIN → useStaffAuth.login(pin).
 * Shows the staff role title and a numeric keypad (touch-friendly).
 */

import React, { useState, useCallback } from 'react';
import { AppIcon } from '@/ui/components/AppIcon/AppIcon';
import './Login.css';

interface LoginScreenProps {
  /** Title shown above the keypad, e.g. "Meseros" */
  title: string;
  /** Loading state (auth restoring or logging in) */
  busy?: boolean;
  /** Gentle notice shown above the keypad, e.g. "Tu sesión expiró". */
  notice?: string | null;
  /** Called with the entered PIN */
  onLogin: (pin: string) => Promise<{ ok: boolean; code: string | null }>;
}

export function LoginScreen({ title, busy = false, notice = null, onLogin }: LoginScreenProps) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const pressDigit = useCallback((digit: string) => {
    setError(null);
    setPin(prev => (prev.length < 4 ? prev + digit : prev));
  }, []);

  const clearPin = useCallback(() => {
    setPin('');
    setError(null);
  }, []);

  const submit = useCallback(async () => {
    if (pin.length < 4 || submitting) return;
    setSubmitting(true);
    try {
      const result = await onLogin(pin);
      if (!result.ok) {
        setError(
          result.code === 'INVALID_PIN'
            ? 'PIN incorrecto'
            : result.code === 'FORBIDDEN_ROLE'
              ? 'No tienes acceso a esta pantalla'
              : result.code === 'NETWORK_ERROR'
                ? 'Sin conexión al servidor'
                : 'No se pudo iniciar sesión'
        );
        setPin('');
      }
      // On success the parent switches to the app view
    } finally {
      setSubmitting(false);
    }
  }, [pin, submitting, onLogin]);

  const submitOnEnter = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') submit();
    },
    [submit]
  );

  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'clear', '0', 'ok'];

  return (
    <div className="login-screen">
      <div className="login-screen__card">
        <h1 className="login-screen__title">{title}</h1>
        <p className="login-screen__subtitle">Ingresa tu PIN</p>

        {notice && <p className="login-screen__notice">{notice}</p>}

        {/* PIN dots */}
        <div className="login-screen__dots" aria-label={`PIN actual: ${'•'.repeat(pin.length)}`}>
          {[0, 1, 2, 3].map(i => (
            <span
              key={i}
              className={`login-screen__dot ${i < pin.length ? 'filled' : ''}`}
            />
          ))}
        </div>

        {error && <p className="login-screen__error">{error}</p>}

        {/* Numeric keypad */}
        <div className="login-screen__keypad" onKeyDown={submitOnEnter}>
          {keys.map(key => {
            if (key === 'clear') {
              return (
                <button
                  key={key}
                  type="button"
                  className="login-screen__key"
                  onClick={clearPin}
                  aria-label="Borrar"
                >
                  <AppIcon name="delete" size="md" />
                </button>
              );
            }
            if (key === 'ok') {
              return (
                <button
                  key={key}
                  type="button"
                  className="login-screen__key login-screen__key--ok"
                  onClick={submit}
                  disabled={pin.length < 4 || busy || submitting}
                  aria-label="Ingresar"
                >
                  {submitting ? '…' : <AppIcon name="check" size="md" />}
                </button>
              );
            }
            return (
              <button
                key={key}
                type="button"
                className="login-screen__key"
                onClick={() => pressDigit(key)}
              >
                {key}
              </button>
            );
          })}
        </div>

        {busy && <p className="login-screen__busy">Restaurando sesión…</p>}
      </div>
    </div>
  );
}

export default LoginScreen;
