/**
 * MODAL — Slide-up bottom sheet for mobile, centered for desktop
 *
 * Zero hardcoded colors — all from CSS variables
 * Supports: close on backdrop, close button, keyboard escape
 * Touch-friendly: large close targets
 */

import React, { useEffect, useCallback, type ReactNode } from 'react';
import { AppIcon } from '../AppIcon/AppIcon';
import './Modal.css';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children?: ReactNode;
  /** Footer actions area */
  footer?: ReactNode;
  /** Full screen on mobile (default: bottom sheet) */
  fullScreen?: boolean;
  /** Prevent close on backdrop click */
  persistent?: boolean;
  className?: string;
}

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  fullScreen = false,
  persistent = false,
  className = '',
}: ModalProps) {
  // Close on Escape key
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape' && !persistent) onClose();
  }, [onClose, persistent]);

  useEffect(() => {
    if (open) {
      document.addEventListener('keydown', handleKeyDown);
      document.body.style.overflow = 'hidden';
    }
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = '';
    };
  }, [open, handleKeyDown]);

  if (!open) return null;

  const classes = [
    'modal-overlay',
    fullScreen ? 'modal-overlay--fullscreen' : '',
  ].join(' ');

  const sheetClasses = [
    'modal-sheet',
    fullScreen ? 'modal-sheet--fullscreen' : '',
    className,
  ].filter(Boolean).join(' ');

  return (
    <div
      className={classes}
      onClick={(e) => {
        if (!persistent && e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div className={sheetClasses}>
        {/* Handle bar (mobile) */}
        <div className="modal-handle" aria-hidden="true" />

        {/* Header */}
        <div className="modal-header">
          <h2 className="modal-title">{title}</h2>
          {!persistent && (
            <button
              className="modal-close"
              onClick={onClose}
              aria-label="Cerrar"
            >
              <AppIcon name="x" size="sm" />
            </button>
          )}
        </div>

        {/* Content */}
        <div className="modal-body">
          {children}
        </div>

        {/* Footer */}
        {footer && (
          <div className="modal-footer">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

export default Modal;
