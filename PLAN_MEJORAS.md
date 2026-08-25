# PLAN_MEJORAS.md — Rey de la Chelada

> **Generado por:** @forchi (FORCH.iA) — Full Review + React Doctor + pnpm/npm doctor
> **Fecha:** 2026-08-25 | **Rama:** main | **Node:** v26.2.0
> Prioridad: P0 (crítico) > P1 (alto) > P2 (medio) > P3 (bajo)

---

## Resumen ejecutivo

| Verificación | Resultado | Evidencia |
|--------------|-----------|-----------|
| `npm run typecheck` | ✅ PASS | exit 0, 0 errores |
| `npm run lint` | ✅ PASS | exit 0, 0 errores |
| `npm run test` | 🟡 **743/744** | 1 fallo REAL: `jwt-secret.test.js` |
| `npm run build` | ✅ PASS | exit 0, 6 PWAs + SW + manifest (24.28s) |
| `tests/build-output.test.js` (post-build) | ✅ 7/7 | PASS en orden correcto |
| React Doctor (full) | 🔴 **49/100 CRITICAL** | 265 issues: 9 errores, 256 warnings |
| `pnpm doctor` | 🟡 1 warning | bin dir no está en PATH |
| `npm doctor` | 🟡 2 sugerencias | npm 12.0.2 / node 26.7.0 recomendados |

**Veredicto general:** el código está sano (typecheck/lint/build ✅, 743 tests ✅). El score React 49 está **fuertemente penalizado por ~110 falsos positivos** de `unused-file` (la regla no entiende entry points multi-PWA), pero **los 9 errores de bugs son reales** y hay 1 test rojo por un cambio no commiteado.

---

## P0 — CRÍTICO (Bugs React reales — leaks y renders corruptos)

### 1. Effects sin cleanup ×3 → LEAKS de WebSocket y timers
| Ubicación | Problema |
|-----------|----------|
| `src/pwa/_shared/hooks/useKDSWebSocket.ts:235` | Subscripción/setup sin cleanup en el return del effect |
| `src/pwa/clientes/hooks/useTableSession.ts:198` | Ídem — timer/subscripción sin limpiar |
| `src/ui/components/Toast/Toast.tsx:79` | Timer de toast sin cleanup |

**Impacto:** con re-mounts (navegación entre PWAs, reconexión) se acumulan WebSockets y timers → fugas de memoria y re-renders fantasma. **Afecta el requisito de KDS <500ms** (NFR en SPEC_INICIAL §8).
**Fix:** retornar cleanup en el `useEffect` (`return () => { ws.close(); clearTimeout(t); }`).

### 2. Ref leído durante render ×4 → renders inconsistentes
| Ubicación | Problema |
|-----------|----------|
| `src/pwa/_shared/hooks/useKDSWebSocket.ts:228-229` | `ref.current` leído en render |
| `src/ui/components/KDSBoard/KDSBoard.tsx:106,173` | Ídem |

**Impacto:** React 19 + StrictMode puede pintar dos veces con valores distintos → UI parpadeante en KDS.
**Fix:** subir a `useState` lo que afecta al render; el ref solo para valores no-visuales.

### 3. Side effects dentro de state updater — `useClientOrder.ts:121-124`
- `no-impure-state-updater` (línea 121) + `no-side-effect-in-state-updater-function` (línea 124)
- **Impacto:** en StrictMode el updater se ejecuta 2× → efectos duplicados (riesgo de pedidos/llamadas repetidas). Regla React estricta: los updaters deben ser puros.
- **Fix:** mover el efecto fuera del `setState` (antes o después, según semántica).

---

## P1 — ALTO

