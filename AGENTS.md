# AGENTS.md — Rey de la Chelada

> **SSOT — Este archivo GANA sobre cualquier otro.**
> Creado: 2026-07-29 | Versión: 1.2.0 | Stack: React 19 + Express 5 + SQLite + Multi-PWA
> Actualizado: 2026-08-06 — FASE 2 (contratos de datos: §2b) + scripts a scripts/ (v1.4)

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

| Framework | Ubicación | Estado |
|-----------|-----------|--------|
| Vitest (unit + integration) | `tests/unit/`, `tests/integration/` | ✅ 675 tests — `hookTimeout`/`testTimeout` 60s + `pool: forks` (F1 2026-08-10, elimina flakiness) |
| Playwright (e2e) | `tests/e2e/` | ⏳ **En progreso** — carpeta vacía, sin `playwright.config`. Los e2e reales hoy son scripts manuales en `scripts/e2e-*.mjs` (requieren server arriba) |

## 2b. FASE 2 — CONTRATOS DE DATOS (2026-08-06)

Decisiones SSOT documentadas en código (NO romper en FASE 3):

| Área | Contrato |
|------|----------|
| **Fecha local** | `src/core/config/local-date.ts` (client) + `scripts/date-utils.mjs` (Node). `BUSINESS_TIMEZONE='America/La_Paz'` (UTC-4 fijo). NUNCA `toISOString().split('T')[0]` para "hoy" local.<br>• `Día laboral (Opción B 2026-08-19): inicia 15:00, termina 06:00 (+1). businessDayExpr/businessDayDateStr en server/utils/date-utils.js (+ cliente src/core/config/local-date.ts, sync manual). BUSINESS_DAY_START_HOUR env (fallback 15). Cortes y reportes agrupan por día laboral; los pedidos/meseros siguen usando fecha calendario local.` |
| **Precios** | `server/services/order-pricing.js` (`resolveModifierAdjustment`, `recalcOrder`). Precio SIEMPRE del server (`menu_items.price` + ajustes por nombre de opción); el server IGNORA precios del cliente. |
| **Sync push** | `server/routes/sync.js`: idempotente por UUID cliente (`orders.id`/`payments.id` → `skipped` + `duplicate_*_already_exists`). Errores parciales → HTTP 200, `success:false`, `code:'SYNC_PARTIAL_ERRORS'`. |
| **PUT /orders/:id** | INCREMENTAL: item con `id` → update; sin `id` → insert; `remove_item_ids` → delete explícito; NO mencionados → se conservan. Pedido `paid`/`cancelled` → `409 ORDER_CLOSED`. |
| **Pedido activo por mesa** | `server/services/client-orders.js`: máx. 1 pedido activo por mesa. OTRO `session_id` → `409 TABLE_HAS_ACTIVE_ORDER`; MISMO `session_id` → permitido. |
| **Broadcast KDS** | `server/services/order-broadcaster.js` → `broadcastOrderCreated` emite status REAL (`called` para pedidos del cliente; KDS los filtra hasta `confirmed`). KDS nunca muestra `called` (getKDSOrders). |
| **Nº de mesas (SSOT)** | `src/core/config/app.config.ts` → `capacity.totalTables` (=10). Server lee `DEFAULT_TABLES` env con fallback al SSOT (ver `server/db/bootstrap.js` + `seed.js`). |
| **DEFAULT_TABLES (.env)** | `DEFAULT_TABLES` en `.env` debe coincidir con `capacity.totalTables` del SSOT (10). GET /api/tables expone `capacity.totalTables` real (= nº de filas en `tables`); si `.env` difiere del SSOT, el seed lo sobreescribe y el cliente puede ver mesas de más/menos. |
| **DB** | SQLite (better-sqlite3). NO postgres. `.env` → `DB_PATH` (default `data/rey-de-la-chelada.db`). |
| **Menú (SSOT)** | `src/core/data/menu-seed.json` = **112 items / 21 categorías** (BAR 73: Micheladas Signature 8 + Especiales 3, Cheladas 6, Coctelería Clásica 16, Autor Exclusivo 3, Botellas 8, Jarras 4, Shots 3, Artesanal 4, Cerveza 2, Jugos 6, Gaseosas 3, Agua 1, Promociones 6 | COCINA 39: Ensaladas 5, Tablas y Canastas 6, Burgers & Sandwiches 10, Quesadillas 3, Pizzas 4, Empanadas 7, Salsas y Extras 4). 2 manuales `price_variable` (Negra Ahumada, Flor de Caña), 12 con `promo_price` (8 signature → 25, 4 artesanales → 12), 6 promos display `precio:null` (server las rechaza). `seed.js` NO siembra menú genérico (limpiado F1 2026-08-10); `bootstrap.js` carga el menú real vía `load-menu.js`. Precios SIEMPRE del server: `resolveItemUnitPrice` (promo > base > manual > ajuste > 400 PRICE_REQUIRED_MANUAL). |

