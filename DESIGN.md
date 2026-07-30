---
version: v2.0
name: rey-de-la-chelada-design-system
description: >
  Multi-PWA visual identity for Rey de la Chelada Restaurant Management System.
  6 independent PWAs (Clientes, Cocina, Bar, Meseros, Caja, Admin) each with
  a distinct visual personality sharing a common token system.
  Built with FORCH.i by Paulo Velasco.
---

# Rey de la Chelada — DESIGN.md

> **Visual system for Rey de la Chelada Restaurant Management System.**
> Este archivo define la identidad visual de esta app.
> Los agentes de IA lo leen para generar UI consistente con la marca.
>
> **Jerarquía de Marca:**
> ```
> FORCH.i                    ← Marca madre (Paulo Velasco, Bolivia)
> └── FORCH.iA               ← Vertical IA + Apps
>     └── Rey de la Chelada  ← Identidad propia + badge "Built with FORCH.i"
> ```

---

## 0. DYNAMIC TOKEN SYSTEM — CRITICAL ARCHITECTURE

> **Esta app NO tiene colores hardcodeados. NUNCA.**
> Todos los valores visuales se definen en `src/ui/tokens/tokens.json` y se aplican como CSS custom properties.
> Si cambias el JSON → TODA la app se actualiza (colores, bg, dark mode, espaciados, tipografías).

```
tokens.json (DATA fuente — el único lugar con hex values)
    ↓  theme.js aplica en runtime
CSS Custom Properties (--dorado-rey, --bg, --surface, --text, etc.)
    ↓  Componentes las consumen
UI (NUNCA hex/rgb/hsl directo — solo var(--variable))
```

### Dark Mode = Default
- Entorno de restaurante = poca luz → **dark mode es el canvas por defecto**
- Light mode disponible para administración desde PC con luz natural
- Transición: 600ms entre temas, nada abrupto
- Background dinámico: `--bg` cambia con el tema, todo se ajusta armónicamente

### Paleta Cambiable en Tiempo Real
- `themeManager.setPalette('otra-paleta')` → toda la UI se actualiza
- `themeManager.toggleTheme()` → dark/light mode con transición
- Las paletas se definen en `tokens.json.palettes` — puedes tener múltiples

### Module-Specific CSS Targeting
Cada PWA aplica un atributo `data-pwa` y `data-theme-variant` en `<html>`:
```css
/* Ejemplo: targeting por módulo */
[data-pwa="cocina"] { background: var(--kds-bg); }
[data-pwa="clientes"] { max-width: 480px; margin: 0 auto; }
```

---

## 0.1 MULTI-PWA THEME VARIANTS

Cada PWA tiene una personalidad visual distinta. Todas comparten el mismo sistema de tokens pero cambian layout, densidad, énfasis cromático y tipografía.

### Clientes — Menú Digital (Minimal Editorial)
| Atributo | Valor |
|----------|-------|
| **Inspiración** | Notion — editorial, clean, warm |
| **Display** | `standalone`, portrait |
| **Fondo** | `var(--bg)` oscuro, tarjetas `var(--surface)` |
| **Tipografía** | Serif headings (`var(--font-display)`), sans-serif body |
| **Layout** | Single column, max-width 480px, bottom nav |
| **Touch** | Scroll suave, tap para detalle, swipe para categorías |
| **Personalidad** | Cálida, acogedora, premium pero accesible |

### Cocina — KDS (Industrial)
| Atributo | Valor |
|----------|-------|
| **Inspiración** | Stripe dashboard — precision, data-first |
| **Display** | `fullscreen`, landscape |
| **Fondo** | `var(--kds-bg)` negro puro |
| **Tipografía** | Mono (`var(--font-mono)`) para toda la UI, 24px base |
| **Layout** | Grid de 2-4 columnas, sin scroll, cards grandes |
| **Colores** | Alto contraste, alerts pulsantes, urgent = rojo |
| **Personalidad** | Industrial, precisa, sin adornos |

### Bar — Bar Display (Dark Amber)
| Atributo | Valor |
|----------|-------|
| **Inspiración** | Raycast — dark, developer, minimal |
| **Display** | `fullscreen`, landscape |
| **Fondo** | `var(--bg)` con acentos `var(--ambar-cerveza)` |
| **Tipografía** | Mono combinado con sans-serif |
| **Layout** | Grid de órdenes con filtro por tipo |
| **Colores** | Amber vibrante como acento principal |
| **Personalidad** | Energética, vibrante, profesional |

