# Auditoría responsive base — Rey de la Chelada

Fecha: 2026-08-18  
Alcance: seis PWAs (`meseros`, `clientes`, `caja`, `admin`, `cocina`, `bar`)  
Estado: auditoría completada; implementación aún no iniciada.

## Línea base técnica

- Stack: React 19 + Vite + Express 5 + SQLite.
- Breakpoints declarados: `640px`, `768px`, `1024px`, `1280px`.
- La PWA Meseros usa principalmente `max-width: 480px` y `max-width: 768px`.
- Hay soporte parcial de `100dvh` y `env(safe-area-inset-*)`.
- No existe una estrategia común de `orientation: landscape`/`portrait`.
- Todas las PWAs incluyen `viewport` con `width=device-width`.
- No se encontró bloqueo de orientación en los manifests revisados: el navegador puede girar el dispositivo, pero el layout no tiene optimizaciones específicas por orientación.

## Estado de verificación previo

La ejecución completa de tests terminó con:

- 74 archivos aprobados.
- 674 tests aprobados.
- 1 test fallido en `tests/unit/sync-engine.test.ts`.

Fallo existente de línea base:

> `SyncEngine > reconnection > should flush queued items when the network comes back online` esperaba `/api/sync/push`, pero recibió solo `/api/sync/pull`.

Este fallo no fue causado por los cambios responsive; debe permanecer separado de la validación visual y funcional, y no se debe ocultar al reportar resultados.

## Matriz de hallazgos

| PWA | Estado actual | Riesgos principales | Prioridad |
|---|---|---|---|
| Meseros | Responsive móvil básico hasta `768px`; desktop de dos columnas | Navegación vertical alta, productos densidad baja, carrito apilado, salto brusco en `768px`, sin landscape | Alta |
| Clientes | Tiene reglas para `480px`, `481px` y `1025px`; usa `dvh` y safe areas | Hay saltos de layout amplios, banner/header consumen altura en móvil, falta estrategia tablet/landscape | Alta |
| Caja | Tiene reglas `900px`, `768px` y `480px`; dashboard adaptativo parcial | Headers y navegación pueden ocupar demasiado en móvil; reportes/corte necesitan revisión por altura | Alta |
| Admin | Sidebar cambia a pills en `1023px`; dashboard usa grids auto-fit | Falta validación en tablet vertical y pantallas de baja altura; tablas deben revisarse | Media-alta |
| Cocina | Usa `KDSBoard` compartido | KDS prioriza desktop/TV; móvil cae a una columna; falta orientación/altura explícita | Alta |
| Bar | Usa `KDSBoard` compartido | Mismos riesgos que Cocina; debe mantenerse legible a distancia | Alta |

## Base compartida observada

### Fortalezas

- Tokens de spacing, iconos, tipografía y touch targets centralizados.
- `AppIcon` usa tamaños tipados y tokens.
- Modales usan bottom sheet en tamaños pequeños y diálogo centrado desde `768px`.
- Hay `safe-area-inset` en varias superficies críticas.
- KDS tiene una progresión de 4 → 3 → 2 → 1 columnas.
- Las PWAs conservan la lógica funcional separada de los estilos.

### Deudas comunes

- No existe una capa responsive compartida para alturas bajas y landscape.
- `100dvh` se usa sin fallback sistemático a `100svh`/`100vh` en todos los contenedores.
- Algunos componentes comparten tokens, pero no comparten patrones de shell/header/scroll.
- La regla global de touch target es `48px`, pero algunos layouts agregan padding adicional y producen controles visualmente demasiado altos.
- La mayoría de las validaciones actuales son unitarias/integración; no existe una matriz de screenshots por viewport para las seis PWAs.

## Hallazgos por PWA

### Meseros

Archivos principales:

- `src/pwa/meseros/App.css`
- `src/pwa/meseros/OrderPanel.tsx`
- `src/pwa/meseros/TablesView.tsx`
- `src/modules/salon/components/TableGrid.css`

Hallazgos:

1. Solo hay breakpoints explícitos en `480px` y `768px`.
2. El pedido usa buscador + tabs de área + categorías antes de la lista.
3. Las tabs y categorías tienen targets primarios de `56px`, generando mucha altura acumulada.
4. En móvil el contenido cambia a una sola columna y el carrito queda debajo con `max-height: 52vh`.
5. No hay reglas específicas para landscape ni para tablets entre `769px` y `1023px`.
6. La vista de mesas fuerza dos columnas en móvil aunque el ancho disponible podría permitir más en landscape.

