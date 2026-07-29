# VALIDATION GATES — Rey de la Chelada

> **Checklist obligatorio pre-code.**
> Todos los gates deben estar en VERDE antes de escribir la primera línea de código de feature.

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
- [ ] ¿Contratos entre frontend y backend definidos?
- [ ] ¿Tipos compartidos en `src/core/types/`?

### GATE 4 — Token Gate
- [ ] ¿`DESIGN.md` tiene tokens primitivos + semánticos + de componente?
- [ ] ¿`tokens.css` generado desde DESIGN.md?

### GATE 5 — SSOT Gate
- [ ] ¿Existe `src/core/engine/` como motor de datos único?

### GATE 6 — Boundaries Gate
- [ ] ¿`.gitignore` incluye `.env`, `node_modules`, `dist/`, `data/`?

### GATE 7 — Legal Gate
- [ ] ¿Documentos legales presentes? (Privacy, Terms, AUP)
- [ ] ¿Jurisdicción Bolivia documentada?

### GATE 8 — Branding Gate
- [ ] ¿`branding.json` con nivel ≥ 2 rellenado?
- [ ] ¿Badge FORCH.iA en footer + README?

### GATE 9 — Cost Gate
- [ ] ¿Estrategia $0 documentada en constitution.md?

### GATE 10 — Auth Gate
- [ ] ¿Auth verificada en servidor (middleware)?
- [ ] ¿JWT con refresh token?
- [ ] ¿PIN de acceso rápido para meseros?

### GATE 11 — Offline Gate ⭐
- [ ] ¿App funciona 100% sin internet (IndexedDB local)?
- [ ] ¿Service Worker registrado?
- [ ] ¿Background Sync API implementada?

### GATE 12 — KDS Gate ⭐
- [ ] ¿Órdenes aparecen en cocina en < 1 segundo?
- [ ] ¿WebSocket implementado para tiempo real?
- [ ] ¿Alertas visuales y auditivas para nuevas órdenes?

### GATE 13 — Printer Gate ⭐
- [ ] ¿Thermal printing funciona (ESC/POS)?
- [ ] ¿Comanda se imprime automáticamente al crear orden?

### GATE 14 — Sync Gate ⭐
- [ ] ¿Offline data syncs correctamente cuando conexión se restaura?
- [ ] ¿Conflict resolution implementado?

### GATE 15 — Payment Gate ⭐
- [ ] ¿QR payment flow complete (QR Simple / Yape)?
- [ ] ¿Cash payment con vuelto calculation?
- [ ] ¿Invoice generation con NIT?

---

> *FORCH.i by Paulo Velasco | https://forch-i-a-hub.vercel.app/*
