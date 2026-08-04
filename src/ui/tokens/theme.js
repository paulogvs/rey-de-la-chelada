/**
 * Theme Manager — Dynamic Palette System
 * 
 * SSOT for all design tokens. Change the palette at runtime and the entire app updates.
 * Zero hardcoded colors in any component.
 * 
 * Implements: DESIGN.md token architecture
 * Artículo II: ZERO HARDCODED VALUES
 */

import tokens from './tokens.json';

/** Acceso seguro a document.documentElement (typeof guard — compatible no-undef/SSR).
 *  Devuelve el elemento :root, que es el que posee `.style.setProperty`.
 *  (Antes devolvía `document` — que no tiene `.style` — y rompía todo el
 *  arranque con "Cannot read properties of undefined (reading 'setProperty')".) */
function safeDocument() {
  if (typeof document === 'undefined') return null;
  return document.documentElement || null;
}

class ThemeManager {
  constructor() {
    this._tokens = tokens;
    this._currentPalette = tokens.current_palette;
    this._currentTheme = tokens.current_theme; // 'dark' | 'light'
    this._listeners = [];
    this._init();
  }

  /** Initialize CSS custom properties on :root */
  _init() {
    this._applyPalette(this._currentPalette, this._currentTheme);
  }

  /** Get the full token data */
  get tokens() {
    return this._tokens;
  }

  /** Get current palette name */
  get currentPalette() {
    return this._currentPalette;
  }

  /** Get current theme mode */
  get currentTheme() {
    return this._currentTheme;
  }

  /** Get available palette names */
  get palettes() {
    return Object.keys(this._tokens.palettes).filter(p => p !== 'default-fallbacks');
  }

  /** Set theme: 'dark' | 'light' */
  setTheme(theme) {
    if (theme === this._currentTheme) return;
    if (!['dark', 'light'].includes(theme)) {
      console.error(`Theme "${theme}" not supported. Use "dark" or "light".`);
      return;
    }
    this._currentTheme = theme;
    this._applyPalette(this._currentPalette, theme);
    this._notify();
  }

  /** Toggle between dark/light */
  toggleTheme() {
    this.setTheme(this._currentTheme === 'dark' ? 'light' : 'dark');
  }

  /** Switch to a different palette */
  setPalette(paletteName) {
    if (!this._tokens.palettes[paletteName]) {
      console.error(`Palette "${paletteName}" not found. Using current.`);
      return;
    }
    this._currentPalette = paletteName;
    this._applyPalette(paletteName, this._currentTheme);
    this._notify();
  }

  /** Register a listener for theme changes */
  onChange(callback) {
    this._listeners.push(callback);
    return () => {
      this._listeners = this._listeners.filter(l => l !== callback);
    };
  }

  /** Notify all listeners of theme change */
  _notify() {
    this._listeners.forEach(cb => cb(this._currentTheme, this._currentPalette));
  }