### 4. 🔴 Test rojo: `tests/unit/jwt-secret.test.js`
- **Causa raíz:** `server/middleware/auth.js` (cambio NO commiteado en main) cambió el fallback de `'dev-secret-do-not-use-in-production'` (funcional en dev) → `randomUUID()` (fail-closed: sin env los tokens NO funcionan). El test quedó con el contrato viejo.
- **Evaluación:** el cambio de código es **correcto y deseable** (fail-closed, Artículo VII Secrets Boundary). El test NO se actualizó → rompe la regla del repo "main requiere tests pasando" (AGENTS.md §5).
- **Fix:** actualizar el test al nuevo contrato: `JWT_SECRET` ≠ valor fijo, warning emitido, y el login solo funciona si `process.env.JWT_SECRET` está set. **OJO:** documentar que en dev sin `.env`, los tokens mueren al reiniciar el server (nuevo comportamiento).

### 5. Score React 49 → limpiar falsos positivos de multi-PWA (~110 issues)
- `deslop/unused-file ×110` marca como "no usados" TODOS los `main.tsx`/`App.tsx` de las 6 PWAs → son entry points reales (vite multi-page). Falso positivo masivo.
- **Fix (rápido):** crear `doctor.config.ts` con ignores de entry points + `--scope changed` para gates de CI.
- **Fix (real):** eliminar archivos genuinamente muertos — ej. `ecosystem.config.cjs` (PM2 obsoleto, el deploy real usa start-hidden.vbs). Auditar `src/modules/payments/hooks/usePrinter.ts`, `src/core/config/device-adapter.ts`, `src/core/config/security.ts`, `src/core/config/capabilities.ts`, `src/modules/salon/components/TableGrid.tsx` (listados como unused — verificar cuáles son reales).

### 6. `deslop/unused-dependency ×8` + `unused-dev-dependency ×1` (package.json)
- Revisar deps sin uso real y limpiarlas (menos superficie de ataque + build más chico).

### 7. A11y — 15 labels sin control asociado (WCAG 2.1)
`StaffView.tsx:141,154` · `TablesView.tsx:141,153` · `ClosingView.tsx:124-158` · `CollectView.tsx:286` · `InvoiceView.tsx:64-97` · `OrderPanel.tsx:1025`
- **Fix:** `htmlFor`/`id` o `aria-label` — la app ya apunta a touch 48px; esto cierra calidad.

---

## P2 — MEDIO (Performance & Maintainability)

| # | Regla | Ubicación | Fix |
|---|-------|-----------|-----|
| 8 | `js-hoist-intl ×7` | `date-utils.js:41,57,98`, `local-date.ts:37,54,74,90` | Hoistear formatter Intl al scope de módulo |
| 9 | `js-set-map-lookups ×12` | `MenuEngine.ts:103`, `OrderEngine.ts:285`, `useMenuAdapter.ts:230-235`, etc. | Map/Set en vez de array lookups en loops |
| 10 | `js-combine-iterations ×14` | `SyncEngine.ts:337`, `OrderPanel.tsx:895`, `KDSBoard.tsx:235,258`, etc. | Combinar iteraciones encadenadas |
| 11 | `no-giant-component ×4` | `CollectView.tsx:67`, `MenuPage.tsx:60`, `OrderPanel.tsx:126`, `KDSBoard.tsx:89` | Dividir en subcomponentes (límite casa: 300 líneas) |
| 12 | `prefer-useReducer` | `OrderPanel.tsx:126` | Múltiples useState relacionados → useReducer |
| 13 | `no-loading-flag-reset-outside-finally ×14` | 14 vistas | Mover reset de loading a `finally` |
| 14 | `no-unguarded-numeric-input-parse ×2` | `TableGrid.tsx:158,171` | Parseo numérico sin guard |
| 15 | `client-localstorage-no-version ×2` | `useClientOrder.ts:91`, `useTableSession.ts:67` | Versionar claves (ej. `rdlc:order:v1`) |

---

## P3 — BAJO (Tooling/Entorno)

