# Constitution.md — Rey de la Chelada

> **CONTRATO SUPREMO DEL PROYECTO**
> Este documento es INMUTABLE. Cualquier PR que lo viole debe ser rechazado por CI.
> NO se modifica después de creado sin ADR + aprobación humana explícita en `docs/adr/`.

---

## 📜 10 Artículos Inmutables (FORCH.iA)

### ARTÍCULO I — SINGLE SOURCE OF TRUTH (SSOT)
Cada dato del sistema existe en exactamente una ubicación autoritativa.
- Prohibido duplicar estado entre frontend y backend sin contrato explícito.
- Prohibido mostrar cifras calculadas en dos lugares con lógica distinta.
- Toda cifra, métrica o estado visible al usuario proviene del motor de datos único (`src/core/engine/` o equivalente).
- La UI es solo un renderizador, nunca un calculador.

### ARTÍCULO II — ZERO HARDCODED VALUES (Design Tokens Only)
Prohibido absolutamente en `src/`:
- Colores hexadecimales en componentes (`#D4AF37`, `#2B1B10`, etc.)
- Tamaños de fuente en `px` directos en componentes
- Espaciados mágicos
- Tipografías por nombre directo

Arquitectura obligatoria de tokens en 3 capas:
1. **PRIMITIVOS**: valores crudos, NUNCA usados en componentes
2. **SEMÁNTICOS**: propósito funcional, referencian primitivos
3. **COMPONENTE**: tokens específicos, referencian semánticos

### ARTÍCULO III — TEST-FIRST IMPERATIVE (TDD)
No se escribe una línea de código de feature sin un test que falle primero.
- RED: Escribir test que falla → verificar que falla por la razón correcta
- GREEN: Código mínimo para pasar → verificar que pasa
- REFACTOR: Limpiar manteniendo tests verdes
- Coverage mínimo: 70%

### ARTÍCULO IV — LIBRARY-FIRST & SIMPLICITY GATE
- Máximo 3 proyectos/paquetes por app en el arranque
- Cada feature nace como módulo aislado con interfaz explícita
- Nada de future-proofing especulativo (YAGNI)
- Si una feature tiene 3 implementaciones posibles → elegir la más simple

### ARTÍCULO V — FRAMEWORK-DIRECT (Anti-Abstracción)
Usar el framework directamente. Prohibido:
- Envolver React en abstracciones propietarias "por si acaso"
- Capas de abstracción sin requerimiento explícito

### ARTÍCULO VI — OBSERVABILIDAD DESDE EL MINUTO 0
- Todo módulo expone: logs estructurados + errores tipados
- Silent fails = violación constitucional. **Fail loud, never silent.**
- Errores tipados (`CustomError` con código + mensaje + contexto) > `try{}catch(_){}`

### ARTÍCULO VII — SECRETS BOUNDARY
- `.env*`, `secrets/`, `credentials/` — NUNCA se leen, escriben, ni commitean
- Cero excepciones. Crear `.env.example` con placeholders vacíos siempre

### ARTÍCULO VIII — BRANDING FORCH.iA NIVEL ≥ 2
Toda app del ecosistema FORCH.iA lleva:
- Badge FORCH.iA en footer (visible en todas las páginas)
- Sello "Built with FORCH.i by Paulo Velasco" en README
- `branding.json` correctamente rellenado con nivel ≥ 2

### ARTÍCULO IX — COST-EFFICIENCY FIRST (Estrategia $0)
Por defecto, priorizar soluciones Open Source, Self-hosted o Free-Tier generoso.
- ANTES de elegir una herramienta de pago, preguntar: "¿Existe alternativa gratuita?"
- Esta app es 100% Windows Self-Hosted — sin costos de infraestructura

### ARTÍCULO X — DOCUMENTACIÓN COMO CÓDIGO
- Ningún archivo de código existe sin su documentación correspondiente en `docs/`
- El código sin contexto es deuda técnica
- Cada función pública tiene JSDoc/TSDoc
- `README.md` se actualiza en cada cambio significativo

---

## Artículos Específicos del Proyecto

<details>
<summary>XI. Stack Tecnológico</summary>

- Frontend: React 19 + Vite + Tailwind CSS v4 + TypeScript
- Backend: Node.js + Express 5
- Base de Datos: PostgreSQL (server) + IndexedDB/Dexie (client offline)
- Auth: JWT + PIN quick access para meseros
- Deployment: Windows Self-Hosted (PM2 + nssm)
</details>

<details>
<summary>XII. Jurisdicción Legal</summary>

- País/Leyes aplicables: Bolivia — Ley 164 (Protección de Datos)
- Documentos requeridos: Privacy Policy, Terms of Service, AUP
- SIN: Facturación con NIT (dosificación)
</details>

<details>
<summary>XIII. Presupuesto de Infraestructura</summary>

- Máximo mensual: $0
- Estrategia: Windows Self-Hosted (100% gratis)
</details>

<details>
<summary>XIV. Deadline y Fases</summary>

- MVP: 6-8 semanas
- V1.0: 12 semanas
</details>

<details>
<summary>XV. Métricas de Éxito</summary>

- NPS target: > 70
- Uptime: > 99%
- KDS response time: < 1 segundo
- Offline functionality: 100% de features core sin internet
- Meseros capacitados en < 30 minutos
</details>

---

*FORCH.i by Paulo Velasco | Built with FORCH.i by Paulo Velasco | https://forch-i-a-hub.vercel.app/*