Plan específico: compactar navegación sin bajar targets por debajo de `48px`, lista de productos densa, carrito colapsable/adaptable, grid de mesas por ancho y reglas de landscape.

### Clientes

Archivos principales:

- `src/pwa/clientes/pages/MenuPage.css`
- `src/pwa/clientes/pages/OrderTrackingPage.css`
- `src/pwa/clientes/components/ItemDetailModal.css`

Hallazgos:

1. El banner tiene altura fija de `210px`, potencialmente costosa en celulares pequeños.
2. El header de marca y el banner anteceden a la navegación sticky.
3. La barra inferior reserva `160px`, por lo que debe validarse en alturas pequeñas.
4. Existen breakpoints de móvil y desktop, pero no una estrategia intermedia de tablet ni landscape.
5. El detalle usa `88dvh` y safe area, una base correcta que debe preservarse.

Plan específico: preservar la identidad del menú digital, reducir solo el chrome móvil, revisar la barra de pedido y validar el modal con teclado virtual.

### Caja

Archivos principales:

- `src/pwa/caja/App.css`
- `src/pwa/caja/CollectView.css`
- `src/pwa/caja/ClosingView.tsx`

Hallazgos:

1. Tiene más breakpoints que Meseros, pero no reglas de orientación.
2. Header y navegación están en filas separadas; en móvil pueden consumir una fracción alta de la pantalla.
3. Los grids de métricas usan `minmax(220px, 1fr)` y deben validarse en 320–390px.
4. El corte y el resumen deben mantener números legibles; no se aplicará compactación agresiva.

Plan específico: priorizar legibilidad financiera, compactar navegación, conservar botones de 48px+, y adaptar grids sin tocar el cálculo del día laboral.

### Admin

Archivos principales:

- `src/pwa/admin/App.css`
- `src/pwa/admin/views/views.css`

Hallazgos:

1. Sidebar se convierte en navegación horizontal antes de `1024px`.
2. Falta una diferenciación clara entre tablet vertical, tablet horizontal y laptop baja.
3. Las tablas y editores deben revisarse para evitar overflow horizontal accidental.
4. El dashboard auto-fit ya es una buena base y debe conservarse.

Plan específico: navegación horizontal usable, tablas con estrategia responsive (scroll o tarjetas según vista), y mejor uso de altura.

### Cocina y Bar

Archivos principales:

- `src/ui/components/KDSBoard/KDSBoard.css`
- `src/pwa/cocina/App.tsx`
- `src/pwa/bar/App.tsx`

Hallazgos:

1. Ambos usan el mismo `KDSBoard`, lo que permite mejorar de forma centralizada.
2. La progresión actual es 4 columnas, luego 3, 2 y 1.
3. El KDS está pensado correctamente para pantallas horizontales, pero no distingue landscape de portrait.
4. En pantallas bajas debe priorizarse la altura de las órdenes sin reducir la legibilidad a distancia.
5. Los iconos de header son deliberadamente grandes y no deben compactarse como en Meseros.

Plan específico: mejorar el shell KDS, agregar reglas de altura/orientación, preservar botones grandes y validar visualmente a distancia.

## Viewports de validación

- Celular vertical: `360×640`, `390×844`.
- Celular horizontal: `640×360`, `844×390`.
- Tablet vertical: `768×1024`.
- Tablet horizontal: `1024×768`.
- Laptop: `1280×720`, `1366×768`.
- Desktop: `1440×900`, `1920×1080`.

## Arquitectura de implementación aprobada

1. **Base compartida segura:** utilidades de viewport, safe areas, altura y patrones comunes sin cambiar lógica.
2. **Perfil por PWA:** reglas aisladas por shell (`meseros`, `clientes`, `caja`, `admin`, `kds`).
3. **Auditoría visual individual:** cada PWA se valida en su matriz de viewports.
4. **Pruebas funcionales por módulo:** cada flujo existente debe seguir funcionando.
5. **Deploy gradual:** no se despliega una fase si la fase anterior tiene fallos no explicados.

## Orden de ejecución

1. Base responsive compartida.
2. Meseros.
3. Clientes.
4. Caja.
5. Admin.
6. Cocina y Bar mediante KDS compartido.
7. Verificación integral y deploy gradual.

## Límites de seguridad

No se modificará durante esta iniciativa:

- API, SQLite o contratos de datos.
- autenticación/JWT.
- precios, promociones o modifiers.
- motor de pedidos, rondas, KDS o pagos.
- cierre laboral `15:00 → 06:00`.
- service workers salvo que una prueba de assets lo requiera.
- `data/`, `.env*` ni `package-lock.json`.