### Meseros — Waiter Tablet (Touch Premium)
| Atributo | Valor |
|----------|-------|
| **Inspiración** | Apple — minimal, touch, premium |
| **Display** | `standalone`, any orientation |
| **Fondo** | `var(--surface-soft)` con glassmorphism |
| **Tipografía** | Sans-serif bold, tamaños grandes |
| **Layout** | Table grid + bottom panels, touch targets 56px+ |
| **Colores** | Dorado como acento premium, verde para confirmar |
| **Touch** | Swipe, tap, long-press, haptic simulation |
| **Personalidad** | Premium, robusta, intuitiva |

### Caja — Cash Closing (Financial Precision)
| Atributo | Valor |
|----------|-------|
| **Inspiración** | Stripe — precision, data-first, financial |
| **Display** | `standalone`, any orientation |
| **Fondo** | `var(--surface)` con `var(--verde-esmeralda)` accents |
| **Tipografía** | Mono para números, sans-serif para labels |
| **Layout** | Data-dense, cards de resumen, tablas |
| **Colores** | Verde para positivos, rojo para negativos |
| **Personalidad** | Precisa, confiable, profesional |

### Admin — Administration (Dev Dashboard)
| Atributo | Valor |
|----------|-------|
| **Inspiración** | Vercel — dev-tool, complete, sidebar |
| **Display** | `standalone`, any orientation |
| **Fondo** | `var(--bg)` con sidebar `var(--surface)` |
| **Tipografía** | Sans-serif, data-viz con mono |
| **Layout** | Sidebar nav + main content area |
| **Colores** | Full palette, charts, status indicators |
| **Personalidad** | Completo, potente, analítico |

---

## 1. Visual Theme & Atmosphere

| Atributo | Valor |
|----------|-------|
| **Mood** | Cálido, premium, acogedor con identidad de bar/restaurante |
| **Density** | Espacioso con tarjetas grandes — touch-first para meseros |
| **Philosophy** | "Donde las mejores historias comienzan con una chelada." |
| **Inspiration** | Bares premium, restaurantes tradicionales, tabernas modernas |
| **Vibe** | Dorado, amaderado, cervecero — identidad de rey |

**Dark mode es el DEFAULT** — el entorno del restaurante es de baja luz.
La app debe ser legible en condiciones de iluminación variada (luz solar cerca de ventanas, luz tenue en la barra).

---

## 2. Color Palette — Logo Derived

Los colores fueron extraídos del logo de Rey de la Chelada (corona dorada, jarras de cerveza, trigo, fondo de madera oscura).

> **IMPORTANTE**: Ningún componente debe referenciar valores hex. Solo usar `var(--variable)`.
> Los valores exactos están exclusivamente en `src/ui/tokens/tokens.json`.

### Brand Colors (CSS variables — tokens.json es la fuente)

```css
--dorado-rey:         /* Dorado — Primary, royal accents */
--dorado-rey-hover:   /* Hover state */
--dorado-rey-soft:    /* Subtle gold fills */
--madera-oscura:      /* Wood — Dark surfaces, backgrounds */
--ambar-cerveza:      /* Amber — Accent, warnings, warmth */
--crema-espuma:       /* Cream — Text on dark, foam color */
--verde-esmeralda:    /* Green — Success, confirmed, nature */
```

### Surface Colors (Dark — Default)
```css
--bg:             /* Main canvas (dark wood tone) */
--surface:        /* Cards, modals (madera oscura) */
--surface-soft:   /* Subtle background sections */
--surface-elevated:/* Elevated cards, dropdowns */
--border:         /* Gold-tinted hairline */
--border-hover:   /* Hover borders */
```

### Text Colors
```css
--text:           /* Dark mode body (crema espuma) */
--text-strong:    /* Headlines on dark */
--text-muted:     /* Captions */
```

### Status Colors (KDS & Orders)
```css
--status-pending:     /* Amber — pending/ready */
--status-confirmed:   /* Green — confirmed/completed */
--status-cancelled:   /* Red — cancelled */
--status-preparing:   /* Gold — in preparation */
--status-delivered:   /* Emerald — delivered */
```

### KDS (Kitchen Display System) — High Contrast
```css
--kds-bg:             /* Pure black background */
--kds-text:           /* Pure white text */
--kds-urgent:         /* Red alert — order waiting too long */
--kds-warning:        /* Amber — almost ready */
--kds-new-order:      /* Gold flash — new order arrived */
--kds-completed:      /* Green — order finished */
```

### Glassmorphism
```css
--glass-bg:       /* rgba(43, 27, 16, 0.6) */
--glass-border:   /* rgba(212, 175, 55, 0.15) */
--glass-blur:     /* blur(20px) saturate(180%) */
```

---

## 2.1 Loading, Empty & Error States

Cada componente debe implementar estos 3 estados además del estado normal:

