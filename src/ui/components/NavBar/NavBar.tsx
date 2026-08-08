/**
 * NAVBAR — Fixed top navigation bar (glass)
 *
 * Premium glass surface with strong blur for PWA inner screens.
 * Optional back button + title + right actions slot.
 * ZERO hardcoded colors — all from CSS variables.
 */

import React from 'react';
import './NavBar.css';

export interface NavBarProps {
  /** Bar title */
  title: string;
  /** Show back button + callback */
  onBack?: () => void;
  /** Right-side actions slot */
  right?: React.ReactNode;
  className?: string;
}

export function NavBar({ title, onBack, right, className = '' }: NavBarProps) {
  const classes = ['navbar', className].filter(Boolean).join(' ');

  return (
    <nav className={classes}>
      {onBack && (
        <button
          type="button"
          className="navbar__back"
          onClick={onBack}
          aria-label="Volver"
        >
          ‹
        </button>
      )}
      <span className="navbar__title">{title}</span>
      <div className="navbar__right">{right}</div>
    </nav>
  );
}

export default NavBar;
