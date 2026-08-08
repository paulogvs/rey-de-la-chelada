# 🚀 Manual de Instalación — Rey de la Chelada

> **Sistema de gestión para Restaurante/Bar** · 6 apps en una · Windows Self-Hosted
> *FORCH.i by Paulo Velasco — Bolivia*
> **Versión del manual:** 1.0 · **App:** v1.0.0 · **Branch de referencia:** `redesign/premium-amber-glass`

Este manual explica, paso a paso y en lenguaje claro, cómo instalar el sistema en una **PC nueva** del restaurante. Si ya tienes el sistema funcionando, salta directo a la sección [6. Verificación final](#6-verificación-final).

---

## Tabla de contenidos

1. [Requisitos](#1-requisitos)
2. [Qué copiar a la PC nueva](#2-qué-copiar-a-la-pc-nueva)
3. [Instalación paso a paso](#3-instalación-paso-a-paso)
4. [Flags (opciones avanzadas)](#4-flags-opciones-avanzadas)
5. [Post-instalación: operación diaria](#5-post-instalación-operación-diaria)
6. [Verificación final](#6-verificación-final)
7. [Solución de problemas](#7-solución-de-problemas)
8. [Referencia rápida de archivos](#8-referencia-rápida-de-archivos)

---

## 1. Requisitos

| Requisito | Detalle | ¿Automático? |
|-----------|---------|:---:|
| **Windows** | Windows 10 u 11 (64 bits) | ✅ |
| **Node.js** | LTS versión **20 o superior** (el instalador lo descarga e instala solo si no existe, vía `winget`) | ✅ automático |
| **npm** | Viene incluido con Node.js | ✅ |
| **Git** | Cliente de Git (también se instala solo si falta, vía `winget`) | ✅ automático |
| **Red LAN/WiFi** | Los celulares del personal y los clientes deben poder **alcanzar la PC** en la red. Ideal: la PC conectada por cable a la misma red WiFi del local | ⚠️ configuración de red |
| **Puerto 3002 libre** | La app usa el **puerto 3002** (el 3001 está ocupado por otra app). Si otro programa usa el 3002, ver [Solución de problemas](#7-solución-de-problemas) | ⚠️ verificar |
| **Privilegios de Administrador** | El instalador pide elevación UAC automáticamente | ✅ pedido automático |
| **Internet** | Solo durante la instalación (descarga el código desde GitHub) y al actualizar. Después el sistema funciona **local** | ⚠️ |

> 💡 **¿Cómo saber si Node.js ya está instalado?** Abre una ventana de comandos (tecla Windows → escribe `cmd` → Enter) y escribe: `node -v`. Si te muestra una versión (ej. `v22.x.x`), está listo. Si dice "no se reconoce", el instalador lo pondrá solo.

> 💡 **¿Cómo saber si el puerto 3002 está libre?** En la misma ventana de comandos: `netstat -ano | findstr :3002`. Si **no aparece nada**, está libre.

---

## 2. Qué copiar a la PC nueva

Antes de instalar necesitas **3 archivos**. El sistema **no se descarga con un instalador universal**: se copian estos archivos a la PC nueva (por USB, carpeta compartida, etc.) y el instalador hace el resto.

| Archivo | ¿Qué es? | ¿Viene en git? |
|---------|----------|:---:|
| `setup.bat` | El instalador automático | ✅ sí (en `scripts/`) |
| `elevate.vbs` | Auto-elevación a Administrador (UAC) | ✅ sí (en la raíz) |
| `.env` | **Configuración y secretos** del sistema | ❌ **NO está en git** — se copia **a mano** |

### ⚠️ El archivo `.env` (muy importante)

El `.env` contiene la configuración privada (secretos) y **por seguridad NO se sube a GitHub**. Debes tener una copia guardada (por ejemplo, en un USB del administrador o en el `.env` de la PC actual) y copiarla **junto a `setup.bat`** antes de instalar.

**Contenido mínimo del `.env`:**

```ini
# ── Rey de la Chelada — .env ─────────────────────────
PORT=3002
PUBLIC_BASE_URL=http://192.168.1.50:3002   # ← IP de ESTA PC en la red local
JWT_SECRET=aquí_va_un_secreto_largo_e_imposible_de_adivinar
GITHUB_REPO=paulogvs/rey-de-la-chelada
GITHUB_BRANCH=main
```

| Variable | Para qué sirve |
|----------|----------------|
| `PORT` | Puerto del servidor (3002 por defecto — no cambies salvo que sea necesario) |
| `PUBLIC_BASE_URL` | **La URL que se imprime en los QR de las mesas.** Debe ser accesible desde el **celular del cliente**, NO desde el localhost de la caja. Pon la **IP LAN del servidor** (ej. `http://192.168.1.50:3002`) o tu dirección Tailscale. Si la dejas vacía, usa la del navegador que abra el QR. |
| `JWT_SECRET` | **Secreto de seguridad** que firma los inicios de sesión. Mínimo 32 caracteres. |
| `GITHUB_REPO` / `GITHUB_BRANCH` | De dónde se descarga el código (repositorio público — sin token). |

> Existe un archivo de ejemplo `env.example` en la raíz del proyecto con **todas** las variables opcionales documentadas (impresora, IVA, NIT, métodos de pago, etc.). Puedes basarte en él, pero el mínimo para instalar es el de arriba.

### 🔑 Cómo generar un `JWT_SECRET` fuerte

Abre una ventana de comandos y ejecuta:

```bat
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Copia el resultado (64 caracteres aleatorios) y pégalo en `JWT_SECRET=`. Ejemplo de salida:

```
JWT_SECRET=7f3a9c2b8d4e6f1a0b5c7d9e2f4a6b8c0d1e3f5a7b9c1d2e4f6a8b0c2d4e6f8a
```

> 🔒 Si `JWT_SECRET` está vacío o no existe, el sistema arranca igual pero con un secreto de **desarrollo** (aparece una advertencia en consola). Para producción siempre usa un secreto real.

---

## 3. Instalación paso a paso

### Paso 0 — Doble clic en `setup.bat`

Coloca `setup.bat`, `elevate.vbs` y `.env` en una carpeta (ej. `C:\ReyChelada`). Haz **doble clic** en `setup.bat`.

El instalador detecta que no eres administrador y **pide elevación (UAC) automáticamente**:

> "Este instalador necesita permisos de Administrador. Solicitando elevación UAC, acepta el prompt…"

Pulsa **Sí** en la ventana de Windows. Luego el instalador muestra un mensaje de bienvenida y te pide **pulsar cualquier tecla para comenzar**.

> ⏱️ **Tiempo total estimado:** 4 a 10 minutos (depende de la velocidad de internet, ya que descarga el código y las dependencias).

### Las 7 fases del instalador

| Fase | Qué hace | Tiempo aprox. | Qué debes verificar |
|------|----------|:---:|---------------------|
| **[1/7] Prerequisitos** | Verifica/instala Node.js, npm y Git (con `winget` si faltan) | 10 s – 3 min | Mensajes `[OK]` para los tres |
| **[2/7] Carga `.env`** | Lee tu configuración (puerto, repo, secretos) | < 1 s | `[OK] Configuración cargada` con App, Puerto y Repo. **Si falla aquí es porque falta el `.env`** (ver [Solución de problemas](#7-solución-de-problemas)) |
| **[3/7] Clone / Pull** | **Primera vez:** descarga el código desde GitHub (`git clone`). **Ya instalado:** actualiza el código (`git pull`) | 30 s – 2 min | `[OK] Repositorio clonado` o `[OK] Código actualizado` |
| **[4/7] Instalación de dependencias** | Instala todas las librerías: `npm install --legacy-peer-deps` | 2 – 5 min | `[OK] Dependencias instaladas`. **Requiere internet** |
| **[5/7] Build** | Compila las **6 apps** (clientes, cocina, bar, meseros, caja, admin) | 30 s – 2 min | `[OK] Build completado, 6 PWAs` (verifica que exista la carpeta `dist\clientes`) |
| **[6/7] Firewall + arranque** | Abre el **puerto 3002 en el firewall** (para que los celulares de la red entren) y **arranca el servicio en segundo plano** (sin ventana) | 10 – 20 s | `[OK] Regla de firewall TCP 3002 garantizada` y `[OK] Servicio iniciado (oculto)` |
| **[7/7] Health Check** | Comprueba que la app responde (prueba hasta 15 segundos) | 5 – 15 s | `[OK] App responde correctamente en localhost:3002` |

Al terminar verás la pantalla final:

```
==========================================
  SETUP COMPLETADO
  Rey de la Chelada
==========================================
  Local:     http://localhost:3002/clientes/
  Admin:     http://localhost:3002/admin/
  Detener:   scripts\stop.bat
  Iniciar:   scripts\start.bat
  Actualizar: scripts\update.bat
```

> 📌 **Detalle importante:** al terminar, el instalador **mueve `setup.bat` a la carpeta `scripts\`** (la raíz queda limpia, solo con `.env`). Es normal y esperado — de ahora en adelante todo vive en `scripts\`.

---

## 4. Flags (opciones avanzadas)

Se ejecutan desde una ventana de comandos dentro de la carpeta:

```bat
setup.bat --dry-run     "Vista previa: muestra qué haría SIN ejecutar nada"
setup.bat -n            "Igual que --dry-run (abreviatura)"
setup.bat --skip-pull   "No descargar código de GitHub: usar el código local existente"
setup.bat --skip-pull --dry-run   "Combinación (el flag puede ir en 1ª o 2ª posición)"
```

| Flag | Uso típico |
|------|-----------|
| `--dry-run` | Probar que la configuración es correcta antes de instalar de verdad |
| `--skip-pull` | Reinstalar/configurar sin tocar el código ya descargado (útil si no hay internet o si editaste algo localmente) |

---

## 5. Post-instalación: operación diaria

Todo se maneja con los scripts de la carpeta `scripts\` (o con `npm run <comando>` si estás en la raíz):

| Tarea | Comando | Qué hace |
|-------|---------|----------|
| ▶️ **Iniciar** el servicio | `scripts\start.bat` | Arranca el servidor en segundo plano (oculto, sin ventana). Si ya está corriendo, lo detecta y no duplica |
| ⏹️ **Detener** el servicio | `scripts\stop.bat` | Mata el proceso que escucha en el puerto 3002 y verifica que quedó libre |
| 🔄 **Actualizar** | `scripts\update.bat` | Baja la última versión de GitHub → instala dependencias → compila → **reinicia el servicio** (patrón "pull → install → build → restart"). Si hay conflictos locales: `scripts\update.bat --force` |
| 💾 **Backup** de la base de datos | `scripts\backup.bat` | Copia la base de datos a `backups\backup-AAAAMMDD_HHMMSS.db` y conserva **los últimos 7 días** (borra los más viejos). Registra todo en `logs\backup.log` |

### 🗓️ Agenda el backup automático (recomendado: 1 vez)

```bat
scripts\install-backup-schedule.bat
```

Crea la tarea programada **`ReyChelada-Backup`** que ejecuta el backup **todos los días a las 01:00** (cuando el local está cerrado). Comandos útiles:

```bat
schtasks /query /tn "ReyChelada-Backup"      "Ver la tarea creada"
schtasks /run /tn "ReyChelada-Backup"        "Ejecutarla ahora (una vez)"
schtasks /delete /tn "ReyChelada-Backup" /f  "Desagendar (eliminar la tarea)"
```

> ⚠️ Ejecútalo **una sola vez** (se auto-instala). Si no tienes permisos, ábrelo como administrador.

### 🐕 Watchdog (vigilante automático) — recomendado

El watchdog revisa cada **5 minutos** que el servidor esté sano (endpoint `/health`). Si falla **3 veces seguidas**, mata el proceso del puerto y **relanza el servicio solo**.

```bat
scripts\watchdog-start.bat    "Lanzar el watchdog en segundo plano"
scripts\watchdog-stop.bat     "Detenerlo limpiamente (en su próximo ciclo)"
```

**Configuración recomendada (Task Scheduler):** para que arranque solo al **inicio de sesión** del equipo, crea una tarea programada con:
- **Programa:** `powershell.exe`
- **Argumentos:** `-ExecutionPolicy Bypass -WindowStyle Hidden -File "C:\ReyChelada\scripts\watchdog.ps1"`

Todo lo que hace el watchdog queda registrado en **`logs\watchdog.log`**.

> 💡 **Resumen de archivos de registro (logs):**
> - `logs\app-AAAA-MM-DD.log` — actividad del servidor (uno por día, retención 7 días)
> - `logs\backup.log` — resultado de cada backup
> - `logs\watchdog.log` — actividad del vigilante

---

## 6. Verificación final

### 6.1 Abre las 6 apps

En la PC del restaurante (o desde cualquier celular/tablet en la misma red, cambiando `localhost` por la **IP de la PC**):

| App | URL | ¿Para quién? |
|-----|-----|--------------|
| 🍺 **Menú Digital** (clientes) | `http://localhost:3002/clientes/` | Clientes — público, sin PIN |
| 🍳 **Cocina** (KDS) | `http://localhost:3002/cocina/` | Cocinero — PIN |
| 🍹 **Bar** (KDS) | `http://localhost:3002/bar/` | Bartender — PIN |
| 🍽️ **Meseros** | `http://localhost:3002/meseros/` | Meseros — PIN |
| 💰 **Caja** | `http://localhost:3002/caja/` | Cajero — PIN |
| ⚙️ **Admin** | `http://localhost:3002/admin/` | Administrador — PIN |

> La raíz `http://localhost:3002/` redirige automáticamente al menú de clientes.

### 6.2 Prueba el login con los PINs reales

La base de datos se crea y llena **automáticamente en el primer arranque** (staff + mesas + menú). Estos son los PINs por rol:

| Rol | PIN | Accede a |
|-----|:---:|----------|
| **Administrador** | `0000` | Admin + **todas** las demás apps |
| **Mesero** | `1111` | Meseros |
| **KDS** (cocina/barra) | `2222` | Cocina y Bar |
| **Cajero** | `3333` | Caja |

> 🔧 **Configurables:** estos PINs se pueden cambiar editando `.env` (`ADMIN_PIN`, `MESERO_PIN`, `KDS_PIN`, `CAJA_PIN`) **antes** del primer arranque, o desde la app Admin (sección **Personal**) después. El PIN es **compartido por rol** (todos los meseros usan el mismo).

### 6.3 Checklist final

- [ ] Las 6 URLs abren correctamente desde la PC
- [ ] Desde un **celular en la red WiFi** se abre al menos el menú de clientes usando la **IP LAN** (prueba el QR de una mesa)
- [ ] Login con PIN `0000` en Admin funciona
- [ ] El backup se puede ejecutar a mano: `scripts\backup.bat` → revisa que aparezca un `.db` en `backups\` y el `[OK]` en `logs\backup.log`
- [ ] (Opcional) Backup automático y watchdog agendados

---

## 7. Solución de problemas

| Síntoma | Causa probable | Solución |
|---------|---------------|----------|
| **"No se encontró .env"** al arrancar | El `.env` no está en la carpeta correcta | Copia el `.env` **junto a `setup.bat`** (en la carpeta de instalación) y vuelve a ejecutar. El `.env` **nunca** viaja por git |
| **El puerto 3002 está ocupado** | Otro programa o una instancia anterior del servicio | Ejecuta `scripts\stop.bat`. Si no funciona: `netstat -ano \| findstr :3002`, anota el PID (última columna) y mata el proceso: `taskkill /f /pid <PID>` |
| **Regla de firewall no creada** (`[WARN]`) | El instalador no corrió como administrador | Re-ejecuta `scripts\setup.bat` (se auto-eleva) o crea la regla manualmente como admin:<br>`New-NetFirewallRule -DisplayName "Rey de la Chelada :3002" -Direction Inbound -Protocol TCP -LocalPort 3002 -Action Allow -Profile Any` |
| **Build falla** (fase 5/7) | Dependencias incompletas, o Node.js muy antiguo | Revisa que Node sea **LTS 20+** (`node -v`). Reinstala dependencias: `npm install --legacy-peer-deps` y repite `npm run build`. Lee el error en pantalla (copia el mensaje rojo) |
| **La app no responde al final** (`[AVISO]`) | Está iniciando aún, o falló algo en el arranque | Espera 10-20 s y abre `http://localhost:3002/clientes/`. Si no carga, revisa `logs\app-AAAA-MM-DD.log` |
| **El backup no corre solo** | La tarea programada no se creó o no tiene permisos | Verifica: `schtasks /query /tn "ReyChelada-Backup"`. Si no existe, ejecuta `scripts\install-backup-schedule.bat` como administrador. Para probar: `schtasks /run /tn "ReyChelada-Backup"` y luego mira `logs\backup.log` |
| **Backup dice `[SKIP]`** | No se encontró la base de datos | La base está en `data\rey-de-la-chelada.db`. Si no existe aún, arranca la app una vez (crea la DB al primer inicio) y reintenta |
| **El watchdog no arranca** | No está lanzado, o la tarea de inicio de sesión no existe | Ejecuta `scripts\watchdog-start.bat` y revisa `logs\watchdog.log`. Para que arranque solo, crea la tarea de Task Scheduler al inicio de sesión (ver [§5](#5-post-instalación-operación-diaria)) |
| **¿Dónde están los logs?** | — | `logs\` en la raíz del proyecto: `app-AAAA-MM-DD.log` (servidor), `backup.log` (backups), `watchdog.log` (vigilante) |

### 🔁 ¿Todo se rompió? Reinstala limpio

1. `scripts\stop.bat` (detener servicio)
2. `scripts\update.bat --force` (reset a la última versión + reinstalar + compilar + reiniciar)

---

## 8. Referencia rápida de archivos

| Archivo / Carpeta | Para qué es |
|-------------------|-------------|
| `setup.bat` | Instalador automático (7 fases) — vive en `scripts\` tras instalar |
| `elevate.vbs` | Eleva `setup.bat` a Administrador (UAC) |
| `.env` | Configuración y secretos (NO está en git) |
| `.env.example` | Plantilla con todas las variables documentadas |
| `scripts\start.bat` / `stop.bat` | Iniciar / detener el servicio |
| `scripts\update.bat` | Actualizar desde GitHub (+ `--force` para reset) |
| `scripts\backup.bat` | Backup de la base de datos (retención 7 días) |
| `scripts\install-backup-schedule.bat` | Agenda el backup diario a las 01:00 |
| `scripts\watchdog.ps1` / `watchdog-start.bat` / `watchdog-stop.bat` | Vigilante de salud + reinicio automático |
| `scripts\start-hidden.vbs` | Arranca el servidor oculto (sin ventana) |
| `data\rey-de-la-chelada.db` | Base de datos SQLite (NO borrar sin backup) |
| `backups\` | Copias de seguridad con fecha |
| `logs\` | Registros: app, backup y watchdog |

---

*Rey de la Chelada — FORCH.i by Paulo Velasco · Built with FORCH.i by Paulo Velasco · https://forch-i-a-hub.vercel.app/*