Scripts nuevos FASE 2: `scripts/cleanup-placeholder-data.mjs` (borra items placeholder del menú genérico sin uso; dry-run por defecto, `--yes` para borrar), `scripts/date-utils.mjs`.

## 3. PROJECT STRUCTURE

```
rey-de-la-chelada/
├── AGENTS.md               ← SSOT
├── constitution.md          ← Artículos inmutables
├── DESIGN.md                ← Design tokens (paleta dorado/ambar)
├── SPEC_INICIAL.md          ← Especificación original
├── VALIDATION_GATES.md      ← 15 gates (5 restaurant-specific)
├── MANUAL_DE_INSTALACION.md ← Guía de instalación/despliegue (Node ≥22.9)
├── MANUAL_DE_USUARIO.md     ← Manual de uso (6 PWAs, PINs, flujos)
├── forchi-brand.md          ← Nivel 2
├── branding.json            ← Brand tracking
├── ecosystem.config.cjs     ← PM2 config (OBSOLETO — el deploy real usa start-hidden.vbs)
├── elevate.vbs             ← Elevación UAC (para setup bootstrap manual)
├── opencode.json            ← Config OpenCode
├── scripts/                 ← TODOS los .bat/.ps1/.mjs (setup, update, start, stop, backup, sync, watchdog)
│   ├── setup.bat           ← instalación PC nueva (auto-eleva, clona, instala, build, arranca)
│   ├── update.bat          ← auto-update desde GitHub (pull→install→build→restart real)
│   ├── start.bat           ← inicia el servicio (oculto)
│   ├── stop.bat            ← detiene el servicio
│   ├── backup.bat          ← backup diario DB
│   ├── sync.bat            ← sync con ecosistema FORCH.iA
│   ├── start-hidden.vbs    ← arranque oculto real del server (sin ventana)
│   ├── watchdog.ps1        ← watchdog: /health cada 5 min, relanza si cae (3 fallos)
│   ├── watchdog-start.bat  ← lanza watchdog en segundo plano
│   ├── watchdog-stop.bat   ← detiene watchdog (crea watchdog.stop)
│   ├── install-backup-schedule.bat ← agenda backup diario 01:00 (schtasks ReyChelada-Backup)
│   ├── date-utils.mjs      ← fecha local America/La_Paz (FASE 2, Node)
│   ├── cleanup-placeholder-data.mjs ← limpia menú placeholder genérico (FASE 2)
│   ├── verify-pwas.mjs     ← verifica que las 6 PWAs respondan (requiere server arriba)
│   └── e2e-*.mjs / debug-*.mjs / smoke-*.mjs ← utilidades dev/QA
├── src/
│   ├── core/
│   │   ├── config/         ← SSOT Config (app.config, pwa-registry, capabilities, security)
│   │   ├── data/           ← SSOT menú real (menu-seed.json → 112 items, 21 categorías)
│   │   ├── engine/         ← SSOT — motor de datos único (Table, Menu, Order)
│   │   └── types/          ← Tipos compartidos (Table, Order, MenuItem, KDS, etc.)
│   ├── modules/
│   │   ├── salon/          ← Mesas (10), TableGrid
│   │   ├── orders/         ← Pedidos, KDS
│   │   ├── menu/           ← Productos, precios
│   │   ├── payments/       ← QR, efectivo, POS
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
├── server/                 ← Express API (multi-PWA routing) + db + scripts
├── tests/                  ← unit + integration (vitest); e2e/ (Playwright — en progreso)
├── docs/
├── legal/
├── backups/                ← backups DB (creados por backup.bat)
├── logs/                   ← app-*.log, watchdog.log, backup.log
├── data/                   ← SQLite DB + prices
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
