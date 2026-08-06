# FASE 1 — Entrega: La Caja Cuadra al Centavo

> **Proyecto:** Rey de la Chelada — `D:\OTRO DISCO\FORCH-IA\FORCH-IA-ECOSYSTEM APPs\rey-de-la-chelada`
> **Fecha:** 2026-08-06 | **Modo:** DEV (PROD `D:\OTRO DISCO\REY DE LA CHELADA` NO tocado)
> **Estado:** ✅ Tests 392/392 · Lint 0 errores · Build 6 PWAs OK
> **No se hizo commit/push** (pendiente de revisión humana)

---

## 1. Fixes aplicados (TDD RED → GREEN)

| Fix | Problema | Solución | Evidencia RED → GREEN |
|-----|----------|----------|------------------------|
| **C1** | "Hoy" se calculaba con fecha UTC (`date('now')`); los pagos de 20:00–23:59 La Paz caían en el día equivocado | Helper `server/utils/date-utils.js`: zona `America/La_Paz` (UTC−4, sin DST), fecha local vía `Intl.DateTimeFormat`, SQL con modificador fijo `DATE(col, '-4 hours')` | RED: `tests/unit/date-utils.test.js` (módulo inexistente falla) → GREEN: 6/6 |
| **C2** | `closing/current` y reportes sumaban TODOS los pagos (pending/failed/refunded contaban como cobrados) | Solo `status='completed'` cuenta en saldo, día y corte | RED: test integración `payments-cash-close.test.js` (2 casos) → GREEN |
| **C3** | Un pedido podía marcarse `paid` sin pago completed (PATCH status o sync offline) | `PATCH /api/orders/:id/status` → 409 `PAYMENT_REQUIRED` si `SUM(completed amount+tip) < total`. Sync bloquea update_status a `paid` sin pago completo | RED: 2 casos integración → GREEN |
| **C4** | La propina de la UI se enviaba DENTRO del amount (caja registraba de más; sin columna tip) | Columna `payments.tip` (SCHEMA_VERSION 4, migración idempotente v3→v4). Semántica: `amount` = aplicado al saldo, `tip` = propina mismo pago; `amount+tip ≤ remaining`; `fullyPaid = SUM(amount+tip) ≥ total`. UI (PaymentPanel) descuenta la propina del split que la lleva (`amount = split.amount − tip`), suma `amount+tip == total` exacto | RED: `tests/unit/schema-migration-tip.test.js` (4) + integración (5 casos) → GREEN |
| **C5** | `expected_cash` incluía QR/tarjeta/transferencia (caja nunca cuadraba: esos van al banco) | `expected_cash = SUM(amount+tip)` de SOLO `method='cash'` completed en fecha local. `is_reconciled` lo decide SIEMPRE el server: `|actual − expected| ≤ 0.01` (ignora el valor del cliente — fix M9) | RED: 2 casos integración → GREEN |
| **A4** | `processPayment` no era atómico (fallo a mitad = pago huérfano o pedido medio actualizado) | Todo el flujo en `db.transaction()` — rollback total ante cualquier error | GREEN: integración completa 11/11 sin pagos huérfanos |

**Bug real capturado por los tests en este tramo final:** un pago `refunded` se rechazaba con 409 cuando el pedido ya estaba pagado (la constraint de saldo aplicaba a TODOS los estados). Fix: la constraint `amount+tip ≤ remaining` solo aplica a `completed`; failed/refunded se registran sin tocar saldo. → 11/11 GREEN.

---

## 2. Archivos

### Creados
- `D:\OTRO DISCO\FORCH-IA\FORCH-IA-ECOSYSTEM APPs\rey-de-la-chelada\server\utils\date-utils.js` — helper fecha local La Paz (C1)
- `D:\OTRO DISCO\FORCH-IA\FORCH-IA-ECOSYSTEM APPs\rey-de-la-chelada\tests\unit\date-utils.test.js` — C1 (6 tests)
- `D:\OTRO DISCO\FORCH-IA\FORCH-IA-ECOSYSTEM APPs\rey-de-la-chelada\tests\unit\schema-migration-tip.test.js` — migración v3→v4 (4 tests)
- `D:\OTRO DISCO\FORCH-IA\FORCH-IA-ECOSYSTEM APPs\rey-de-la-chelada\tests\integration\payments-cash-close.test.js` — C2/C3/C4/C5 (11 tests, DB temp, no toca data/)

