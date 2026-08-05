# AGENTS.md — Rey de la Chelada

> **SSOT — Este archivo GANA sobre cualquier otro.**
> Creado: 2026-07-29 | Versión: 1.2.0 | Stack: React 19 + Express 5 + SQLite + Multi-PWA
> Actualizado: 2026-08-05 — Scripts reordenados a scripts/ (v1.4)

---

## 1. COMMANDS

| Comando | Descripción |
|---------|-------------|
| `npm run dev` | Inicia servidor de desarrollo (Vite) |
| `npm run build` | Build de producción |
| `npm run test` | Ejecuta todos los tests |
| `npm run lint` | ESLint check |
| `npm run dev:server` | Inicia servidor Express |
| `npm run setup` | `scripts\setup.bat` — instalación en PC nueva |
| `npm run update` | `scripts\update.bat` — auto-update desde GitHub |
| `scripts\start.bat` | Inicia el servicio (oculto) |
| `scripts\stop.bat` | Detiene el servicio (libera puerto) |
| `scripts\backup.bat` | Backup diario de la DB |
| `scripts\sync.bat` | Sync con ecosistema FORCH.iA |

## 2. TESTING

| Framework | Ubicación |
|-----------|-----------|
| Vitest | `tests/unit/`, `tests/integration/` |
| Playwright | `tests/e2e/` |

## 3. PROJECT STRUCTURE

```
rey-de-la-chelada/
├── AGENTS.md               ← SSOT
├── constitution.md          ← Artículos inmutables
├── DESIGN.md                ← Design tokens (paleta dorado/ambar)
├── SPEC_INICIAL.md          ← Especificación original
├── VALIDATION_GATES.md      ← 15 gates (5 restaurant-specific)
├── forchi-brand.md          ← Nivel 2
├── branding.json            ← Brand tracking
├── ecosystem.config.js      ← PM2 config
├── elevate.vbs             ← Elevación UAC (para setup bootstrap manual)
├── scripts/                 ← TODOS los .bat (setup, update, start, stop, backup, sync)
│   ├── setup.bat           ← instalación PC nueva (auto-eleva, clona, instala, build, arranca)
│   ├── update.bat          ← auto-update desde GitHub (pull→install→build→restart real)
│   ├── start.bat           ← inicia el servicio (oculto)
│   ├── stop.bat            ← detiene el servicio
│   ├── backup.bat          ← backup diario DB
│   ├── sync.bat            ← sync con ecosistema FORCH.iA
│   └── start-hidden.vbs    ← arranque oculto (sin ventana)
├── src/
│   ├── core/
│   │   ├── config/         ← SSOT Config (app.config, pwa-registry, capabilities, security)
│   │   ├── engine/         ← SSOT — motor de datos único (Table, Menu, Order)
│   │   └── types/          ← Tipos compartidos (Table, Order, MenuItem, KDS, etc.)
│   ├── modules/
│   │   ├── salon/          ← Mesas (10), TableGrid
│   │   ├── orders/         ← Pedidos, KDS
│   │   ├── menu/           ← Productos, precios
│   │   ├── payments/       ← QR, efectivo, POS
│   │   ├── inventory/      ← Stock, recetas
│   │   ├── staff/          ← Roles, turnos
│   │   ├── reports/        ← Corte de caja
│   │   └── sync/           ← Offline sync
│   ├── ui/
│   │   ├── components/     ← Shared components
│   │   ├── pages/          ← Views
│   │   └── tokens/         ← Design tokens dinámicos (tokens.json → theme.js)
│   └── pwa/                ← Multi-PWA entry points
│       ├── _shared/        ← Bootstrap, hooks, layouts compartidos
│       ├── clientes/       ← Menú Digital (público)
│       ├── cocina/         ← KDS Cocina
│       ├── bar/            ← Barra
│       ├── meseros/        ← Mesas + pedidos
│       ├── caja/           ← Corte de caja
│       └── admin/          ← Administración
├── server/                 ← Express API (multi-PWA routing)
├── tests/
├── docs/
├── legal/
└── logo/                   ← rey_de_la_chelada_logo.png
```

## 3b. MULTI-PWA ARCHITECTURE

La app sirve **6 PWAs independientes** desde un mismo servidor (monolito):

| PWA | Ruta | Propósito | Perfil visual |
|-----|------|-----------|---------------|
| **Clientes** | `/clientes/` | Menú digital público | minimal, portrait |
| **Cocina** | `/cocina/` | KDS Kitchen Display | fullscreen, kds |
| **Bar** | `/bar/` | Órdenes de barra | kds, landscape |
| **Meseros** | `/meseros/` | Mesas + pedidos + cobros | touch, standalone |
| **Caja** | `/caja/` | Corte de caja | default |
| **Admin** | `/admin/` | Configuración + reportes | default |

Cada PWA comparte el mismo motor SSOT (`src/core/engine/`) y configuración global (`src/core/config/`), pero tiene su propio manifest, service worker y entry point.

### Seguridad del módulo clientes
- "El pedido activo es el permiso" — sin pedido activo, solo menú en modo lectura
- QR token de 3h se renueva automáticamente con pedido activo
- No requiere WiFi ni IP tracking

## 4. CODE STYLE

| Concepto | Regla |
|----------|-------|
| Variables/funciones | `camelCase` |
| Componentes React | `PascalCase` |
| Constantes | `UPPER_SNAKE_CASE` |
| Archivos | `kebab-case` |
| APIs/Rutas | `kebab-case` |
| DB | `snake_case` |
| Máximo líneas/archivo | 300 |
| Touch targets | Mínimo 48px |

## 5. GIT WORKFLOW

```
Branches: feature/, fix/, hotfix/, docs/, refactor/
Commits: Conventional Commits (feat:, fix:, docs:, refactor:, test:)
Protección: main requiere PR + tests pasando + 1 review
```

## 6. BOUNDARIES — DO NOT MODIFY

| Archivo/Carpeta | Razón |
|-----------------|-------|
| `node_modules/` | Gestionado por package manager |
| `.env*`, `secrets/` | Secrets Boundary |
| `data/` | SQLite databases |
| `package-lock.json` | Solo vía npm install |
| `constitution.md` | Requiere ADR + aprobación humana |
| `ecosystem.config.js` | PM2 config — editar con cuidado |

## 7. DOCUMENTOS ESTRATÉGICOS

| Documento | Contenido |
|-----------|-----------|
| `SPEC_INICIAL.md` | Especificación completa del proyecto |
| `DESIGN.md` | Design tokens 3 capas |
| `VALIDATION_GATES.md` | 15 gates (5 restaurant-specific) |
| `constitution.md` | 10 artículos inmutables |

## 8. CONTACTO

| | |
|---|---|
| **Ecosistema** | FORCH.iA |
| **Agente maestro** | `@forchi` |
| **Autor** | Paulo Velasco — Bolivia |
| **Hub** | https://forch-i-a-hub.vercel.app/ |
| **Repositorio** | https://github.com/paulogvs/rey-de-la-chelada |

---

*FORCH.i by Paulo Velasco | Built with FORCH.i by Paulo Velasco | https://forch-i-a-hub.vercel.app/*
