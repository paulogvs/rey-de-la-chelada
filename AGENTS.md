# AGENTS.md — Rey de la Chelada

> **SSOT — Este archivo GANA sobre cualquier otro.**
> Creado: 2026-07-29 | Versión: 1.0.0 | Stack: React 19 + Express 5 + SQLite + PWA

---

## 1. COMMANDS

| Comando | Descripción |
|---------|-------------|
| `npm run dev` | Inicia servidor de desarrollo (Vite) |
| `npm run build` | Build de producción |
| `npm run test` | Ejecuta todos los tests |
| `npm run lint` | ESLint check |
| `npm run dev:server` | Inicia servidor Express |
| `npm run pm2:start` | Inicia con PM2 |
| `npm run setup` | setup.bat |
| `npm run update` | update.bat |

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
├── setup.bat               ← Windows installer
├── update.bat              ← Auto-update
├── backup.bat              ← Daily backup
├── src/
│   ├── core/engine/        ← SSOT — motor de datos único
│   ├── core/types/         ← Tipos compartidos
│   ├── modules/
│   │   ├── salon/          ← Mesas (10), mapa
│   │   ├── orders/         ← Pedidos, KDS
│   │   ├── menu/           ← Productos, precios
│   │   ├── payments/       ← QR, efectivo, POS
│   │   ├── inventory/      ← Stock, recetas
│   │   ├── staff/          ← Roles, turnos
│   │   ├── reports/        ← Corte de caja
│   │   └── sync/           ← Offline sync
│   └── ui/
│       ├── components/     ← Shared components
│       └── pages/          ← Views
├── server/                 ← Express API
├── tests/
├── docs/
├── legal/
└── logo/                   ← rey_de_la_chelada_logo.png
```

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
