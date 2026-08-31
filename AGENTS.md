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
| Vitest (unit + integration) | `tests/unit/`, `tests/integration/` | ✅ ~790 tests — `hookTimeout`/`testTimeout` 60s + `pool: forks` (F1 2026-08-10, elimina flakiness). *El conteo real lo da `npm run test`)* |
| Playwright (e2e) | `tests/e2e/` | ⏳ **En progreso** — carpeta vacía, sin `playwright.config`. Los e2e reales hoy son scripts manuales en `scripts/e2e-*.mjs` (requieren server arriba) |

## 2b. FASE 2 — CONTRATOS DE DATOS (2026-08-06)

Decisiones SSOT documentadas en código (NO romper en FASE 3):

| Área | Contrato |
|------|----------|
| **Fecha local** | `src/core/config/local-date.ts` (client) + `scripts/date-utils.mjs` (Node). `BUSINESS_TIMEZONE='America/La_Paz'` (UTC-4 fijo). NUNCA `toISOString().split('T')[0]` para "hoy" local.<br>• `Día laboral (Opción B 2026-08-19): inicia 15:00, termina 06:00 (+1). businessDayExpr/businessDayDateStr en server/utils/date-utils.js (+ cliente src/core/config/local-date.ts, sync manual). BUSINESS_DAY_START_HOUR env (fallback 15). Cortes y reportes agrupan por día laboral; los pedidos/meseros siguen usando fecha calendario local.` |
| **Precios** | `server/services/order-pricing.js` (`resolveModifierAdjustment`, `recalcOrder`). Precio SIEMPRE del server (`menu_items.price` + ajustes por nombre de opción); el server IGNORA precios del cliente. |
| **Regla de cobro (v14 2026-08-28)** | **REGLA SIMPLE SSOT:** `(Efectivo entregado + QR pagado) − (Cambio efectivo + Cambio QR) = Monto del pedido`. El mesero decide el reparto del vuelto; el sistema valida que la resta cuadre (función `validateChangeRule` en `src/pwa/_shared/utils/paymentAllocations.ts`). Restricciones: `changeCash ≤ cashGiven` (el vuelto en efectivo sale del efectivo recibido); `changeQr` es un **RETIRO del local** (`transferOut`) → NO limitado a lo pagado por QR. Cubre todos los combos: pago QR→vuelto efectivo, pago efectivo→vuelto QR (retiro), mixto→mixto. El server valida en `payment-calculator.js` (`calculateMixedPayments`/`calculatePayment`). **Los retiros QR (amount negativo) NO descuentan el pago del pedido** — solo los montos positivos cuentan para `paidAmount`, así un pedido pagado con cash + retiro QR queda `paid`. `safeId()` reemplaza `crypto.randomUUID()` para contextos no-seguros (IP LAN/Tailscale). **Un solo modelo de cobro:** Meseros (`PaymentPanel`) y **Caja (`CollectView`) reutilizan el MISMO `PaymentPanel`** (Opción A 2026-08-28) — el cajero al pulsar "Cobrar" abre el panel con cambio editable efectivo/QR. **`MoneyInput` soporta decimales** (input controlado con texto interno — se puede pagar Bs 70,50; antes se "comía" el punto/comma). |
| **Comprobantes QR (FASE 5)** | `proofPhotos` (pago QR) y `changeQrPhotos` (retiro QR) — **arrays, se pueden subir VARIOS** comprobantes del mismo pago (`POST /api/payments/:id/proof` con `{image: dataURL}`). Se comprimen a ≤1280px JPEG q0.8 en el cliente (`compressImageToDataUrl`). Se suben al **primer pago QR del pedido** (no por transacción, evita duplicados). Solo aplica a `method='qr'`; `proof_photo` se guarda en `data/payment-proofs/` y se sirve con auth (`GET /api/payments/:id/proof/content`). **v14 (2026-08-29): `content?proof_id=` sirve UN comprobante específico; `GET /:id/proof` ya devuelve TODOS (`proofs[]`). OrderHistoryView muestra TODOS los comprobantes con lightbox navegable (‹ › / "2 de 4").** |
| **Historial por día (v14 2026-08-29)** | Admin ve días ANTERIORES: `BusinessDayPicker` global en el topbar → `OrderHistoryView` (pedidos), `PaymentsView` (pagos con `dateFrom/dateTo`), `ReportView` (cierres), `DashboardView` usan el día laboral seleccionado. El server ya soportaba `?date=`/`business_day`. |
| **Menú en vivo (v14 2026-08-29)** | Admin edita el menú → evento `menu_changed` por WebSocket (`broadcastMenuChanged` en order-broadcaster.js, disparado por middleware en menu.js tras mutadores 2xx) → `useKDSWebSocket` acepta `menu_changed` (sin orderId) y `OrderPanel` refetchea categorías+items sin perder el carrito. Sin aumento de rate limits (WS = costo cero). |
| **Estadísticas (v14 2026-08-29)** | Vista Admin → **Estadísticas** (`StatsView`): rango de fechas (día laboral), KPIs (ventas, pedidos, ticket promedio vía `sales/range`), Top productos por **cantidad** y por **ingresos** (`items/popular` con `order_by=quantity|revenue`), por **categoría** (`group_by=category`) para stock, export CSV (`csvExport.ts`). |
| **Promos data-driven (v15 2026-08-29)** | Promos y extras ya NO viven solo en código: Admin los gestiona en **Promos** (armador items/grupos + precio + toggle; **sin programador de días** — se activan/desactivan a mano) y **Extras por grupo** (botón "Agregar extra" en Menú → subgrupo en la card). Schema v15 (`promos`, `promo_lines`, `promo_schedule`, `category_extras`). Server: `promos-service.js`/`extras-service.js` + CRUD `/api/promotions/admin` y `/api/extras/:cat`. `seedDefaultPromos()` migra las 6 promos del SSOT a la DB al bootstrappear (idempotente, `active=0` hasta activarlas; Shot/Escarchado → extras del grupo Micheladas). `GET /api/promotions` fusiona DB+SSOT. `order-pricing.js` valida packs DB (max_per_order + líneas). Meseros consumen `useActivePromos` (API + fallback SSOT). Cambios de promos/extras → `menu_changed` (debounce 1s) → refetch en todos los PWAs. |
| **Sync push** | `server/routes/sync.js`: idempotente por UUID cliente (`orders.id`/`payments.id` → `skipped` + `duplicate_*_already_exists`). Errores parciales → HTTP 200, `success:false`, `code:'SYNC_PARTIAL_ERRORS'`. **Offline UI (v14 2026-08-28):** el `SyncEngine` (`src/core/engine/SyncEngine.ts` + `SyncQueue` IndexedDB) ahora ESTÁ cableado a la UI de meseros vía `useOfflineSync` (`src/pwa/_shared/hooks/useOfflineSync.ts`): si `navigator.onLine === false`, el pedido se **encola** (`create_order`) y se envía con `sync/push` al reconectar (reintento con backoff). El flujo ONLINE es idéntico (POST directo a /api/orders). Banner "Sin conexión — pedidos se guardan y se envían al reconectar" + contador de pendientes. |
| **PUT /orders/:id** | INCREMENTAL: item con `id` → update; sin `id` → insert; `remove_item_ids` → delete explícito; NO mencionados → se conservan. Pedido `paid`/`cancelled` → `409 ORDER_CLOSED`. |
| **Pedido activo por mesa** | `server/services/client-orders.js`: máx. 1 pedido activo por mesa. OTRO `session_id` → `409 TABLE_HAS_ACTIVE_ORDER`; MISMO `session_id` → permitido. |
| **Broadcast KDS** | `server/services/order-broadcaster.js` → `broadcastOrderCreated` emite status REAL (`called` para pedidos del cliente; KDS los filtra hasta `confirmed`). KDS nunca muestra `called` (getKDSOrders). |
| **Nº de mesas (SSOT)** | `src/core/config/app.config.ts` → `capacity.totalTables` (=10). Server lee `DEFAULT_TABLES` env con fallback al SSOT (ver `server/db/bootstrap.js` + `seed.js`). |
| **DEFAULT_TABLES (.env)** | `DEFAULT_TABLES` en `.env` debe coincidir con `capacity.totalTables` del SSOT (10). GET /api/tables expone `capacity.totalTables` real (= nº de filas en `tables`); si `.env` difiere del SSOT, el seed lo sobreescribe y el cliente puede ver mesas de más/menos. |
| **DB** | SQLite (better-sqlite3). NO postgres. `.env` → `DB_PATH` (default `data/rey-de-la-chelada.db`). |
| **Menú (SSOT)** | `src/core/data/menu-seed.json` = **102 líneas explícitas / 18 categorías reales**: BAR 69 (63 bebidas + 6 promociones), COCINA 33 según los productos enumerados. La suma literal del catálogo es 102; el requerimiento menciona 32/101, una discrepancia que debe resolverse antes de retirar un producto explícito. Hay 1 manual (`Churrasco Italiano`), 5 pizzas con **precio base (`Mediana`) + ajuste `Familiar` en `modifier_options`** (Opción B 2026-08-25: `item.price` = Mediana, el incremento Familiar es un `price_adjustment` editable en admin por pizza — Elegida +2500, La Rey +4000, Vegetariana +3500, La Tóxica +4000, Hawaiana +3700), y todos los importes están en centavos. El bootstrap carga solo el seed y nunca aplica precios demo. |

