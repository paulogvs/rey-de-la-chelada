# OD Redesign Contract — Rey de la Chelada

> **Contrato de integración con Open Design (OD).**
> Este documento define EXACTAMENTE qué puede tocar OD y qué está PROHIBIDO.
> Regla del ecosistema: `opendesign-boundary-enforcement` (mandatory).
> Se aplica en CADA run de OD y en cada integración manual. No es negociable.

---

## 1. ALLOWLIST — lo que OD/la integración PUEDE tocar

```
src/ui/tokens/tokens.json            (SOLO: refinar radii, shadows, motion, typography — NUNCA colores)
src/ui/components/**                 (17 componentes compartidos — CSS/JSX visual, sin cambiar props)
src/pwa/clientes/**                  (MenuPage, OrderTrackingPage, MenuChrome, ItemDetailModal, App, css)
src/pwa/meseros/**                   (App, TablesView, OrderPanel, PaymentPanel, WaiterCallsBoard)
src/pwa/cocina/** + src/pwa/bar/**   (App + index.html — la lógica vive en KDSBoard compartido)
src/pwa/caja/**                      (App, SummaryView, ClosingView, InvoiceView)
src/pwa/admin/**                     (App + views/ + App.css + views/views.css)
src/pwa/_shared/components/**        (PwaLayout, LoginScreen — SOLO CSS/JSX visual)
src/pwa/*/index.html                 (SOLO: meta theme-color, fonts <link> — nunca scripts)
src/ui/tokens/tokens.css             (regenerado desde tokens.json — no editar directo)
```

## 2. DENYLIST — PROHIBIDO (ni OD ni la integración lo toca)

```
src/core/engine/**        Motor de datos SSOT (Table, Menu, Order, orderEngine)
src/core/config/**        app.config, pwa-registry, capabilities, security, device-adapter, iva
src/core/types/**         Tipos compartidos
server/**                 Express API, DB, rutas, auth, WS
tests/**                  tests de lógica (unit/integration/e2e)
constitution.md           Inmutable (requiere ADR + aprobación humana)
package.json / package-lock.json
vite.config.ts            Multi-PWA build — NO SE TOCA
ecosystem.config.js       PM2
data/  .env*  secrets/    Bases y secretos
```

## 3. Reglas de diseño obligatorias

1. **Cero colores hardcodeados**: ningún hex/rgba nuevo fuera de `tokens.json`. `rgba()` solo vía `color-mix(in srgb, var(--x) N%, transparent)`.
2. **Cero `text-white`/`text-black` hardcodeados** → usar `var(--text-strong)` / `var(--text-inverse)`.
3. **Reutilizar los 17 componentes compartidos** — PROHIBIDO duplicar Button/Card/Badge/Modal/Toast/EmptyState/Loader dentro de PWAs.
4. **No cambiar props ni APIs de hooks** (`useTables`, `useStaffAuth`, `useKDSWebSocket`, `useClientOrder`, etc.) ni la estructura de datos de páginas → OD rediseña **CSS + JSX visual**, nunca contratos de datos.
5. **Tokens del proyecto > cualquier design system OD**: la paleta dorado/ámbar es inmutable; OD aporta tipografía, espaciado, jerarquía, estados y refinamiento premium.
6. **Touch targets**: mín. 48px, primarios 56-64px, KDS 64px — WCAG 2.2 + VALIDATION_GATES.
7. **Animaciones funcionales** con fallback `prefers-reduced-motion` (ya existe en tokens.css).
8. **KDS intacto en lo funcional**: audio, WS, timers, urgent pulse, fullscreen — **solo se mejora CSS**.

## 4. Flujo de aprobación (gobierno del contrato)

```
OD propone (artefacto) → preview URL → USUARIO aprueba/rechaza → integración manual a src/
Cada run de OD = snapshot git (git stash/commit checkpoint) para revertir al instante
Máximo 3 propuestas OD por pantalla — después, control manual del usuario
```

## 5. Gate de verificación post-integración (Phase 7.5)

```powershell
npm run typecheck   # tsc -b — tipos intactos
npm run lint        # eslint src/ — 0 errores
npm run test        # vitest run — 0 fallos (371 tests)
npm run build       # vite build — 6 PWAs generadas
```

**Gate anti-hex-hardcodeado** (debe dar ≤ los archivos legacy conocidos, y al cierre 0):
```powershell
rg -n "#[0-9a-fA-F]{3,8}\b|rgba?\(" src --glob "*.{tsx,ts,css}" -g "!**/tokens.json" -g "!**/theme.js" -g "!**/tokens.css"
```

## 6. Git por PWA (revert aislado)

```bash
git checkout -b redesign/<pwa>          # ej: redesign/clientes
git add src/ui/components src/pwa/<pwa> src/ui/tokens
git commit -m "feat(ui): rediseño premium <pwa> (aprobado, tokens-only)"
# Al final: merge a main vía PR con tests pasando
```

---

*Contrato forzado por @forchi — FORCH.iA | Rey de la Chelada | Built with FORCH.i by Paulo Velasco*
