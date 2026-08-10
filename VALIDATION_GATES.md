# VALIDATION GATES — Rey de la Chelada

> **Checklist obligatorio pre-code.**
> Todos los gates deben estar en VERDE antes de escribir la primera línea de código de feature.
>
> **Estado revisado:** 2026-08-10 (@forchi, auditoría F1). Marca ✅ lo verificado hoy.

---

## 🟢 GATES (15)

### GATE 1 — Simplicity Gate
- [ ] ¿≤ 3 proyectos/paquetes iniciales?
- [ ] ¿Sin future-proofing especulativo?
- [ ] ¿Cada feature existe porque hay un requerimiento que la justifica?

### GATE 2 — Anti-Abstraction Gate
- [ ] ¿Uso directo del framework sin wrappers propietarios?
- [ ] ¿Modelo de datos único, no duplicado entre capas?

### GATE 3 — Integration-First Gate
- [x] ¿Contratos entre frontend y backend definidos? (FASE 2 §2b AGENTS.md)
- [x] ¿Tipos compartidos en `src/core/types/`?

### GATE 4 — Token Gate
- [x] ¿`DESIGN.md` tiene tokens primitivos + semánticos + de componente?
- [x] ¿`tokens.css` generado desde DESIGN.md? (tokens.json v1.1.0 → theme.js)

### GATE 5 — SSOT Gate
- [x] ¿Existe `src/core/engine/` como motor de datos único?

### GATE 6 — Boundaries Gate
- [x] ¿`.gitignore` incluye `.env`, `node_modules`, `dist/`, `data/`?

### GATE 7 — Legal Gate
- [x] ¿Documentos legales presentes? (legal/ — Privacy, Terms, AUP)
- [x] ¿Jurisdicción Bolivia documentada?

### GATE 8 — Branding Gate
- [x] ¿`branding.json` con nivel ≥ 2 rellenado? (status OK 2026-08-10)
- [x] ¿Badge FORCH.iA en footer + README?

### GATE 9 — Cost Gate
- [x] ¿Estrategia $0 documentada en constitution.md?

### GATE 10 — Auth Gate
- [x] ¿Auth verificada en servidor (middleware `requireAuth`/`requireRole`)?
- [ ] ~~¿JWT con refresh token?~~ → **NO implementado** (cookie 24h suficiente; refresh token es especulativo — retirado del scope)
- [x] ¿PIN de acceso rápido para meseros? (0000/1111/2222/3333 por rol)

### GATE 11 — Offline Gate ⭐
- [x] ¿App funciona 100% sin internet (IndexedDB local)? (PWA + sync offline)
- [x] ¿Service Worker registrado? (6 PWAs, v1.3.0)
- [ ] ~~¿Background Sync API implementada?~~ → Sync manual/reintento; Background Sync nativo no implementado

### GATE 12 — KDS Gate ⭐
- [x] ¿Órdenes aparecen en cocina en < 1 segundo? (WebSocket broadcaster)
- [x] ¿WebSocket implementado para tiempo real?
- [x] ¿Alertas visuales y auditivas para nuevas órdenes?

### GATE 13 — Printer Gate ⭐
- [ ] ¿Thermal printing funciona (ESC/POS)? → **Configurado en .env (`PRINTER_NAME`/`PRINT_COMANDA`) pero NO probado en disco** — pendiente prueba física
- [ ] ¿Comanda se imprime automáticamente al crear orden? → idem, pendiente

### GATE 14 — Sync Gate ⭐
- [x] ¿Offline data syncs correctamente cuando conexión se restaura? (FASE 2 §2b: idempotente por UUID)
- [x] ¿Conflict resolution implementado? (sync push idempotente + duplicados)

### GATE 15 — Payment Gate ⭐
- [x] ¿QR payment flow complete? (QR Simple / OpenBCB — **Bolivia**; Yape es Perú, NO aplica)
- [x] ¿Cash payment con vuelto calculation?
- [ ] ¿Invoice generation con NIT? → **Parcial**: `RESTAURANT_NIT` configurable en .env; validación BCB pendiente de credenciales reales

---

> *FORCH.i by Paulo Velasco | https://forch-i-a-hub.vercel.app/*