### Loading State (Skeleton)
```css
.skeleton {
  background: linear-gradient(90deg,
    var(--surface) 25%,
    var(--surface-elevated) 50%,
    var(--surface) 75%
  );
  background-size: 200% 100%;
  animation: skeleton-pulse 1.5s ease-in-out infinite;
  border-radius: var(--radius-md);
}
```

- Cards skeleton: simular estructura con rectángulos de colores
- Listas skeleton: 3-5 filas con anchos variables
- Botones skeleton: rectángulo del tamaño del botón
- Imágenes skeleton: rectángulo con icono de placeholder

### Empty State
- Mensaje claro + icono representativo
- Botón de acción (recargar, crear, explorar)
- No mostrar tablas/cards vacías — mostrar un estado "vacío" diseñado

### Error State
- Mensaje de error legible (no técnico)
- Botón "Reintentar" prominente
- Opcional: "Reportar problema" para staff
- No perder el contexto — el header y nav deben permanecer

---

## 3. Typography

### Font Families

| Role | Font | Fallback | Usage |
|------|------|----------|-------|
| **Display** | Playfair Display | Georgia, serif | h1, h2, hero titles (Clientes, Admin) |
| **Body** | Inter | -apple-system, sans-serif | All body text, labels |
| **Mono** | JetBrains Mono | SF Mono, monospace | Prices, data, order numbers, KDS |

### Key Measures
- Touch targets minimum: **48px** (WCAG 2.2)
- KDS order number: **48px** — visible across the kitchen
- KDS items: **24px** — readable from distance
- Minimum font: **14px** — nothing smaller anywhere
- Caja data: **14px** mono for dense financial tables

### Type Scale
```css
--text-xs:    0.75rem;   /* 12px — Caption (use sparingly) */
--text-sm:    0.875rem;  /* 14px — Small body (minimum size) */
--text-base:  1rem;      /* 16px — Body */
--text-lg:    1.125rem;  /* 18px — Large body */
--text-xl:    1.25rem;   /* 20px — Subtitle */
--text-2xl:   1.5rem;    /* 24px — h4 */
--text-3xl:   1.875rem;  /* 30px — h3 */
--text-4xl:   2.25rem;   /* 36px — h2 */
--text-5xl:   3rem;      /* 48px — h1 */
```

---

## 4. Component Stylings

### Buttons
- **Primary**: Background `var(--dorado-rey)`, text `var(--madera-oscura)`, 48px min height
- **Secondary**: Border `var(--dorado-rey)`, transparent bg, 48px min height, gold text on hover
- **KDS**: 64px min height, uppercase, bold, full-width tap targets
- **Danger**: Background `var(--status-cancelled)`, white text
- **Ghost**: Transparent, text only, for secondary/inline actions
- **Disabled**: Opacity 0.4, no pointer events

### Cards
- **Menu Item**: Background `var(--surface)`, border `var(--border)`, radius `var(--radius-lg)`, 48px min height
- **KDS Order**: Background `var(--kds-bg)`, colored left border by status (4px), padding `var(--space-6)`
- **Summary Card** (Caja): Background `var(--surface)`, border-left color by metric type, prominent number
- **Staff Card**: Avatar circle + name + role badge, tap for details

### Badge / Pills
- Pill shape, `border-radius: var(--radius-full)`
- Background at 10% opacity of status color
- Text at 100% opacity of status color
- Font: `var(--font-mono)`, uppercase
- Variants: pending (amber), preparing (gold), ready (green), cancelled (red), paid (emerald)

### Table Grid (Meseros)
- 60px circles/squares, background `var(--surface)`, color-coded by status via `var(--status-*)`
- Bold table number centered
- Capacity indicator subtle below
- Touch feedback: scale 0.97 on press
- Selection: gold border highlight

### Navigation
- Bottom nav (phone/tablet): background `var(--glass-bg)` with `backdrop-filter: var(--glass-blur)`
- Sidebar (Admin): background `var(--surface)`, 240px width, icons + labels
- KDS: no navigation — fullscreen orders only
- Active state: `var(--dorado-rey)` underline or background

### Status Indicators
- Circle dot with status color + subtle pulse animation
- Used in: table grid, order lists, KDS cards
- Color-blind friendly: shape + label always accompany color

### Loading Skeleton
- Animated shimmer effect using gradient
- Width varies per line (60%, 80%, 40%, 100%)
- Border radius matches component being skeletonized

### Price Display
- Mono font for numbers
- IVA breakdown collapsible
- Tip line separate (not subject to IVA)
- Large total at bottom

---

## 4.1 Touch Interaction Patterns (Meseros)

