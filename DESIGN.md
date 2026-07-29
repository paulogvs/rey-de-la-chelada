---
version: v1.0
name: rey-de-la-chelada-design-system
description: >
  Rey de la Chelada visual identity — warm golden/amber restaurant palette.
  Dark mode default (restaurant environment). Big touch targets for tablets.
  KDS high-contrast display with color-coded status.
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

Los colores fueron extraídos del logo de Rey de la Chelada (corona dorada, jarras de cerveza, trigo, fondo de madera oscura):

### Brand Colors

```css
--dorado-rey:         #D4AF37;    /* Dorado — Primary, royal accents */
--dorado-rey-hover:   #C4A032;    /* Hover state */
--dorado-rey-soft:    rgba(212, 175, 55, 0.12);  /* Subtle gold fills */
--madera-oscura:      #2B1B10;    /* Wood — Dark surfaces, backgrounds */
--ambar-cerveza:      #E08B27;    /* Amber — Accent, warnings, warmth */
--crema-espuma:       #F4E8C1;    /* Cream — Text on dark, foam color */
--verde-esmeralda:    #0D5C3A;    /* Green — Success, confirmed, nature */
```

### Surface Colors (Dark — Default)

```css
--bg:             #1A0F0A;     /* Main canvas (dark wood tone) */
--surface:        #2B1B10;     /* Cards, modals (madera oscura) */
--surface-soft:   #352518;     /* Subtle background sections */
--surface-elevated:#3D2C1C;    /* Elevated cards, dropdowns */
--border:         rgba(212, 175, 55, 0.12);  /* Gold-tinted hairline */
--border-hover:   rgba(212, 175, 55, 0.25);  /* Hover borders */
```

### Text Colors

```css
--text:           #F4E8C1;     /* Dark mode body (crema espuma) */
--text-strong:    #FFFFFF;     /* Headlines on dark */
--text-muted:     rgba(244, 232, 193, 0.55);  /* Captions */
```

### Status Colors (KDS & Orders)

```css
--status-pending:     #E08B27;  /* Amber — pending/ready */
--status-confirmed:   #0D5C3A;  /* Green — confirmed/completed */
--status-cancelled:   #DC2626;  /* Red — cancelled */
--status-preparing:   #D4AF37;  /* Gold — in preparation */
--status-delivered:   #059669;  /* Emerald — delivered */
```

### KDS (Kitchen Display System) — High Contrast

```css
--kds-bg:             #0A0A0A;  /* Pure black background */
--kds-text:           #FFFFFF;  /* Pure white text */
--kds-urgent:         #EF4444;  /* Red alert — order waiting too long */
--kds-warning:        #F59E0B;  /* Amber — almost ready */
--kds-new-order:      #D4AF37;  /* Gold flash — new order arrived */
--kds-completed:      #10B981;  /* Green — order finished */
```

### Glassmorphism

```css
--glass-bg:       rgba(43, 27, 16, 0.6);
--glass-border:   rgba(212, 175, 55, 0.15);
--glass-blur:     blur(20px) saturate(180%);
```

---

## 3. Typography

### Font Families

| Role | Font | Fallback | Usage |
|------|------|----------|-------|
| **Display** | Playfair Display | Georgia, serif | h1, h2, hero titles |
| **Body** | Inter | -apple-system, sans-serif | All body text, labels |
| **Mono** | JetBrains Mono | SF Mono, monospace | Prices, data, order numbers |

### Key Measures
- Touch targets minimum: **48px** (WCAG 2.2)
- KDS order number: **48px** — visible across the kitchen
- KDS items: **24px** — readable from distance
- Minimum font: **14px** — nothing smaller anywhere

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
- **Primary**: Gold background (`#D4AF37`), dark text, 48px min height
- **Secondary**: Gold border, transparent bg, 48px min height
- **KDS**: 64px min height, uppercase, bold

### Cards
- **Menu Item**: Dark surface, gold hairline border, 16px radius, 48px min height
- **KDS Order**: Black bg, colored left border by status, 24px padding

### Table Map
- 64px circles, color-coded by status, white bold numbers

### Navigation
- Sidebar icons (tablet) or bottom nav (phone), glass effect

### Status Badges
- Pill shape, colored bg, JetBrains Mono, uppercase

---

## 5. Layout

### Touch Targets — CRITICAL
- Minimum: **48px** (WCAG 2.2 mandatory)
- Primary actions: **56-64px**
- KDS buttons: **64px minimum**
- Gap between touchable elements: **8px minimum**

### Grid
- Tablet (landscape): 8-column — default for waiters
- KDS: Full-width list, no columns
- POS: 4-column compact

### 3D Layer System
```
Layer 1 (bg):     z-index 0 — dark wood background
Layer 2 (content): z-index 1 — cards, menu items, UI
Layer 3 (floating): z-index 2 — modals, glassmorphism, notifications
```

---

## 6. Motion

### Rules
- All animations must be **functional** (inform, not entertain)
- No bounce, no parallax, no decorative animation
- New KDS order: gold pulse flash
- Urgent KDS order: red pulse
- Status changes: smooth 300ms transitions

### Timing
```css
--duration-fast:   150ms;    /* Hover, status changes */
--duration-normal: 250ms;    /* Transitions */
--duration-slow:   400ms;    /* Page transitions */
--duration-alert:  800ms;    /* KDS alert pulses */
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