### Modificados (servidor)
- `server\db\schema.js` — SCHEMA_VERSION 4 + `payments.tip REAL NOT NULL DEFAULT 0` + migración idempotente con guard `PRAGMA table_info`
- `server\routes\payments.js` — C1/C2/C4/C5/A4 (processPayment exportado + transaccional)
- `server\routes\orders.js` — C3 guard PATCH `paid`
- `server\routes\sync.js` — C2/C3/C4 en sync offline
- `server\routes\reports.js` — C1 fecha local + C2 completed-only + C4 `amount+tip`

### Modificados (UI)
- `src\pwa\_shared\api\paymentsApi.ts` — `PaymentPayload.tip?: number`, `ServerPayment.tip: number`
- `src\pwa\meseros\PaymentPanel.tsx` — propina enviada como `tip` (descontada del `amount` del split que la lleva, preferencia cash); `totalWithTip` → `totalToCollect` (el cliente paga el total del pedido; la propina sale de ese cobro); `cashChange` calculado contra el total (no duplica la propina)

---

## 3. Verificación final (Fase 7 — correr fresca)

| Gate | Comando | Resultado |
|------|---------|-----------|
| Tests | `npm run test` | ✅ **43 archivos / 392 tests PASS** (baseline 40/371 → +3 archivos, +21 tests) |
| Lint | `npm run lint` | ✅ **0 errores** (15 warnings pre-existentes) |
| Build | `npm run build` | ✅ **6 PWAs** (clientes, cocina, bar, meseros, caja, admin) — `✓ built in 3.58s` |

> Nota: `npm run typecheck` (`tsc -b`) está roto pre-existente — el repo no tiene `tsconfig.json`. No fue parte del baseline verde y NO se agregó (fuera de alcance).

---

## 4. Semántica documentada (para Fase 2+)

### Fecha (C1)
- Los timestamps se guardan UTC (`datetime('now')` / ISO).
- "Hoy" local = `America/La_Paz` (UTC−4, **sin DST** → offset fijo).
- SQL usa `DATE(col, '-4 hours')`; JS usa `Intl.DateTimeFormat('en-US', { timeZone: 'America/La_Paz' })`.
- ⚠️ Nunca usar `toISOString().split('T')[0]` para fechas locales (ver Hallazgos Fase 2).

### Propina (C4) — modelo "descuento del cobro"
- El cliente paga el **total del pedido**; la propina se registra aparte y NO es monto extra en caja.
- `payments.amount` = monto aplicado al saldo del pedido.
- `payments.tip` = propina del mismo pago (mismo método; no sujeta a IVA).
- Total cobrado por el pago = `amount + tip`.
- `SUM(amount+tip)` de completed ≤ total del pedido (constraint server, `+0.001` de tolerancia).
- `fullyPaid = SUM(amount+tip) ≥ total`.
- Retrocompatible: pagos sin `tip` → tip=0, comportamiento idéntico al anterior.
- En `closing` y reportes, el efectivo del día = `SUM(amount+tip)` de `method='cash'` completed — la propina en efectivo queda dentro del arqueo.

### Corte de caja (C5)
- `expected_cash` = SOLO efectivo (`method='cash'`) completed del día local.
- `difference = actual − expected` (server).
- `is_reconciled = |difference| ≤ 0.01` — lo decide SIEMPRE el server (fix M9).

---

## 5. Hallazgos para Fase 2 (NO corregidos — fuera de alcance FASE 1)

Bugs de fecha UTC en el cliente (mismo problema C1, pero en la capa UI/scripts):

| Archivo | Línea | Problema |
|---------|-------|----------|
| `src\pwa\caja\App.tsx` | 37 | `toISOString().split('T')[0]` → fecha UTC, no La Paz |
| `src\pwa\admin\views\DashboardView.tsx` | 53 | Ídem |
| `src\core\engine\OrderEngine.ts` | 254, 408 | Ídem |
| `scripts\e2e-caja-cierre.mjs` | — | Ídem (asserts E2E) |
| `scripts\e2e-consistencia.mjs` | — | Ídem |

Sugerencia Fase 2: exponer el helper `date-utils` al cliente (o un `Intl` wrapper en `src/pwa/_shared/utils/`) y reemplazar todos los `toISOString().split('T')[0]`.

---

*FORCH.i by Paulo Velasco | Built with FORCH.i by Paulo Velasco | https://forch-i-a-hub.vercel.app/*