  /** Apply palette + theme as CSS custom properties */
  _applyPalette(paletteName, theme) {
    const palette = this._tokens.palettes[paletteName];
    if (!palette) return;

    // Guard SSR/Node: sin document no hay CSS custom properties
    const root = safeDocument();
    if (!root) return;

    // 1. Brand colors
    this._setProp(root, '--dorado-rey', palette.brand['dorado-rey']);
    this._setProp(root, '--dorado-rey-hover', palette.brand['dorado-rey-hover']);
    this._setProp(root, '--dorado-rey-soft', this._rgba(palette.brand['dorado-rey-soft']));
    this._setProp(root, '--madera-oscura', palette.brand['madera-oscura']);
    this._setProp(root, '--ambar-cerveza', palette.brand['ambar-cerveza']);
    this._setProp(root, '--crema-espuma', palette.brand['crema-espuma']);
    this._setProp(root, '--verde-esmeralda', palette.brand['verde-esmeralda']);

    // 1.5 Accent/inverse (constantes de paleta — texto sobre acento/imágenes)
    this._setProp(root, '--on-accent', palette.brand['on-accent']);
    this._setProp(root, '--text-inverse', palette.brand['text-inverse']);

    // 1.6 Overlay + receipt (constantes de paleta)
    this._setProp(root, '--overlay', palette.overlay?.default);
    this._setProp(root, '--overlay-strong', palette.overlay?.strong);
    this._setProp(root, '--receipt-bg', palette.receipt?.bg);
    this._setProp(root, '--receipt-text', palette.receipt?.text);
    this._setProp(root, '--receipt-muted', palette.receipt?.muted);
    this._setProp(root, '--receipt-strong', palette.receipt?.strong);

    // 2. Surfaces (theme-specific)
    const surfaces = palette.surfaces[theme];
    if (surfaces) {
      this._setProp(root, '--bg', surfaces.bg);
      this._setProp(root, '--surface', surfaces.surface);
      this._setProp(root, '--surface-soft', surfaces['surface-soft']);
      this._setProp(root, '--surface-elevated', surfaces['surface-elevated']);
      this._setProp(root, '--border', this._rgba(surfaces.border));
      this._setProp(root, '--border-hover', this._rgba(surfaces['border-hover']));
    }

    // 3. Text (theme-specific)
    const text = palette.text[theme];
    if (text) {
      this._setProp(root, '--text', text.body);
      this._setProp(root, '--text-strong', text.strong);
      this._setProp(root, '--text-muted', this._rgba(text.muted));
    }

    // 4. Status colors
    this._setProp(root, '--status-pending', palette.status.pending);
    this._setProp(root, '--status-confirmed', palette.status.confirmed);
    this._setProp(root, '--status-cancelled', palette.status.cancelled);
    this._setProp(root, '--status-preparing', palette.status.preparing);
    this._setProp(root, '--status-delivered', palette.status.delivered);

    // 5. KDS colors
    this._setProp(root, '--kds-bg', palette.kds.bg);
    this._setProp(root, '--kds-text', palette.kds.text);
    this._setProp(root, '--kds-urgent', palette.kds.urgent);
    this._setProp(root, '--kds-warning', palette.kds.warning);
    this._setProp(root, '--kds-new-order', palette.kds['new-order']);
    this._setProp(root, '--kds-completed', palette.kds.completed);

    // 6. Spacing
    Object.entries(this._tokens.spacing).forEach(([key, val]) => {
      this._setProp(root, `--${key}`, val);
    });

    // 7. Typography
    Object.entries(this._tokens.typography).forEach(([key, val]) => {
      if (key === 'scale') return;
      this._setProp(root, `--font-${key.replace('font-', '')}`, val);
    });
    Object.entries(this._tokens.typography.scale).forEach(([key, val]) => {
      this._setProp(root, `--text-${key}`, val);
    });

    // 8. Radii
    Object.entries(this._tokens.radii).forEach(([key, val]) => {
      this._setProp(root, `--radius-${key}`, val);
    });

    // 9. Shadows
    Object.entries(this._tokens.shadows).forEach(([key, val]) => {
      this._setProp(root, `--shadow-${key}`, val);
    });

    // 10. Motion
    Object.entries(this._tokens.motion).forEach(([key, val]) => {
      this._setProp(root, `--duration-${key}`, val);
    });

    // 11. Glassmorphism (from tokens.json SSOT — theme-aware)
    const glass = palette.glassmorphism?.[theme];
    if (glass) {
      this._setProp(root, '--glass-bg', this._rgba(glass.bg));
      this._setProp(root, '--glass-border', this._rgba(glass.border));
      this._setProp(root, '--glass-blur', glass.blur);
    }

    // 12. Touch targets
    Object.entries(this._tokens.touch).forEach(([key, val]) => {
      this._setProp(root, `--touch-${key}`, val);
    });

    // 13. Theme attribute for CSS selectors
    root.setAttribute('data-theme', theme);

    // 14. Set theme transition on body change
    if (!root.hasAttribute('data-theme-initialized')) {
      root.setAttribute('data-theme-initialized', '');
    }
  }

  /** Helper: set CSS property on element */
  _setProp(el, prop, value) {
    if (value !== undefined && value !== null) {
      el.style.setProperty(prop, value);
    }
  }

  /** Convert {r, g, b, a} object to rgba() string */
  _rgba(color) {
    if (typeof color === 'string') return color;
    if (color && color.r !== undefined) {
      return `rgba(${color.r}, ${color.g}, ${color.b}, ${color.a !== undefined ? color.a : 1})`;
    }
    return null;
  }
}

// Singleton instance
const themeManager = new ThemeManager();
export default themeManager;
export { ThemeManager };