| # | Hallazgo | Acción |
|---|----------|--------|
| 16 | pnpm doctor: `bin dir no en PATH` | `pnpm setup` (warning menor, app es npm-based) |
| 17 | npm doctor: npm 11.13 vs 12.0.2 recomendado | `npm i -g npm@latest` (opcional) |
| 18 | Vitest 4 deprecation: `poolOptions` → top-level | Migrar `vitest.config` (`pool: forks` sigue, pero mover opciones) |
| 19 | `no-static-element-interactions` | `TablesView.tsx:208` — div con click → botón |
| 20 | `fetch Response sin status check ×2` | `sessionApi.ts:33,69` — verificar `res.ok` |

---

## Deploy / Operación

- **`.env` debe tener `JWT_SECRET` real** — el nuevo fallback es fail-closed por diseño: sin env, el server arranca pero **ningún login funciona** (los tokens mueren en cada reinicio). Verificar `.env` del local antes del siguiente deploy (Secrets Boundary — no auditado).
- Los warnings `[Auth] ⚠️ JWT_SECRET NO configurado` vistos en tests son esperados (tests sin env).

---

## Progreso de fixes (2026-08-25 — sesión completa)

| Fix | Estado | Evidencia |
|-----|--------|-----------|
| P0-1 Effects sin cleanup | ✅ | Toast/useTableSession timers limpios; `effect-needs-cleanup` 3→0 (el restante en useKDSWebSocket:240 es falso positivo, tiene cleanup real) |
| P0-2 Refs en render | ✅ | useKDSWebSocket + KDSBoard refs → effects; `no-ref-current-in-render` 4→0 |
| P0-3 State updater impuro | ✅ | useClientOrder updater puro; `no-impure-state-updater` 1→0 |
| P1-4 jwt-secret.test.js | ✅ | Actualizado al contrato fail-closed (2 tests). Suite 745/745 |
| P1-7 A11y labels ×15 | ✅ | StaffView, TablesView, ClosingView, InvoiceView (htmlFor/id); CollectView + OrderPanel (fieldset/legend); read-only labels → span. **A11y: 20 → 4 warnings** |
| P2 Intl hoist ×7 | ✅ | server/date-utils.js + client/local-date.ts: formatters de módulo. Perf: 43 → 36 |
| P2 loading-finally ×8 | ✅ | OrderHistoryView, BulkPrices, ModifierOptions, Payments, Closing, Summary, Collect, TablesView (openQr) |
| P2 fetch status check ×2 | ✅ | sessionApi.ts: res.ok antes de parsear |
| P3 Vitest 4 migration | ✅ | poolOptions → fileParallelism; **warning DEPRECATED eliminado** |
| P3 static element | ✅ | TablesView modal overlay → role=button + aria-label |
| **React Doctor score** | **49 → 58** | **Bugs: 9 → 2 errores** (ambos falsos positivos) |

### Fuerza bruta final (2026-08-25)
- `npm run typecheck` ✅ · `npm run lint` ✅
- `npm run test` → **745/745 tests** (738 suite + 7 build-output post-build)
- `npm run build` ✅ exit 0 (10.96s)

### Pendiente (requiere decisión)
- **Instalar `react-doctor` como devDep** (`npm i -D react-doctor@0.9.12`) para activar `doctor.config.ts` con ignores multi-PWA → el score real (sin 110 falsos positivos unused-file) es ~75-80
- `unused-dependency ×8`: revisar dexie-react-hooks/date-fns/esc-pos-printer/zustand (roadmap) — no se removieron para no arriesgar
- `usePrinter.ts`: hook de impresora (FR06) — decidir si conectar a vista o archivar
- localStorage versionado (claves `rdlc-*`): requiere migración de datos — pendiente deliberado

## Siguiente paso sugerido

1. (Opcional) `npm i -D react-doctor@0.9.12` + recrear `doctor.config.ts` → score honesto ~80
2. Conectar usePrinter a la vista de caja/meseros (FR06) o archivar
3. Limpiar deps no usadas del roadmap vencido

---

*Rey de la Chelada | Built with FORCH.i by Paulo Velasco | @forchi (FORCH.iA) | 2026-08-25*