| **Gestión de menú (MENU_MANAGEMENT)** | `MENU_MANAGEMENT` en `.env` controla quién es dueño del menú. `seed` (default/DEV): el bootstrap importa el seed en cada arranque (upsert + reconciliation — el seed es la autoridad). `admin` (PROD): el seed solo se importa la PRIMERA vez (DB vacía); después el **admin UI gestiona** (crear/editar/activar/desactivar/borrar items y apartados, precios, tamaños) y los reinicios NO pisan ediciones. El admin tiene vistas `Menú` (CRUD items + botón "Importar del seed") y `Apartados` (CRUD categorías). Borrado físico solo sin pedidos (409 si tiene) / categoría vacía (409 si tiene items). `POST /api/menu/import-seed` trae SOLO items/categorías NUEVOS del seed (nunca pisa existentes). **Flujo de actualizaciones de menú dev→prod:** 1) mejorar el seed en DEV (formato fijo de `menu-seed.json`) → push → pull en PROD (baja código) → 2) en el admin de PROD: "Importar del seed" para traer items nuevos (no pisa tus precios/editados). El seed de GitHub NO se re-importa automáticamente en PROD. |
| **Settings / Configuración (v14)** | `server/services/settings.js` + tabla `settings` (key-value, schema v14). Keys: `nit, business_name, address, phone, slogan, iva_rate, printer_name, paper_width`. **Los valores DB GANAN sobre el SSOT app.config** (fallback). Endpoints `GET/PUT /api/settings` (solo admin). Admin UI → vista `Configuración` (banner "Completa el NIT" hasta guardarlo). |
| **Impresión térmica (v14)** | **Server-side, solo Caja.** `POST /api/print/ticket {orderId, paymentId?}` (admin/caja), `POST /api/print/invoice {orderId, customerNit, customerName}` (FACTURA — monto/items del pedido, solo pide NIT+Razón Social), y `POST /api/print/test` (admin). Genera ESC/POS en `server/services/ticket-escp.js` (`buildTicketEscp`/`buildInvoiceEscp`, 80mm default / 58mm configurable, corte + QR SIN) y envía bytes RAW a la impresora **predeterminada de Windows** (o `printer_name` de settings) vía `scripts/print-raw.ps1` (P/Invoke winspool, sin deps nativas). El hook cliente `usePrinter.ts` quedó como stub legacy. **Factura:** eliminada la pestaña "Facturación" de Caja; ahora se emite desde **Pedidos → pedido → "Emitir factura"** (`InvoiceModal` en `OrderHistoryView`), con monto/items del server. |
| **Backup DB (v1.5)** | `scripts/backup-db.mjs` — backup WAL-safe con API `backup()` de better-sqlite3 + verificación `integrity_check` + prune 7 días. `scripts/backup.bat` delega en él. NUNCA copiar el `.db` crudo en caliente (producía backups vacíos de 4KB). Tarea `ReyChelada-Backup` 01:00 (registrada por `scripts/install-autostart.bat`). |

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
│   ├── backup.bat          ← backup diario DB (delega en backup-db.mjs)
│   ├── backup-db.mjs       ← backup WAL-safe (better-sqlite3 backup API + integrity + prune 7d) — v1.5
│   ├── print-raw.ps1       ← envía bytes ESC/POS a la impresora default Windows (winspool P/Invoke) — v14
│   ├── sync.bat            ← sync con ecosistema FORCH.iA
│   ├── start-hidden.vbs    ← arranque oculto real del server (sin ventana)
│   ├── startup-runner.bat  ← auto-arranque al login (creado por install-autostart.bat)
│   ├── install-autostart.bat ← crea .lnk de Startup (server+watchdog) + tarea backup 01:00 — v14
│   ├── watchdog.ps1        ← watchdog: /health cada 5 min, relanza si cae (3 fallos)
│   ├── watchdog-start.bat  ← lanza watchdog en segundo plano
│   ├── watchdog-stop.bat   ← detiene watchdog (crea watchdog.stop)
│   ├── date-utils.mjs      ← fecha local America/La_Paz (FASE 2, Node)
│   ├── cleanup-placeholder-data.mjs ← limpia menú placeholder genérico (FASE 2)
│   ├── verify-pwas.mjs     ← verifica que las 6 PWAs respondan (requiere server arriba)
│   └── e2e-*.mjs / debug-*.mjs / smoke-*.mjs ← utilidades dev/QA
├── src/
│   ├── core/
│   │   ├── config/         ← SSOT Config (app.config, pwa-registry, capabilities, security)
│   │   ├── data/           ← SSOT menú oficial (menu-seed.json → 102 líneas, 18 categorías)
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
| `docs/ARQUITECTURA_Y_PRODUCCION.md` | **⭐ ARRANCA AQUÍ en sesión fresca** — arquitectura, deps, .env, DB, endpoints, runbook PC nueva, ciclos dev→prod |
| `docs/PRODUCCION_PC_NUEVA.md` | **🎯 RUNBOOK RESUMIBLE POR OPENCODE** — si el usuario pide "instala este proyecto para llevarlo a producción", sigue ESTE documento de principio a fin |
| `docs/LAUNCHERS.md` | Accesos HTML de las PWAs (doble clic) — cómo usarlos y regenerarlos si cambia la IP |
| `SPEC_INICIAL.md` | Especificación completa del proyecto |
| `DESIGN.md` | Design tokens 3 capas |
| `VALIDATION_GATES.md` | 15 gates (5 restaurant-specific) |
| `constitution.md` | 10 artículos inmutables |
| `docs/MANUAL_DE_INSTALACION.md` | Instalación PC nueva (`scripts\setup.bat`) |
| `docs/MANUAL_DE_USUARIO.md` | Manual de uso (6 PWAs, PINs, flujos) |

### ⚠️ INSTRUCCIÓN PARA OPENCODE (leer automáticamente)

> **Si el usuario dice "instala este proyecto para llevarlo a producción", "ponerlo en produccion", "desplegar en la PC nueva", "lleva esto a produccion", "tutorial de produccion" o similar →**
> **ABRE Y SIGUE `docs/PRODUCCION_PC_NUEVA.md` ENTERO.**
> Ese documento es el runbook paso a paso con las fases, los comandos exactos y los puntos en los que DEBES preguntar al humano (marcados ⚠️). No improvises: usa ese runbook.
> Al inicio, **pregunta al humano cómo llegó el código** (¿`git clone` o zip/.rar desde pendrive?) — afecta si `scripts\update.bat` funcionará después (ver "NOTA — Formato de despliegue" del runbook).

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
