/**
 * APPHEADER — Page header with brand gradient
 *
 * Large display title + optional subtitle + actions slot.
 * Uses --header-gradient + --accent-glow + --text-hero.
 * ZERO hardcoded colors — all from CSS variables.
 */

import React from 'react';
import './AppHeader.css';

export interface AppHeaderProps {
  /** Page title */
  title: string;
  /** Optional supporting text */
  subtitle?: string;
  /** Right-side actions slot */
  actions?: React.ReactNode;
  className?: string;
}

export function AppHeader({ title, subtitle, actions, className = '' }: AppHeaderProps) {
  const classes = ['app-header', className].filter(Boolean).join(' ');

  return (
    <header className={classes}>
      <div className="app-header__content">
        <h1 className="app-header__title">{title}</h1>
        {subtitle && <p className="app-header__subtitle">{subtitle}</p>}
      </div>
      {actions && <div className="app-header__actions">{actions}</div>}
    </header>
  );
}

export default AppHeader;
