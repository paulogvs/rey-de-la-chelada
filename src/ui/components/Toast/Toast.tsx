/**
 * TOAST — Notification system
 *
 * Types: success (green), error (red), warning (amber), info (gold)
 * Auto-dismiss after configurable duration
 * Stack multiple toasts
 * Zero hardcoded colors
 */

import React, { useState, useEffect, useCallback, useRef, createContext, useContext, type ReactNode } from 'react';
import { AppIcon, type AppIconName } from '../AppIcon/AppIcon';
import './Toast.css';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface ToastItem {
  id: string;
  type: ToastType;
  message: string;
  duration?: number;
}

interface ToastContextValue {
  addToast: (toast: Omit<ToastItem, 'id'>) => string;
  removeToast: (id: string) => void;
  clearToasts: () => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within a ToastProvider');
  return ctx;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const addToast = useCallback((toast: Omit<ToastItem, 'id'>): string => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
    const newToast: ToastItem = { ...toast, id, duration: toast.duration ?? 4000 };
    setToasts(prev => [...prev, newToast]);
    return id;
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const clearToasts = useCallback(() => {
    setToasts([]);
  }, []);

  return (
    <ToastContext.Provider value={{ addToast, removeToast, clearToasts }}>
      {children}
      <div className="toast-container" role="region" aria-label="Notifications">
        {toasts.map(toast => (
          <ToastItemComponent
            key={toast.id}
            toast={toast}
            onDismiss={() => removeToast(toast.id)}
          />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

interface ToastItemProps {
  toast: ToastItem;
  onDismiss: () => void;
}

function ToastItemComponent({ toast, onDismiss }: ToastItemProps) {
  const [exiting, setExiting] = useState(false);
  // Ref único para el timer de dismiss: evita doble-dismiss (click + auto)
  // y permite limpiarlo en unmount (fix react-doctor effect-needs-cleanup).
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scheduleDismiss = useCallback(() => {
    if (dismissTimerRef.current) return;
    dismissTimerRef.current = setTimeout(() => {
      dismissTimerRef.current = null;
      onDismiss();
    }, 300);
  }, [onDismiss]);

  useEffect(() => {
    const autoTimer = setTimeout(() => {
      setExiting(true);
      scheduleDismiss();
    }, toast.duration);
    return () => {
      clearTimeout(autoTimer);
      if (dismissTimerRef.current) {
        clearTimeout(dismissTimerRef.current);
        dismissTimerRef.current = null;
      }
    };
  }, [toast.duration, scheduleDismiss]);

  const handleDismiss = () => {
    setExiting(true);
    scheduleDismiss();
  };

  const classes = [
    'toast',
    `toast--${toast.type}`,
    exiting ? 'toast--exit' : 'toast--enter',
  ].join(' ');

  const icons: Record<ToastType, AppIconName> = {
    success: 'check',
    error: 'x',
    warning: 'alert',
    info: 'info',
  };

  return (
    <div className={classes} role="alert" onClick={handleDismiss}>
      <span className="toast__icon" aria-hidden="true"><AppIcon name={icons[toast.type]} size="sm" /></span>
      <span className="toast__message">{toast.message}</span>
      <button className="toast__close" aria-label="Dismiss" onClick={(e) => { e.stopPropagation(); handleDismiss(); }}>
        <AppIcon name="x" size="sm" />
      </button>
    </div>
  );
}

/** Standalone toast component (not in provider) */
export function ToastInline({ type, message }: { type: ToastType; message: string }) {
  return (
    <div className={`toast toast--inline toast--${type}`} role="alert">
      <span className="toast__message">{message}</span>
    </div>
  );
}

export default ToastProvider;