### Gestures
| Gesture | Action | Feedback |
|---------|--------|----------|
| **Tap** | Select, confirm | Scale 0.97 → 1.0, 150ms |
| **Long-press** | Context menu (edit, cancel) | Haptic buzz, highlight 300ms |
| **Swipe left** | Quick actions (pay, print) | Card slides, reveals action buttons |
| **Swipe right** | Complete item | Green check animation |

### Haptic Feedback Simulation
```css
.element:active {
  transform: scale(0.97);
  transition: transform 50ms;
}
```

Para dispositivos con soporte:
```javascript
navigator.vibrate?.(10); // Light tap feedback
navigator.vibrate?.(20); // Confirmation
navigator.vibrate?.([30, 50, 30]); // Error
```

---

## 4.2 KDS Specific (Color-Blind Friendly)

### Sound Alerts (Web Audio API)
| Evento | Sonido | Duración |
|--------|--------|----------|
| New order | Double beep (880Hz + 1100Hz) | 300ms |
| Urgent | Continuous pulse (440Hz) | Until acknowledged |
| Order completed | Short chime (660Hz) | 150ms |

### Status Indicators (Color + Shape + Label)
| Estado | Color | Shape | Label |
|--------|-------|-------|-------|
| Pending | `var(--status-pending)` | Circle | "PENDIENTE" |
| Preparing | `var(--status-preparing)` | Square | "PREPARANDO" |
| Ready | `var(--status-confirmed)` | Diamond | "LISTO" |
| Cancelled | `var(--status-cancelled)` | X | "CANCELADO" |
| Urgent | `var(--kds-urgent)` | Star (pulse) | "URGENTE" |

### Order Timer Visual
- Green: < 10 minutes
- Amber: 10-15 minutes  
- Red pulse: > 15 minutes (urgent)
- Timer display: `MM:SS` in mono font, bold when > 10 min

---

## 5. Layout & Responsive

### Touch Targets — CRITICAL
- Minimum: **48px** (WCAG 2.2 mandatory)
- Primary actions: **56-64px**
- KDS buttons: **64px minimum**
- Gap between touchable elements: **8px minimum**

### Grid per PWA
| PWA | Columnas | Ancho máximo | Orientación |
|-----|----------|-------------|-------------|
| Clientes | 1 | 480px | Portrait |
| Cocina | 2-4 | 100vw | Landscape |
| Bar | 2-3 | 100vw | Landscape |
| Meseros | 4-5 (tables) | 100vw | Any |
| Caja | 2-3 (summary) | 1200px | Any |
| Admin | Sidebar + main | 1440px | Landscape |

### 3D Layer System
```
Layer 1 (bg):     z-index 0 — dark wood background (--bg)
Layer 2 (content): z-index 1 — cards, menu items, grids
Layer 3 (floating): z-index 10 — modals, bottom sheets, toasts
Layer 4 (overlay): z-index 100 — KDS alerts, fullscreen modals, loading screens
```

---

## 6. Animation Principles

### Core Rules
- All animations must be **functional** (inform, not entertain)
- No bounce, no parallax, no decorative animation
- All animations MUST respect `prefers-reduced-motion: reduce`
- Maximum animation duration: 800ms (KDS alerts only)
- Default easing: `cubic-bezier(0.16, 1, 0.3, 1)` — smooth deceleration

### Functional Animations

| Animation | Trigger | Duration | Easing |
|-----------|---------|----------|--------|
| `gold-pulse` | New KDS order | 800ms | ease-in-out |
| `red-pulse` | Urgent (>15 min) | 500ms | ease-in-out |
| `slide-in-right` | New card entering | 250ms | ease-out |
| `fade-in-up` | Content appearing | 300ms | ease-out |
| `status-pulse` | Status change | 600ms | ease-in-out |
| `check-success` | Payment complete | 400ms | ease-out |

### Timing Variables
```css
--duration-fast:   150ms;    /* Hover, status changes */
--duration-normal: 250ms;    /* Transitions */
--duration-slow:   400ms;    /* Page transitions */
--duration-alert:  800ms;    /* KDS alert pulses */

/* Easing */
--ease-out:       cubic-bezier(0.16, 1, 0.3, 1);
--ease-in-out:    cubic-bezier(0.4, 0, 0.2, 1);
```

### Reduced Motion
```css
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```

---

## Brand Badge

```html
<div class="forchi-badge">
  <span>Built with</span>
  <a href="https://github.com/paulogvs/FORCH-IA-ECOSYSTEM" target="_blank">
    FORCH.i
  </a>
  <span>by Paulo Velasco</span>
</div>
```

---

*Rey de la Chelada | Built with FORCH.i by Paulo Velasco | Cochabamba, Bolivia*
