# 📱 Manual de Usuario — Rey de la Chelada

> **Guía para el personal del restobar** (meseros, cocina, bar, caja y administrador).
> Lenguaje simple, pasos numerados. Si algo no se entiende, pregunta al administrador.
> *FORCH.i by Paulo Velasco — Bolivia*

---

## Tabla de contenidos

1. [Introducción](#1-introducción)
2. [Mesero (app Meseros, PIN 1111)](#2-mesero-app-meseros-pin-1111)
3. [Cocina (app Cocina, PIN 2222)](#3-cocina-app-cocina-pin-2222)
4. [Bar (app Bar, PIN 2222)](#4-bar-app-bar-pin-2222)
5. [Caja (app Caja, PIN 3333)](#5-caja-app-caja-pin-3333)
6. [Admin (app Admin, PIN 0000)](#6-admin-app-admin-pin-0000)
7. [Solución de problemas básicos](#7-solución-de-problemas-básicos)

---

## 1. Introducción

**Rey de la Chelada** es el sistema digital del restobar. Reemplaza las libretas y las voces: los pedidos viajan solos desde la mesa del mesero hasta la cocina y el bar.

El sistema tiene **6 apps** (llamadas *PWAs*), todas en el mismo servidor. Cada quien usa la suya:

| App | Para quién | PIN | ¿Cómo se abre? |
|-----|-----------|:---:|----------------|
| 🍺 **Menú Digital** | Clientes | — (sin PIN) | El cliente **escanea el QR de la mesa** con su celular y ve el menú. Puede ver el menú, llamar al mesero, pedir la cuenta y seguir su pedido |
| 🍽️ **Meseros** | Meseros | `1111` | Tablet/celular del mesero |
| 🍳 **Cocina** | Cocineros | `2222` | Pantalla grande o tablet en cocina (fullscreen) |
| 🍹 **Bar** | Bartenders | `2222` | Pantalla o tablet en la barra (mismo PIN que cocina) |
| 💰 **Caja** | Cajeros | `3333` | PC o tablet de la caja |
| ⚙️ **Admin** | Administrador | `0000` | PC del administrador (solo el dueño/encargado) |

**Dispositivos:** cada app se abre en un navegador moderno (Chrome/Edge). Funciona en **PC, tablet o celular**. Se ve igual de bien en pantalla táctil que con mouse.

**Los PINs son compartidos por rol** (todos los meseros usan el mismo PIN). El administrador puede cambiarlos desde la app Admin → **Personal**.

> 💡 **Para entrar a una app de personal**, necesitas la dirección (URL) del sistema, por ejemplo `http://192.168.1.50:3002/meseros/`. El administrador la tiene guardada y puede dejar accesos directos en cada dispositivo.

---

## 2. Mesero (app Meseros, PIN 1111)

### 2.1 Iniciar sesión

1. Abre la app **Meseros** en tu dispositivo.
2. Verás una pantalla con el título **"Meseros"** y un **teclado numérico** (solo números).
3. Escribe tu PIN: **`1111`** — verás los 4 puntos llenándose.
4. Pulsa el botón **✓** (abajo a la derecha).
5. ✅ Listo: entras a la grilla de mesas.

> ❌ Si el PIN es incorrecto verás el mensaje **"PIN incorrecto"** y podrás volver a intentar. Si no hay conexión: **"Sin conexión al servidor"**.

### 2.2 La grilla de mesas (Salón)

Verás todas las mesas como tarjetas con su número, su estado y su capacidad (ej. "4 pers."). Arriba hay una **leyenda de colores** y un contador: **"X libres / Y ocupadas"** — y si hay pedidos listos para servir: **"N listas 🍴"**.

| Estado de la mesa | Color en la grilla | Qué significa |
|-------------------|:---:|---------------|
| **Libre** | Verde | Nadie ocupando. Se puede abrir para armar un pedido |
| **Ocupada** | Ámbar (naranja) | Hay clientes sentados (pedido armándose o recién enviado) |
| **Pedido** | Dorado | Pedido enviado, cocina/bar trabajando |
| **Servida** | Dorado | La comida ya fue entregada a la mesa |
| **Pagando** | Rojo | El cliente está pagando |
| **Cerrada** | Verde claro | Mesa cerrada tras el pago |

**Indicador "🍴 Listo":** cuando la cocina o el bar terminan un pedido, la mesa muestra la etiqueta **"🍴 Listo"** y recibes una notificación: *"Mesa 4 — Pedido listo 🍽️"*. Ese es tu aviso para llevar la comida.

> 🔔 En la parte superior hay un botón **campana** con un número: son las **llamadas de los clientes** (ver [2.6](#26-llamadas-de-clientes)).

### 2.3 Armar un pedido

1. Toca la mesa que quieres atender → abre **"Mesa N — Nuevo Pedido"**.
2. Elige una **categoría** en la barra superior (todo, o con emoji: 🍺 Cervezas, 🍹 Tragos, 🍽️ Comidas, 🥨 Entradas, etc.).
3. Toca un **producto** → se abre una ventana con:
   - **Precio** (ej. "Bs. 15.00")
   - **Modificadores** si el producto los tiene (ej. tamaño, ingredientes extra) — algunos dicen **(requerido)** y hay que elegir sí o sí. Cada opción muestra su precio (+Bs. X).
   - **Notas de preparación** (ej. *"sin hielo, bien cocido…"*)
   - **Cantidad** (botones + y −)
4. Pulsa **"Agregar (Bs. 15.00)"** → el producto pasa al carrito **"Pedido actual (N items)"** a la derecha.
5. Repite hasta completar el pedido. En el carrito puedes: cambiar cantidad, ver los modificadores/notas elegidos, eliminar con **✕** o imprimir la comanda con **🖨️ Imprimir**.
6. Verás el **Total** del pedido.

### 2.4 Enviar el pedido

1. Pulsa el botón grande **"Confirmar Pedido"**.
2. El pedido se envía **solo** a donde corresponde: las **comidas van a Cocina**, las **bebidas/micheladas van al Bar**. (Cada producto tiene su área asignada.)
3. Verás el mensaje: *"Pedido enviado a cocina — Mesa 4"* y pasarás a la pantalla de **Pago**.

### 2.5 Entregar y cobrar

**Entregar (cuando la comida está lista):**

1. Cuando la mesa muestre **"🍴 Listo"**, toca la mesa → verás **"Pedido en curso — Mesa N"**.
2. Revisa el detalle: cada ítem muestra su estado — **Pendiente**, **En prep.**, **Listo**, **Entregado**.
3. Cuando lleves todo a la mesa, pulsa **"✅ Pedido Entregado"**.
4. La pantalla te avisará: *"Pedido servido — listo para el cobro en caja 💰"* (el cobro lo hace la caja, o tú mismo si tu local así lo maneja).

**Cobrar (si el mesero cobra):**

Al confirmar el pedido pasas a la pantalla **"Mesa N — Pago"**, que muestra el resumen y el total:

1. **Propina:** elige **Sin propina**, **5%**, **10%**, **15%** o **Personalizado** (escribes el monto). La propina se registra aparte (no paga IVA).
2. **Forma de pago:** elige el método — 💵 **Efectivo**, 📱 **Yape**, 📱 **QR Simple**, 💳 **Tarjeta**, 🏦 **Transferencia**.
   - En **Efectivo**, si el cliente paga con más, verás el **Cambio** calculado.
   - En **Transferencia**, escribe el **Nº de referencia**.
   - En QR, aparece un código para que el cliente escanee.
   - Puedes pulsar **"+ Dividir pago"** para pagar con varios métodos (ej. mitad efectivo, mitad tarjeta). La barra muestra **"Por cubrir"** y **"✓ Cubierto"** cuando está completo.
3. Pulsa el botón **"Cobrar Bs. XX.XX"**.
4. ✅ La mesa vuelve a **Libre** y el pago queda registrado en caja.

> 🧾 **Facturación:** si el total es **mayor a Bs. 1.000**, la app avisa que **requiere NIT** para factura. Si es menor, es "Factura sin NIT (consumidor final)". La factura con NIT se genera en la app **Caja** → **Facturación** (ver [5.4](#54-facturación)).

### 2.6 Llamadas de clientes

Los clientes pueden llamarte desde su celular (con el QR de la mesa). Tú las ves en la **campana 🔔**:

1. Toca **🔔** (arriba a la derecha, con el número de llamadas pendientes).
2. Verás **"Llamadas pendientes (N)"** con tarjetas por mesa:
   - **"Llama al mesero"** → el cliente te necesita.
   - **"Pide la cuenta"** → el cliente quiere la cuenta.
3. Toca **"Atender"** → la llamada pasa a la sección **"Atendidas"** como **"En camino"**.
4. Cuando hayas atendido, pulsa **"Marcar lista"** → queda **"Completada"**.
5. Si la llamada fue un error, usa **"Cancelar"**.

> 💡 También puedes **cerrar sesión** en cualquier momento: tu nombre + **"· Salir"** (arriba a la derecha).

---

## 3. Cocina (app Cocina, PIN 2222)

La pantalla de cocina (KDS = *Kitchen Display*) se deja **siempre encendida** en modo **pantalla completa** (botón **⛶**). Muestra **solo comidas** (los tragos y cervezas van a la pantalla del Bar).

### 3.1 Qué ves en la pantalla

- **Arriba:** título "🍳 Cocina", el estado de conexión (**Conectado** / **Sin conexión**), el número de **pedidos**, el de **urgentes**, y los botones de **sonido 🔊** y **pantalla completa ⛶**.
- **Al centro:** las tarjetas de pedido, una por mesa:

| Elemento de la tarjeta | Qué es |
|------------------------|--------|
| **#Número grande** | El número de mesa (grande y claro, para verlo de lejos) |
| **Reloj (ej. "12m")** | Minutos transcurridos desde que entró el pedido |
| **Nombre** | El mesero que atendió la mesa |
| **Ítems** | Cada plato con su cantidad (ej. "2x Pique Macho"), modificadores y notas del mesero |
| **Marcador** | Estado de cada ítem: vacío (pendiente), **○** (en prep.), **✓ LISTO**, **ENTREGADO** |

- **Abajo:** contador de **Activos** y **Urgentes**, y la pista *"Tap item → cambiar estado"*.

### 3.2 Cómo trabajar con los pedidos

1. **Pedido nuevo:** suena una **alerta sonora** y la tarjeta parpadea. Es un pedido nuevo en espera de aceptación.
2. **Aceptar:** si el pedido está en estado **Confirmado**, la tarjeta muestra los botones **"Aceptar Pedido"** y **"Rechazar"**.
   - **"Aceptar Pedido"** → el pedido pasa a **en preparación** (todos los ítems pendientes se marcan como en curso).
   - **"Rechazar"** → se cancelan los ítems pendientes (por ejemplo, si ya no hay un plato).
3. **Marcar avance:** toca cada ítem para avanzar su estado: **pendiente → en prep. → listo → entregado**. Así el mesero ve en su app el avance en tiempo real y sabe cuándo llevar la comida.
4. **Pedido completo:** cuando todos los ítems están entregados, la tarjeta muestra **"✓ COMPLETADO"**.
5. **Urgente:** si un pedido lleva **más de 15 minutos**, se pone en **modo urgente** (borde/pulso rojo, suena otra alerta, y se ordena primero en la pantalla).

> 💡 Cuando marcas un ítem como **listo (✓)**, el mesero recibe la notificación *"Mesa N — Pedido listo 🍽️"* y su grilla muestra el badge **"🍴 Listo"**. Esa es la señal para que vayan a servir.

> 🔇 ¿Molesta el sonido? Toca **🔊** para silenciar. ¿Pantalla pequeña? Toca **⛶** para pantalla completa (y de nuevo para salir).

---

## 4. Bar (app Bar, PIN 2222)

La pantalla del bar funciona **exactamente igual que la de cocina**, pero muestra **solo bebidas, cervezas y micheladas** (los platos van a cocina). Tiene su acento visual ámbar/dorado.

Usa el **mismo PIN `2222`** que cocina (rol compartido "KDS").

**Flujo igual que cocina:**
1. Pedido nuevo → alerta sonora + parpadeo.
2. **"Aceptar Pedido"** → en preparación.
3. Toca cada ítem para avanzar: **pendiente → en prep. → ✓ LISTO**.
4. El mesero ve tu avance en su app y sirve la bebida cuando está lista.

> ⚠️ **Ojo con los pedidos mixtos:** si una mesa pide un Pique Macho **y** una Chelada, la comida aparece en **Cocina** y la chelada en **Bar**, cada una en su pantalla. Cada área marca solo sus ítems.

---

## 5. Caja (app Caja, PIN 3333)

La caja maneja el dinero: cobrar mesas, ver las ventas del día y hacer el **corte de caja**. Tiene 4 pestañas en la parte superior: **Resumen · Cobrar · Cierre · Facturación**. Arriba verás la **fecha de hoy** (hora de Bolivia).

> Solo entran el **cajero** (PIN `3333`) y el **administrador** (PIN `0000`). Si otro rol intenta entrar, la app muestra *"Acceso restringido"*.

### 5.1 Resumen (ventas del día)

- **Ventas del día:** total vendido hoy, con el número de **pedidos** y de **pagados**.
- **Ticket promedio:** cuánto gasta un cliente en promedio (y la **venta bruta**).
- **IVA 13%:** el impuesto extraído de las ventas (con la **base imponible**).
- **Pedidos:** totales y **cancelados**.
- **Ventas por método de pago:** una barra por método (💵 Efectivo, 📱 Yape/QR, 💳 Tarjeta, 🏦 Transferencia) con su monto.
- Botón **"📄 Exportar CSV"**: descarga el reporte del día en Excel/CSV.

> El Resumen se actualiza solo cada 30 segundos y al recibir eventos (cuando se cobra una mesa, por ejemplo).

### 5.2 Cobrar (pedidos pendientes)

1. Entra a la pestaña **"Cobrar"**.
2. Verás el resumen: **"N pedidos pendientes de cobro — Bs. X"** (o "🎉 Sin pedidos pendientes").
3. La lista muestra cada pedido: **Mesa N**, estado (**Enviado / Confirmado / En preparación / Listo / Servido**), nº de ítems y el **saldo** (Bs.).
4. Toca un pedido para expandirlo:
   - Detalle de ítems y **total** (con desglose de IVA).
   - **Método:** 💵 Efectivo / 📱 Yape / 📱 QR Simple / 💳 Tarjeta / 🏦 Transferencia.
   - **Propina:** **Sin** / 5% / 10% / 15%.
5. Pulsa **"Cobrar Bs. XX.XX"**.
   - Si el pedido se cubre completo: *"Mesa N cobrada ✓"* y desaparece de la lista.
   - Si es pago parcial (se divide en varios cobros), te avisa el **restante**.
6. ✅ La mesa queda libre automáticamente cuando se termina de pagar.

### 5.3 Cierre (corte de caja)

El corte de caja se hace al cerrar el día (o al cambiar de turno):

1. Pestaña **"Cierre"**.
2. Si **no hay corte abierto**: pulsa **"Abrir Corte de Caja"** → se inicia el corte del día.
3. Con el corte activo verás:
   - **Iniciado:** cuándo se abrió.
   - **Efectivo esperado (ventas del día):** lo que la caja debería tener.
   - **Efectivo real en caja:** cuenta físicamente el dinero y escribe el monto.
   - **Diferencia:** la app calcula `real − esperado` (ej. **+Bs. 10.00** o **−Bs. 5.00**).
   - **Notas:** observaciones del cierre (opcional).
4. Si hay diferencia y está justificada (ej. gastos menores), pulsa **"Marcar diferencia conciliada"** ✓.
5. Pulsa **"Cerrar Día"** → el corte queda cerrado y pasa al historial del Admin (sección **Cortes**). También puedes **"🖨️ Imprimir cierre"**.
6. Abajo, **"Resumen de hoy"** muestra: total ventas, IVA, pedidos, y ventas por método (efectivo, QR, tarjeta, transferencia).

### 5.4 Facturación

Para facturas con NIT (requeridas en montos mayores a Bs. 1.000):

1. Pestaña **"Facturación"** → **"Generar Factura"**.
2. Completa: **NIT / CI**, **Razón Social / Nombre**, **Nº de Pedido** y **Monto (Bs.)**.
3. Pulsa **"Generar Factura"** (registra la factura) o **"🖨️ Imprimir factura"**.

> ℹ️ **Nota técnica:** por defecto la facturación es **manual** (la integración con el sistema electrónico SIN de Bolivia está prevista pero no configurada). La app lo indica con el mensaje *"Factura manual — SIN no configurado"*.

---

## 6. Admin (app Admin, PIN 0000)

Panel exclusivo del administrador (dueño/encargado). Tiene un **menú lateral** con 7 secciones: **📊 Dashboard · 💲 Precios · 📦 Carga Masiva · 🍕 Tamaños · 👥 Personal · 🪑 Mesas · 🧾 Cortes**.

### 6.1 Dashboard (📊)

Resumen de un vistazo:
- **Items del menú:** cuántos productos hay y cuántos **SIN PRECIO** (si hay alguno, avisa: *"N item(s) sin precio — usa Precios o Carga Masiva"*).
- **Precios cargados:** porcentaje del menú con precio.
- **Mesas:** total y cuántas **libres**.
- **Ventas de hoy:** monto y **cortes** cerrados hoy.

### 6.2 Precios (💲)

Edición de precios **producto por producto**:
1. Busca el producto en la lista.
2. Escribe el nuevo precio y guarda. El cambio se refleja al instante en el menú (los precios **incluyen IVA**).

### 6.3 Carga Masiva (📦)

Cambiar precios **de muchos productos a la vez** por categoría: eliges la categoría, defines el nuevo precio y aplicas a todos (útil para ajustes generales).

### 6.4 Tamaños (🍕)

Precios de las **opciones/tamaños** de los productos que los tienen (Mediana y Familiar de las pizzas), uno por uno o en masa.

### 6.5 Personal (👥)

Gestión de los accesos del personal (3 roles fijos):

| Rol | Estado por defecto |
|-----|--------------------|
| **Administrador** | PIN `0000` |
| **Mesero** | PIN `1111` |
| **KDS (Cocina/Barra)** | PIN `2222` |

Por cada rol puedes:
- Cambiar el **nombre visible** (ej. "Juan").
- Cambiar el **PIN** (nuevo PIN de 4 a 6 dígitos → botón **"Cambiar PIN"**).

> ⚠️ Los PINs se guardan **protegidos** (hash): no se pueden ver, solo reemplazar. El PIN es **compartido por rol** (todos los meseros comparten el mismo).
> 📌 *Hallazgo de documentación:* esta pantalla muestra los roles **admin / mesero / kds**. El rol **cajero (3333)** existe en el sistema y entra a la app Caja, pero **no aparece en esta pantalla** en la versión actual — su PIN se cambia vía archivo `.env` (`CAJA_PIN`).

### 6.6 Mesas (🪑)

- Lista las mesas con su **estado**, **capacidad** (ej. "4 pers.") y **sección** (interior/terraza).
- **"+ Agregar mesa"**: crea una mesa nueva (número 1-50 y capacidad).
- **🗑**: elimina una mesa — **solo si está libre** (con pedidos activos no se puede).
- **QR**: muestra el **código QR de la mesa** (menú digital). Es un QR **estático**: se genera una vez, se imprime (**🖨 Imprimir QR**) y se pega en la mesa. Cuando el cliente lo escanea, se crea su sesión automáticamente.

### 6.7 Cortes (🧾)

Historial de los **cortes de caja cerrados**: fecha, esperado vs real, diferencia y si quedó **Cuadrado** (diferencia 0), **Conciliado** o con **Diferencia**. (El corte del día se abre/cierra en la app Caja → **Cierre**.)

---

## 7. Solución de problemas básicos

| Problema | Qué hacer |
|----------|-----------|
| **"PIN incorrecto"** | Verifica que el PIN es el de tu rol (mesero `1111`, cocina/bar `2222`, caja `3333`, admin `0000`). Si sigue fallando, el administrador debe cambiarlo en Admin → **Personal** |
| **"Sin conexión al servidor"** al iniciar sesión | El dispositivo no alcanza el servidor. Revisa que el celular/tablet está en la **misma red WiFi** que la PC del sistema, y que la URL es la correcta (la IP de la PC, no "localhost") |
| **El menú del cliente no carga / no envía el pedido** | El **menú se puede ver sin conexión** (se guarda en el celular), pero **enviar pedidos, llamar al mesero y pedir la cuenta requieren conexión**. Revisa el WiFi del cliente |
| **Un pedido no aparece en cocina/bar** | 1) Confírmalo en la app Meseros (¿quedó "Confirmado"?). 2) Verifica el **área** del producto: comidas → Cocina, bebidas → Bar. 3) Revisa que la pantalla KDS esté conectada (badge **"Conectado"**) y toca refrescar. 4) Si nada, avisa al administrador |
| **El KDS dice "Sin conexión"** | El servidor dejó de responder o la red falló. El sistema tiene un **vigilante automático (watchdog)** que reinicia el servidor solo; espera un par de minutos y recarga la página |
| **¿Cómo reiniciar el sistema?** | ⚠️ **Es tarea del administrador, no del mesero.** Se usa `scripts\stop.bat` y luego `scripts\start.bat` en la PC del sistema (o `scripts\update.bat` para actualizar). Como personal: si algo falla, **avisa al administrador** en vez de apagar la PC |
| **El pedido del cliente no llega** (clientes) | El cliente debe tocar "Enviar" y tener conexión. Si el pedido quedó en *"El mesero se acerca…"*, el mesero debe **confirmarlo** en su app |

### Estados del pedido (para entender qué pasa con cada uno)

| Estado | Dónde se ve | Qué significa |
|--------|-------------|---------------|
| **Borrador** | Meseros | Armándose, aún no enviado |
| **Enviado** | Meseros/Caja | Enviado por el mesero, esperando confirmación |
| **Confirmado** | Cocina/Bar | Aceptado y en la pantalla KDS (botón "Aceptar Pedido") |
| **En preparación** | Cocina/Bar | Se está cocinando/preparando |
| **Listo** | Cocina/Bar/Meseros | Listo para servir → badge "🍴 Listo" en meseros |
| **Servido** | Meseros | Entregado a la mesa → listo para cobrar |
| **Pagado** | Caja | Cobrado, mesa libre |

---

*Rey de la Chelada — FORCH.i by Paulo Velasco · Built with FORCH.i by Paulo Velasco · https://forch-i-a-hub.vercel.app/*
