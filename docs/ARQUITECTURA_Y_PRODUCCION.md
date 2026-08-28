# 🏗️ Rey de la Chelada — Arquitectura + Runbook de Producción

> **Documento maestro para retomar el proyecto en una sesión fresca.**
> *FORCH.i by Paulo Velasco — Bolivia · https://forch-i-a-hub.vercel.app/*
> **Commit de referencia (HEAD):** `3d1c19f` · **Node:** ≥22.9 (actual: v26.2) · **npm:** 11.x
> **Última actualización:** 2026-08-28

Este documento es la **fuente única de verdad técnica** para entender cómo funciona el sistema a fondo, sus dependencias, y cómo ponerlo en producción (desarrollar + desplegar) en una **computadora nueva**. Complementa (no reemplaza) `AGENTS.md`, `docs/MANUAL_DE_INSTALACION.md` y `docs/MANUAL_DE_USUARIO.md`.

---

## 📑 Tabla de contenidos

1. [Qué es el sistema](#1-qué-es-el-sistema)
2. [Stack tecnológico](#2-stack-tecnológico)
3. [Arquitectura (monolito multi-PWA)](#3-arquitectura-monolito-multi-pwa)
4. [Cómo funciona a detalle](#4-cómo-funciona-a-detalle)
   - [Los 6 PWAs](#41-los-6-pwas)
   - [Flujo de pedido](#42-flujo-de-pedido)
   - [Flujo de pago y cambio](#43-flujo-de-pago-y-cambio)
   - [Corte de caja (día laboral)](#44-corte-de-caja-día-laboral)
   - [Menú: seed vs admin](#45-menú-seed-vs-admin)
   - [Sincronización y tiempo real (WS)](#46-sincronización-y-tiempo-real-ws)
5. [Estructura del repositorio](#5-estructura-del-repositorio)
6. [Dependencias (package.json)](#6-dependencias-packagejson)
7. [Variables de entorno (.env)](#7-variables-de-entorno-env)
8. [Base de datos (SQLite) y contratos](#8-base-de-datos-sqlite-y-contratos)
9. [API REST (endpoints)](#9-api-rest-endpoints)
10. [Scripts de operación](#10-scripts-de-operación)
11. [RUNBOOK: PC nueva — producción paso a paso](#11-runbook-pc-nueva--producción-paso-a-paso)
12. [RUNBOOK: desarrollo (dev)](#12-runbook-desarrollo-dev)
13. [RUNBOOK: ciclos de trabajo (dev→prod)](#13-runbook-ciclos-de-trabajo-devprod)
14. [Verificación (tests / lint / build)](#14-verificación-tests--lint--build)
15. [Solución de problemas frecuentes](#15-solución-de-problemas-frecuentes)
16. [Procedimientos operativos clave](#16-procedimientos-operativos-clave)
17. [Reglas de oro (no romper)](#17-reglas-de-oro-no-romper)

---

## 1. Qué es el sistema

**Rey de la Chelada** es un sistema de gestión para un restaurante/bar en Cochabamba, Bolivia. Es un **monolito self-hosted en Windows** que sirve **6 aplicaciones web progresivas (PWA)** desde un solo servidor Express + SQLite.

Cubre el ciclo completo del restaurante:
- **Cliente**: menú digital, pedido, seguimiento.
- **Cocina y Barra**: pantallas de cocina (KDS) con órdenes en tiempo real.
- **Meseros**: gestión de mesas, pedidos y cobros.
- **Caja**: corte de caja, cobros.
- **Admin**: gestión de menú, personal, reportes.

**Idioma**: código en inglés, interfaz en español. **Modelo mental del dueño**: cada app es la estrella, FORCH.i es el sello de origen.

---

## 2. Stack tecnológico

| Capa | Tecnología | Versión | Nota |
|------|-----------|:---:|------|
| **Runtime** | Node.js | **≥22.9** | Requerido por `--env-file-if-exists=.env` (flag nativo). Actual v26.2 |
| **Frontend** | React | 19 | |
| **Build** | Vite | 6 | Multi-PWA build (genera 6 PWAs + service workers) |
| **PWA** | vite-plugin-pwa + workbox | 1.x / 7.x | Service worker por módulo |
| **Estado** | Zustand | 5 | Estado ligero |
| **Data fetching** | @tanstack/react-query | 5 | |
| **Router** | react-router-dom | 7 | |
| **Backend** | Express | 5 | API REST monolítica |
| **DB** | better-sqlite3 | 13 | SQLite (NO postgres) |
| **Auth** | jsonwebtoken (JWT) + bcryptjs | 9 / 3 | Sesiones por rol (PIN) |
| **Rate limit** | express-rate-limit | 8 | Separado lecturas/escrituras |
| **Seguridad** | helmet + cors | 8 / 2 | |
| **Tiempo real** | ws (WebSocket) | 8 | Broadcaster KDS |
| **Impresora** | esc-pos-printer | 1 | Tickets térmicos |
| **Testing** | Vitest + Playwright | 4 / 1 | unit+integration / e2e (en progreso) |
| **Otros** | zod, uuid, qrcode, date-fns, dexie, idb | — | Validación, ids, QR, fechas, offline/idb |

> ⚠️ **`--legacy-peer-deps` es OBLIGATORIO** en `npm install` (peer deps de React 19 + typescript-eslint chocan).

---

## 3. Arquitectura (monolito multi-PWA)

**Un solo servidor** Express sirve:
1. **La API REST** (`/api/*`) — todos los módulos.
2. **Los 6 PWAs** (`/clientes/`, `/cocina/`, `/bar/`, `/meseros/`, `/caja/`, `/admin/`) — cada uno en su carpeta con su `index.html`, `manifest.json` y `sw.js`.
3. **WebSocket** (`ws://.../meseros`, `/cocina`, ...) — tiempo real KDS.

```
[Browser: 6 PWAs]  ←─HTTP/WS──>  [Express server :3002]
                                     │
                                     ├─ server/routes/*   (API REST)
                                     ├─ server/services/*  (lógica de negocio)
                                     ├─ server/db/*        (better-sqlite3 + schema)
                                     ├─ server/middleware/* (auth, security, rate-limit)
                                     └─ dist/              (build de los 6 PWAs)
```

**Por qué monolito**: un solo proceso, un solo puerto, fácil de desplegar en una PC del restaurante. Los 6 PWAs comparten el mismo motor SSOT (`src/core/`), la misma config (`src/core/config/`) y el mismo backend — solo cambia el entry point, manifest y service worker.

---

## 4. Cómo funciona a detalle

### 4.1 Los 6 PWAs

| PWA | Ruta | Quién lo usa | PIN | Perfil visual |
|-----|------|--------------|:---:|---------------|
| **Clientes** | `/clientes/` | Cliente (público) | — | minimal, portrait |
| **Cocina** | `/cocina/` | Cocinero | `2222` | fullscreen, kds |
| **Bar** | `/bar/` | Bartender | `2222` | kds, landscape |
| **Meseros** | `/meseros/` | Mesero | `1111` | touch, standalone |
| **Caja** | `/caja/` | Cajero | `3333` | default |
| **Admin** | `/admin/` | Administrador | `0000` | default |

> **PINs por rol** (compartidos por rol, configurables): Admin `0000` · Mesero `1111` · KDS `2222` · Caja `3333`. Admin accede a TODAS. Ver `server/db/seed.js` + `server/middleware/auth.js`.

### 4.2 Flujo de pedido

1. **Cliente** abre `/clientes/` → ve el menú → arma pedido → genera un **QR token** (3h) → pin del pedido.
2. **Server** crea el pedido (estado `called`) → **broadcaster WS** lo envía a cocina/barra.
3. **Cocina/Bar (KDS)** ven el pedido → lo marcan `preparing` → `ready` → `/kds-status`.
4. **Mesero** ve el estado en vivo (WS) → entregar → `deliver`.
5. **Mesero** cobra → `PaymentPanel` → el pedido pasa a `paid`, la mesa se libera.

> **Estado de pedido**: `called` → `confirmed` → `preparing` → `ready` → `delivered` → `paid` / `cancelled`. El KDS **nunca muestra `called`** (lo filtra hasta `confirmed`).

### 4.3 Flujo de pago y cambio

En `PaymentPanel.tsx` (meseros), el modelo es **dinámico**:

- **Efectivo** = monto que el cliente entrega en efectivo.
- **QR** = monto pagado por QR.
- **CAMBIO** (card siempre visible): se habilita cuando `Efectivo + QR > Pedido`.
  - `changeAvailable = max(0, Efectivo + QR - Pedido)`.
  - **Ambos inputs (efectivo y QR del cambio) son editables y se recalculan entre sí** (opción A) para que **siempre sumen `changeAvailable`**.
  - Regla de negocio: el cambio por QR **no puede superar lo pagado por QR** (no se "devuelve" por QR algo que no entró por QR). Con QR=0, el cambio es solo en efectivo.
- **Verificación previa al pago**: `lo pagado − el cambio = monto del pedido` (`coversTotal`). Si no cuadra, **no** se habilita "Cobrar" (guard + toast de error).
- **Fotos de comprobante**: se comprimen en el cliente (canvas, max 1280px, JPEG q0.8 → <300KB) y se suben a `POST /api/payments/:id/proof`. **Se limpian automáticamente** si el método de pago/cambio que las generó ya no aplica.

La lógica pura del cambio vive en `src/pwa/_shared/utils/paymentAllocations.ts` (funciones `resolveChangeSplit`, `resolveChangeFromCash`, `resolveChangeFromQr`, `clamp`) — **testeable sin React**. El precio SIEMPRE lo calcula el server (`server/services/order-pricing.js`), nunca el cliente.

### 4.4 Corte de caja (día laboral)

**Día laboral (Opción B):** inicia a las **15:00** y termina a las **06:00 (+1 día)**. `server/utils/date-utils.js` → `businessDayExpr` / `businessDayDateStr` (cliente espejo: `src/core/config/local-date.ts`). Zona: `America/La_Paz` (UTC-4 fijo).

**Cálculos SSOT (v13):**
- **Efectivo del día** = `SUM(received) − SUM(change)` (neto físico del cajón).
- **QR del día** = `SUM(amount)` con `method='qr'` (incluye retiros QR, que son `amount` negativos).
- **Total general** = `opening_cash + cash_today + qr_today`.
- **Efectivo esperado** = `opening_cash + cash_today − gastos_efectivo`.
- **Transacciones** = `COUNT(DISTINCT order_id)` de pagos completados en el día (un pedido = 1 transacción, **no** cada pago).
- **Cuadre**: `difference = actual_cash − expected_cash`; `is_reconciled = |diff| <= 0.01`.

### 4.5 Menú: seed vs admin

Controlado por `MENU_MANAGEMENT` en `.env`:
- `seed` (default/DEV): el bootstrap importa `src/core/data/menu-seed.json` en **cada arranque** (upsert + reconciliation — el seed es la autoridad).
- `admin` (PROD): el seed solo se importa **la primera vez** (DB vacía); después el **Admin UI** gestiona (CRUD items/categorías, precios, tamaños). Los reinicios **no pisan** ediciones.

**Flujo de actualización de menú dev→prod:**
1. Mejorar el seed en DEV (`menu-seed.json`, formato fijo) → push → pull en PROD (baja código).
2. En el admin de PROD: botón **"Importar del seed"** → trae SOLO items/categorías NUEVOS (nunca pisa existentes).

> ⚠️ `DEFAULT_TABLES` en `.env` debe coincidir con `capacity.totalTables` del SSOT (`src/core/config/app.config.ts` = 10). La mesa **0 = BARRA** (section 'barra', capacity 0).

### 4.6 Sincronización y tiempo real (WS)

- **WebSocket** (`ws`) — broadcaster `server/services/websocket-broadcaster.js` + `order-broadcaster.js`. Los PWAs se suscriben (meseros, cocina, bar, caja) para recibir eventos en vivo (`new_order`, `status_change`, `item_ready`, `module_ready`, `order_complete`).
- **Polling** como respaldo — hooks `useTables({pollMs})`, `useWaiterCalls({pollMs})` usan intervalos de respaldo si el WS cae.
- **Offline sync** — `dexie`/`idb` en el cliente para modo offline; `server/routes/sync.js` hace push idempotente por UUID.
- **Service Worker** — cada PWA tiene su SW con `NetworkOnly` para `/api/*` (nunca cachea respuestas de error 401) y `NetworkFirst` solo para navegación + `clientsClaim`/`skipWaiting` inyectados (auto-update sin hard refresh).

---

## 5. Estructura del repositorio

```
rey-de-la-chelada/
├── AGENTS.md                 ← SSOT (GANAS sobre cualquier otro)
├── constitution.md           ← Artículos inmutables
├── DESIGN.md                 ← Design tokens (paleta dorado/ambar)
├── SPEC_INICIAL.md           ← Especificación original
├── VALIDATION_GATES.md       ← 15 gates (5 restaurant-specific)
├── PLAN_MEJORAS.md           ← Tracker de fixes/mejoras aplicadas
├── MANUAL_DE_INSTALACION.md  ← Instalación PC nueva (scripts\setup.bat)
├── MANUAL_DE_USUARIO.md      ← Manual de uso (6 PWAs, PINs, flujos)
├── .env / .env.example       ← Config + secretos (NO en git) / plantilla
├── scripts/                  ← .bat / .ps1 / .mjs operativos
├── server/                   ← Express API + db + middleware + services
├── src/
│   ├── core/                 ← SSOT: config, data (menu-seed), engine, types
│   ├── modules/              ← salon, orders, menu, payments, staff, reports, sync
│   ├── ui/                   ← componentes compartidos + tokens
│   └── pwa/                  ← 6 entry points + _shared
├── tests/                    ← unit/ + integration/ (Vitest) + e2e/ (Playwright)
├── docs/                     ← Documentación técnica (este archivo)
├── legal/                    ← Términos, privacidad, uso aceptable
├── data/                     ← SQLite DB + payment-proofs (fotos)
├── backups/                  ← Copias de seguridad con fecha
├── logs/                     ← app-*.log, backup.log, watchdog.log
└── dist/                     ← Build (6 PWAs) — generado, en .gitignore
```

---

## 6. Dependencias (package.json)

| Grupo | Paquetes | Propósito |
|-------|----------|-----------|
| **Runtime** | `react`, `react-dom`, `react-router-dom`, `zustand`, `@tanstack/react-query` | UI + estado + router |
| **Backend** | `express`, `express-rate-limit`, `helmet`, `cors`, `morgan` | API + seguridad |
| **DB** | `better-sqlite3` | SQLite |
| **Auth** | `jsonwebtoken`, `bcryptjs`, `jwt-decode` | JWT + PIN |
| **Tiempo real** | `ws` | WebSocket KDS |
| **Print** | `esc-pos-printer` | Tickets térmicos |
| **Utilidades** | `zod`, `uuid`, `qrcode`, `date-fns`, `dexie`, `dexie-react-hooks`, `idb`, `lucide-react` | Varios |
| **Dev/build** | `vite`, `vite-plugin-pwa`, `workbox-precaching`, `workbox-window`, `@vitejs/plugin-react`, `typescript`, `typescript-eslint`, `eslint`, `prettier`, `tailwindcss`, `@tailwindcss/vite` | Build + PWA + lint |
| **Test** | `vitest`, `@playwright/test`, `@testing-library/react`, `@testing-library/jest-dom`, `fake-indexeddb`, `@types/*` | Tests |

> **Instalación:** `npm install --legacy-peer-deps` (OBLIGATORIO).

---

## 7. Variables de entorno (.env)

El `.env` **NO está en git** (contiene secretos). Se copia a mano. Plantilla: `.env.example`.

| Variable | Obligatoria | Descripción |
|----------|:---:|-------------|
| `PORT` | ✅ | Puerto del server (**3002**, el 3001 está ocupado por otra app) |
| `NODE_ENV` | ✅ | `production` en el bar (exige JWT_SECRET) / `development` trabajo |
| `JWT_SECRET` | ✅ prod | Secreto ≥32 chars que firma sesiones. **En producción su ausencia ABORTA el arranque** |
| `PUBLIC_BASE_URL` | ⚠️ | URL impresa en los QR de mesas (IP LAN o Tailscale del server, ej. `http://192.168.1.2:3002`) |
| `DB_PATH` | | Ruta de la DB SQLite (default `data/rey-de-la-chelada.db`) |
| `MENU_MANAGEMENT` | ⚠️ | `seed` (DEV) / `admin` (PROD) — quién gestiona el menú |
| `DEFAULT_TABLES` | | = `capacity.totalTables` (10) |
| `API_READ_RATE_LIMIT_MAX` | | Lecturas/15min (default 6000) |
| `API_WRITE_RATE_LIMIT_MAX` | | Escrituras/15min (default 1500) |
| `AUTH_RATE_LIMIT_MAX` | | Login/min (default 20) |
| `JWT_EXPIRES_IN` | | Duración token (default 24h) |
| `GITHUB_REPO` / `GITHUB_BRANCH` | | Repo público (sin token) |
| `RESTAURANT_NIT`, `RESTAURANT_IVA`, `PRINTER_*`, `QR_*`, `BCB_*`, `BANCO_BISA_CUENTA`, `MESEROS_POR_TURNO`, `ADMIN_*` | | Config opcional del bar |

> **Generar JWT_SECRET:** `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`

---

## 8. Base de datos (SQLite) y contratos

**DB:** `data/rey-de-la-chelada.db` (better-sqlite3). Schema en `server/db/schema.js` (con migrations por `SCHEMA_VERSION`).

**Tablas principales:**
- `staff` (roles, `pin_hash`, `is_active`)
- `tables` (mesas; número **0 = BARRA**)
- `menu_categories` / `menu_items` / `modifier_groups` / `modifier_options`
- `orders` / `order_items` (líneas con `round`, `promo_label`, `status`)
- `payments` (method cash|qr, `received`, `change`, `processed_by` FK staff, `proof_photo`)
- `payment_operations` (operaciones financieras) / `payment_proofs` (fotos, múltiples por pago)
- `cash_closings` (cortes, v13 con desglose)
- `waiter_calls` (llamadas de clientes) / `client_sessions` / `sync_log` / `schema_version`

**Contratos de datos (NO romper):**
- **Precios** en **centavos** (enteros). Server es SSOT del precio (ignora precios del cliente).
- **`processed_by`** (no `processor`) en payments.
- **`preparation_notes`** (no `notes`) en order_items.
- **`proof_photo`** en payments / `payment_proofs` (UUID filenames).
- **`transaction`** = `COUNT(DISTINCT order_id)` (pedidos, no pagos).
- **Mesa 0 = BARRA** — siempre mostrar "BARRA" (helper `formatTableRef`), nunca "Mesa 0".

---

## 9. API REST (endpoints)

| Ruta | Funciones clave |
|------|-----------------|
| `/api/auth` | `login` (PIN), `refresh`, `me`, `logout` |
| `/api/tables` | CRUD mesas + estado |
| `/api/menu` | items (public read), categorías, `import-seed`, precios, modifier-options |
| `/api/orders` | crear, `/:id` (detalle), `/:id/submit`, `/confirm`, `/status`, `/deliver`, `/kds-status`, `/items` |
| `/api/payments` | `POST /` (pago), `/mixed`, `/:id/proof` (foto), `/:id/proof/content` (imagen), `closing/current`, `closing/close` |
| `/api/reports` | `orders` (historial pedidos pagados), `sales/daily`, `sales/range`, `items/popular` |
| `/api/staff` | CRUD personal |
| `/api/waiter-calls` | Llamadas de clientes |
| `/api/client-orders` / `/api/client-sessions` | PWA clientes (público, sin JWT) |
| `/api/sync` | Push offline idempotente |
| `/api/promotions` | Promos del día |

**Auth por rol:** `requireAuth` (JWT Bearer) + `requireRole('admin','caja',...)`. Controlado en `server/middleware/auth.js`. Endpoints públicos (clientes, menú read, promos) **no** requieren JWT.

---

## 10. Scripts de operación

| Script | Comando | Qué hace |
|--------|---------|----------|
| **Instalar PC nueva** | `scripts\setup.bat` | 7 fases: prereqs → .env → clone/pull → npm install → build → firewall+arranque → health check |
| **Iniciar** | `scripts\start.bat` | Arranca el server oculto (vía `start-hidden.vbs`) |
| **Detener** | `scripts\stop.bat` | Mata el proceso del puerto 3002 |
| **Actualizar** | `scripts\update.bat` | pull → install → build → restart (+ `--force` para reset) |
| **Backup** | `scripts\backup.bat` | Copia DB a `backups\` (retención 7 días) |
| **Watchdog** | `scripts\watchdog-start.bat` / `stop.bat` | Health check cada 5 min, relanza si cae (3 fallos) |
| **Agendar backup** | `scripts\install-backup-schedule.bat` | Task Scheduler 01:00 `ReyChelada-Backup` |
| **Limpieza PROD** | `scripts\clear-operational.mjs` | Borra SOLO transaccionales (pedidos/pagos/comprobantes/cierres) — `--dry-run` para previsualizar |
| **Verificar PWAs** | `scripts\verify-pwas.mjs` | Comprueba que las 6 PWAs respondan |
| **Sync ecosistema** | `scripts\sync.bat` | Sync con FORCH.iA |

---

## 11. RUNBOOK: PC nueva — producción paso a paso

> Requisitos previos: Windows 10/11, Node ≥22.9, Git, puerto 3002 libre, privilegios admin, internet (solo para instalar/actualizar).

### A. Preparar los 3 archivos
Copia `setup.bat` (en `scripts/`), `elevate.vbs` (raíz) y el `.env` (a mano — NO está en git) a una carpeta limpia (ej. `C:\ReyChelada`).

### B. Ejecutar el instalador
Doble clic en `setup.bat` (se auto-eleva con UAC, pide tecla, corre las 7 fases). Al final muestra las URLs y **mueve `setup.bat` a `scripts\`**.

> **Si el repo ya está clonado** (caso de desarrollo o segunda PC), en vez de `setup.bat` usa:
> ```
> cd C:\ReyChelada
> git pull origin main
> npm install --legacy-peer-deps   # OBLIGATORIO
> npm run build                     # genera dist/ 6 PWAs
> scripts\start.bat                 # arranca el server oculto
> ```
> O directamente `scripts\update.bat` (equal a pull+install+build+restart).

### C. Post-instalación (recomendado)
1. **Agendar backup automático** (1 vez): `scripts\install-backup-schedule.bat`.
2. **Watchdog** (1 vez): `scripts\watchdog-start.bat`.
3. **Auto-arranque al iniciar Windows**: copia accesos directos de `start.bat` y `watchdog-start.bat` a la carpeta de inicio (`Win+R` → `shell:startup`). Requiere sesión de usuario autologueda.
4. **Firewall**: el instalador crea la regla `Rey de la Chelada :3002` (TCP). Si no, crearla admin:
   `New-NetFirewallRule -DisplayName "Rey de la Chelada :3002" -Direction Inbound -Protocol TCP -LocalPort 3002 -Action Allow -Profile Any`.
   (Regla ya presente si es la misma PC).

### D. Verificación final
1. Abre las 6 URLs desde la PC: `http://localhost:3002/{clientes,cocina,bar,meseros,caja,admin}/`.
2. Login Admin `0000`, Mesero `1111`, KDS `2222`, Caja `3333`.
3. Desde un **celular en la misma red WiFi**, abre el menú con la **IP LAN** (ej. `http://192.168.1.2:3002/clientes/`).
4. Prueba el QR de una mesa (usa `PUBLIC_BASE_URL`).
5. Backup manual: `scripts\backup.bat` → verifica `backups\*.db` + `logs\backup.log`.

---

## 12. RUNBOOK: desarrollo (dev)

### A. Clonar + instalar + dev
```
git clone https://github.com/paulogvs/rey-de-la-chelada.git
cd rey-de-la-chelada
npm install --legacy-peer-deps
cp .env.example .env        # escribir valores (JWT_SECRET, DB_PATH, MENU_MANAGEMENT=seed, etc.)
npm run dev:server          # terminal 1: server API en :3002
npm run dev                 # terminal 2: Vite dev server (HMR) en :3001
```

> `npm run dev:server` arranca el backend **sin** `--env-file`. Para que cargue `.env`, usa `node --env-file-if-exists=.env server/index.js`. En dev, tanto `npm run dev` (Vite) como `dev:server` (Express) — para trabajar con la API real, arranca `dev:server`.

### B. Ciclo de desarrollo
- Escribes en `src/` (frontend) y `server/` (backend).
- El build multi-PWA genera los `sw.js` por módulo con `clientsClaim` + `skipWaiting` inyectados (post-build en `vite.config.ts`).
- **Flujo de trabajo recomendado**: NO trabajar directo en `main`. Usa ramas `feature/`, `fix/`, `docs/`. Commits Conventional Commits.
- **Verificación antes de commit**: `npm run validate` (= typecheck + lint + test + build).

---

## 13. RUNBOOK: ciclos de trabajo (dev→prod)

El flujo es **DEV → GitHub → PROD** (PROD solo hace pull, nunca push):

```
DEV (editas) ──git add/commit/push──> GitHub main ──git pull──> PROD (build+restart)
```

### A. Push de cambios a GitHub
```bash
cd <DEV>
git add -A
git commit -m "feat(area): descripcion detallada"
git push origin main
```

### B. Desplegar en PROD
```bash
cd C:\ReyChelada            # PROD
git pull origin main
npm install --legacy-peer-deps
npm run build               # genera dist/ (6 PWAs)
# reiniciar server:
#  scripts\stop.bat
#  scripts\start.bat        (o directamente 'update.bat' que hace todo)
```

> **Atención al Service Worker**: tras el deploy, el SW nuevo toma control automáticamente (clientsClaim + skipWaiting inyectados). La primera vez en cada navegador, un **hard refresh** (`Ctrl+Shift+R`) garantiza el bundle nuevo. Los PWAs de PROD apuntan al build estático servido en `dist/`.

### C. Alinear los 3 entornos
- **DEV** = raíz de trabajo (edita).
- **GitHub** = `git push` (código).
- **PROD** = `C:\ReyChelada` (hace `git pull`).
- **Siempre**: `git log --oneline -1` debe coincidir en los 3 tras el deploy (el commit `HEAD`).

### D. Actualización de menú dev→prod
1. Mejorar `src/core/data/menu-seed.json` en DEV → push → pull PROD.
2. En Admin PROD → Menú → "Importar del seed" (trae solo nuevos, no pisa ediciones).

---

## 14. Verificación (tests / lint / build)

```bash
npm run typecheck          # tsc --noEmit
npm run lint               # eslint src server
npm run test               # vitest run (suite completa)
npm run build              # vite build (6 PWAs + SWs)
npm run validate           # todo lo anterior
```

- **Vitest**: `tests/unit/` y `tests/integration/`. Config en `vitest.config.ts` (hookTimeout/testTimeout 60s + pool forks).
- **Playwright (e2e)**: `tests/e2e/` (en progreso — carpeta casi vacía). Los e2e reales hoy son scripts manuales en `scripts/e2e-*.mjs` (requieren server arriba).
- **Conteo actual**: ~790 tests (90 archivos). El AGENTS.md dice 675 (desactualizado — el real es el de `npm run test`).

> **Test de build**: `npm run test:build` corre `tests/build-output.test.js`. Se excluye del `npm run test` normal por dependencia del build.

---

## 15. Solución de problemas frecuentes

| Síntoma | Causa | Solución |
|---------|-------|----------|
| **"Token inválido o expirado" en loop al cobrar** | 1) Firma invertida `fetchOrderById(orderId, token)` (ya corregido en 0d05f27) 2) SW cacheando 401 viejo (ya corregido con NetworkOnly + clientsClaim) | Verifica el commit. Si aún pasa, hard refresh + unregister SW + borrar `rdlc-token:*` de localStorage |
| **"No se encontró .env"** | Falta `.env` en la carpeta | Copia `.env` junto a `setup.bat` |
| **Server no arranca: JWT_SECRET requerido** | `NODE_ENV=production` sin JWT_SECRET | Define `JWT_SECRET` (32+ chars). Fail-loud intencional |
| **Puerto 3002 ocupado** | Otro proceso o instancia vieja | `scripts\stop.bat`; si no: `netstat -ano \| findstr :3002` → `taskkill /f /pid <PID>` |
| **Build falla** | Node viejo o deps incompletas | `node -v` (≥22.9) + `npm install --legacy-peer-deps` + `npm run build` |
| **Fotos de comprobante no se guardan** | Body-parser global < tamaño de foto (ya subido a 12mb + compresión cliente) | Verifica que estés en commit ≥4482ffc |
| **El menú se resetea en PROD** | `MENU_MANAGEMENT` en `seed` (debería ser `admin`) | Cambia `.env` a `MENU_MANAGEMENT=admin` y reinicia |
| **Anomalías en cierre de caja** | Fechas con `toISOString` en vez de día laboral | Usa `businessDayExpr`/`businessDayDateStr` (nunca `toISOString().split('T')[0]`) |
| **No llegan pedidos en vivo** | WS caído o pagama | Revisa `logs\app-*.log`; el polling de respaldo (15s mesas, 30s llamadas) debe funcionar |

---

## 16. Procedimientos operativos clave

### Reset de datos transaccionales en PROD (pruebas)
```bash
cd C:\ReyChelada
scripts\stop.bat                      # detener server (libera la DB)
node scripts\clear-operational.mjs --dry-run   # previsualizar qué se borra
node scripts\clear-operational.mjs            # borrar pedidos/pagos/comprobantes/cierres
# (mantiene staff, mesas, menú)
scripts\start.bat
```
> Si hay fotos huérfanas: borra `data\payment-proofs\*` (los comprobantes van con los pagos).

### Backup/restore
```bash
scripts\backup.bat                    # crear backup
# restore: copiar un backup de backups\ a data\rey-de-la-chelada.db (con server detenido)
```

### Elevación de privilegios (setup manual)
`setup.bat` se auto-eleva vía `elevate.vbs`. Para elevar comandos manualmente: abrir terminal como admin.

---

## 17. Reglas de oro (no romper)

1. **Precios en centavos** — siempre enteros; el server es SSOT.
2. **`processed_by`** (no `processor`) y **`preparation_notes`** (no `notes`) en queries SQL.
3. **`transactions`** = `COUNT(DISTINCT order_id)` (pedidos pagados, no pagos).
4. **Mesa 0 = BARRA** — mostrar "BARRA" (helper `formatTableRef`), nunca "Mesa 0".
5. **Día laboral** (15:00→06:00) para cortes/reportes; usa `businessDayExpr`/`businessDayDateStr`.
6. **`MENU_MANAGEMENT=admin`** en PROD (no pisar menú editable del admin).
7. **`npm install --legacy-peer-deps`** — siempre.
8. **`.env` nunca a git**; `JWT_SECRET` obligatorio en producción.
9. **No usar `toISOString().split('T')[0]`** para "hoy" local.
10. **Service Worker**: `/api/*` `NetworkOnly`; navegación `NetworkFirst`; `clientsClaim`+`skipWaiting` inyectados.
11. **TDD** — no producción sin test que falle primero.
12. **Verificación antes de "listo"** — `npm run validate` (typecheck+lint+test+build) + smoke de las 6 PWAs.

---

## Anexo — Estado actual del proyecto (para sesión fresca)

| Área | Estado |
|------|--------|
| **Commit HEAD** | `3d1c19f` (BARRA estandarizada) |
| **Tests** | ~786-790 pasando (Vitest), 90 archivos |
| **Build** | OK — 6 PWAs + service workers |
| **PWA** | Multi-PWA (clientes, cocina, bar, meseros, caja, admin) |
| **Cobro** | Modelo dinámico efectivo+QR, cambio editable (opción A), validación coversTotal |
| **Caja** | Corte v13, transacciones=pedidos, historial, vista previa comprobante |
| **Menú** | Seed 105 items / 19 categorías; PROD admin-managed |
| **Comprobantes** | Compresión cliente (1280px/JPEG0.8) + límite global 12mb; múltiples por pago |
| **Items en vivo** | WS refresca el pedido abierto en meseros (wsRefresh) |
| **Branding** | FORCH.i by Paulo Velasco |

---

*Rey de la Chelada — FORCH.i by Paulo Velasco · Built with FORCH.i by Paulo Velasco · https://forch-i-a-hub.vercel.app/*
