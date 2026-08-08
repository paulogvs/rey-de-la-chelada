/**
 * PWA Layout — Base layout para todos los PWAs
 *
 * Incluye:
 * - FORCH.iA Brand Badge
 * - Carga de tokens.css
 * - Tema oscuro por defecto
 */

import React, { type ReactNode } from 'react';
import '@/ui/tokens/tokens.css';

interface PwaLayoutProps {
  children: ReactNode;
  title?: string;
}

export function PwaLayout({ children, title: _title }: PwaLayoutProps) {
  return (
    <div className="pwa-root" data-pwa-root>
      <main className="pwa-main">
        {children}
      </main>
      <footer className="forchi-badge">
        <span>Built with </span>
        <a
          href="https://forch-i-a-hub.vercel.app/"
          target="_blank"
          rel="noopener noreferrer"
        >
          FORCH.i
        </a>
      </footer>
    </div>
  );
}
