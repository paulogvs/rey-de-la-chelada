# 🚀 PRODUCCIÓN PC NUEVA — Runbook resumible por opencode

> **INSTRUCCIÓN CANARIO:** Si el usuario dice algo como **"instala este proyecto para llevarlo a producción"**, **"ponerlo en produccion"**, **"desplegar en la PC nueva"** o similar → **sigue este documento de principio a fin** y **pregunta** en cada punto marcado con ⚠️.

> **Qué harás:** llevar el proyecto *Rey de la Chelada* (React 19 + Express 5 + SQLite + multi-PWA) a producción en una PC nueva con Windows, self-hosted, detrás de Tailscale. Serás TÚ quien ejecute todo (open_code / agente), pidiendo al humano solo lo que requiere credenciales o decisiones (⚠️).

---

## 📋 Panorama del objetivo

- **Una PC servidor** (Windows 10/11, Node >= 22.9, puerto 3002) que corre la API + 6 PWAs.
- **Acceso local** (`localhost`) para caja/admin.
- **Acceso LAN** (`http://<IP LAN>:3002`) para celulares del personal/clientes.
- **Acceso remoto** vía **Tailscale** (`http://<IP tailscale>:3002`).
- **Launchers** (`launchers/`): 19 HTML de acceso rápido por doble clic.
- **Menú**: gestionado por Admin UI (`MENU_MANAGEMENT=admin`).
- **Backups** automáticos, **watchdog** de auto-reinicio, **firewall** abierto en 3002.

---

## 🧩 FASE 0 — INICIO

1. **Verifica que estás en la carpeta del proyecto** (donde está `package.json`, `src/`, `server/`, `scripts/`). Si no, navega a ella.
2. **Confirma el estado del repo**: `git log --oneline -1`. Debe haber un commit (ej. `docs: ...` o el último de producción). Si está vacío, detente y avisa.
3. Lee también (referencia rápida): `docs/MANUAL_DE_INSTALACION.md` y `docs/ARQUITECTURA_Y_PRODUCCION.md`.

---

## 🧩 FASE 1 — PRERREQUISITOS DEL SISTEMA

### 1.1 Node.js + git
```bash
node -v    # debe ser >= 22.9.0 (necesario por --env-file-if-exists)
git --version
```
- **Si `node` no existe o es < 22.9:** instálalo. En Windows, lo más simple es el instalador oficial o `winget`:
  ```bash
  winget install OpenJS.NodeJS.LTS
  ```
  Tras instalar, **abre una terminal nueva** (para refrescar el PATH) y verifica `node -v`.

### 1.2 Dependencias del proyecto
El único paso crítico: **`--legacy-peer-deps` es OBLIGATORIO** (peer deps de React 19 + typescript-eslint chocan).
```bash
npm install --legacy-peer-deps
```
> Si ya existe `node_modules/` de una copia previa, borra y reinstala: `Remove-Item -Recurse -Force node_modules` → `npm install --legacy-peer-deps`.

### 1.3 Puerto 3002 libre
```bash
netstat -ano | findstr :3002
# Si aparece algo en ESCUCHA, hay conflicto: detener ese proceso o cambiar PORT en .env
```

---

## 🧩 FASE 2 — CONFIGURACIÓN (.env)

El `.env` **NO está en git** (contiene secretos). **Debes generarlo** con valores de ejemplo y pedir al humano que complete los secretos. Usa `.env.example` como base.

```bash
# Si no existe .env, crear desde la plantilla
copy .env.example .env
```

Luego edita el `.env` (⚠️ **pregunta al humano** por los valores que no puedas inferir):

| Variable | Valor | Quién | Nota |
|----------|-------|-------|------|
| `PORT` | `3002` | auto | Puerto del server |
| `NODE_ENV` | `production` | auto | ⚠️ **en producción exige `JWT_SECRET`** |
| `DB_PATH` | `data/rey-de-la-chelada.db` | auto | SQLite |
| `MENU_MANAGEMENT` | `admin` | auto | El Admin UI gestiona el menú (no pisar ediciones) |
| `JWT_SECRET` | `<secreto>` | ⚠️ **humano** | Mínimo 32 chars. Generar: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `PUBLIC_BASE_URL` | `http://<IP tailscale o LAN>:3002` | ⚠️ **humano** | URL de los QR de mesas. Se detecta en Fase 4 |
| `API_READ_RATE_LIMIT_MAX` | `10000` | auto | Lecturas/15min (19 dispositivos) |
| `API_WRITE_RATE_LIMIT_MAX` | `2500` | auto | Escrituras/15min |
| `AUTH_RATE_LIMIT_MAX` | `60` | auto | Login/min (staff simultáneo) |
| `JWT_EXPIRES_IN` | `24h` | auto | |
| `GITHUB_REPO` / `GITHUB_BRANCH` | `paulogvs/rey-de-la-chelada` / `main` | auto | Repo público |

> ⚠️ **No crees el archivo hasta tener el `JWT_SECRET`** (o déjalo marcado y pídelo antes del primer arranque). En `NODE_ENV=production`, sin `JWT_SECRET` el server **aborta** (fail-loud). Puedes arrancar en `development` temporalmente si el humano aún no define el secreto, pero avisa.

---

## 🧩 FASE 3 — TAILSCALE

**Objetivo:** acceso remoto seguro a la app desde cualquier dispositivo (celular desplaçado, otra PC, etc.) sin exponer el puerto a internet.

### 3.1 El humano crea/configura la red Tailscale (⚠️ INSTRUCCIONES, NO auto)
> En la PC nueva, el humano debe abrir una terminal y:
> 1. Instalar Tailscale (si no está): `winget install tailscale.tailscale`  → o desde https://tailscale.com/download
> 2. Iniciar sesión: `tailscale up` → se abre un navegador → iniciar sesión en la cuenta de Tailscale (la misma red/tailnet que el humano quiera usar). **Puede ser una cuenta nueva o la existente** — el humano decide.
> 3. Verificar: `tailscale ip -4` → debe mostrar una IP `100.x.x.x` (asignada a ESTA PC dentro de la red).
>
> Es posible que Tailscale pida **administrador**. Si el humano no puede, que use la app GUI de Tailscale (iniciar sesión con su cuenta).

### 3.2 Confirmar la IP de Tailscale
```bash
Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -match '^100\.' } | Select-Object IPAddress
```
- **Guarda esta IP** (ej. `100.107.134.122`). Es la `PUBLIC_BASE_URL` y la base de los launchers de `tailscale/`.

### 3.3 Actualizar el `.env` con la IP
- `PUBLIC_BASE_URL=http://<IP tailscale>:3002` (o la IP LAN si el humano prefiere que los QR usen la red local).

### 3.4 Actualizar la IP LAN (para la red del local)
```bash
Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notmatch '^127\.' -and $_.IPAddress -notmatch '^100\.' -and $_.IPAddress -notmatch '^169\.254' } | Select-Object IPAddress
```
- Es la IP de la **red Ethernet/WiFi** (ej. `192.168.1.2`). Úsala para `red/`.

---

## 🧩 FASE 4 — REGENERAR LAUNCHERS

Los launchers apuntan a IPs concretas. **Después de conocer la IP de Tailscale y la LAN**, edita el generador y relánzalo:

1. Abre `scripts/generate-launchers.mjs`.
2. En `ENVIRONMENTS`, pon las IPs detectadas:
   ```js
   const ENVIRONMENTS = [
     { id: 'localhost', label: 'Local (esta PC)', base: 'http://localhost:3002' },
     { id: 'red',       label: 'Red WiFi (LAN)',  base: 'http://<IP_LAN>:3002' },        // ← IP LAN
     { id: 'tailscale', label: 'Tailscale (remoto)', base: 'http://<IP_TAILSCALE>:3002' }, // ← IP Tailscale
   ];
   ```
3. Ejecuta:
   ```bash
   node scripts/generate-launchers.mjs
   ```
4. Verifica que `launchers/` tiene `index.html` + 3 subcarpetas × 6 HTML = 19 archivos.

> Si no quieres editar el script, puedes escribir las IPs directamente en los archivos `launchers/red/*.html` y `launchers/tailscale/*.html` (busca `http://192.168.1.2:3002` y `http://100.107.134.122:3002` y reemplázalas). Pero **editar el script es mejor** (queda reproducible).

---

## 🧩 FASE 5 — BUILD + ARRANQUE

### 5.1 Build (genera los 6 PWAs + service workers)
```bash
npm run build
```
- Salida esperada: `dist/clientes/`, `dist/cocina/`, `dist/bar/`, `dist/meseros/`, `dist/caja/`, `dist/admin/` + los `sw.js` por módulo con `clientsClaim`/`skipWaiting` inyectados.
- Se generan también los `launchers` si el package.json tiene un postbuild, o los generas a mano con el script.

### 5.2 Firewall (puerto 3002)
Abrir el puerto para que los dispositivos de la red entren. Si el humano es admin:
```powershell
New-NetFirewallRule -DisplayName "Rey de la Chelada :3002" -Direction Inbound -Protocol TCP -LocalPort 3002 -Action Allow -Profile Any
```

### 5.3 Arrancar el servicio (oculto, sin ventana)
```bash
scripts\start.bat        # arranca el server oculto vía start-hidden.vbs
# o directamente:
cscript //nologo scripts\start-hidden.vbs
```

> ⚠️ **Verificar Port `NODE_ENV=production` + `.env` correcto** antes de arrancar, o el server fallará con `JWT_SECRET required`.

---

## 🧩 FASE 6 — VERIFICACIÓN

### 6.1 Health
```bash
Invoke-WebRequest -Uri "http://localhost:3002/health" -UseBasicParsing
# Debe responder status 200
```

### 6.2 Las 6 PWAs
Para cada una, verifica 200:
```bash
@('/clientes/','/cocina/','/bar/','/meseros/','/caja/','/admin/') | ForEach-Object {
  try { (Invoke-WebRequest -Uri "http://localhost:3002$_" -UseBasicParsing -TimeoutSec 5).StatusCode } catch { "ERR $_" }
}
```

### 6.3 Login real (rol admin)
```bash
$t = (Invoke-RestMethod -Uri "http://localhost:3002/api/auth/login" -Method POST -ContentType "application/json" -Body '{"pin":"0000"}').token
Invoke-RestMethod -Uri "http://localhost:3002/api/auth/me" -Headers @{Authorization="Bearer $t"}
# Debe devolver user.role = admin
```

### 6.4 Acceso remoto/LAN
- Desde un **celular en el WiFi**: abre `http://<IP_LAN>:3002/clientes/`.
- Desde un dispositivo Tailscale: abre `http://<IP_TAILSCALE>:3002/clientes/`.

### 6.5 Launchers de doble clic
- Abre la carpeta `launchers/`, doble clic en `red/meseros.html` → debe redirigir a la PWA en la IP LAN.

---

## 🧩 FASE 7 — POST-INSTALACIÓN (recomendado)

| Tarea | Comando | Nota |
|-------|---------|------|
| **Auto-arranque completo (server + watchdog + backup 01:00)** | `scripts\install-autostart.bat` | Crea los accesos en Startup con la ruta correcta + registra la tarea de backup. Requiere sesión de usuario **autologueda** en Windows (si no, usar `schtasks /sc onstart`) |
| **Backup automático (01:00)** | lo registra `install-autostart.bat` (tarea `ReyChelada-Backup`) | Backup WAL-safe via `backup-db.mjs` — verifica integridad y mantiene 7 días |
| **Watchdog (auto-reinicio)** | `scripts\watchdog-start.bat` | Health cada 5 min, relanza si cae |

## 🧩 FASE 7.5 — CONFIGURACIÓN DE NEGOCIO (Admin UI, sin tocar código)

> Abrir `http://<IP>:3002/admin/` → **Configuración** (icono sliders).

| Dato | Campo | Obligatorio |
|------|-------|-------------|
| **NIT del restaurante** | `NIT` | **SÍ** — sin NIT, tickets y QR SIN salen incompletos |
| IVA % | `IVA %` (default 13) | Sí |
| Nombre/dirección/teléfono/eslogan | campos de texto | Recomendado (salen en el ticket) |
| **Impresora** | `Nombre en Windows` — **vacío = impresora predeterminada de Windows** | Ver paso impresora |
| Ancho del papel | `80mm` (comanda estándar) o `58mm` | Ver paso impresora |

> El Admin muestra un banner "Completa el NIT" hasta que lo guardes.

### 🖨️ Impresora térmica (ESC/POS, "la delgadita")

1. Conecta la impresora a la PC y configúrala **en Windows** (Panel → Dispositivos → Impresoras): instala driver, ponla como **predeterminada** (o anota su nombre exacto).
2. En Admin → Configuración: deja `Nombre en Windows` **vacío** (usa la predeterminada) o escribe el nombre exacto.
3. Elige el ancho: **80mm** (comanda estándar) o **58mm** (ticket delgado).
4. Pulsa **"Probar impresión"** — debe salir el ticket de prueba con corte de papel.
5. Solo la PWA **Caja** imprime: al cobrar una mesa genera el ticket térmico automáticamente.
   - Si la impresión falla: revisa driver/columna en Windows y el nombre exacto de la impresora (`powershell Get-Printer | Format-Table Name`).
   - Sin impresora física aún, el sistema **no bloquea**: avisa con un toast "no se imprimió el ticket" y sigue.

## ✅ FASE 8 — FIN / RESULTADO

- Server corriendo en `:3002`, 6 PWAs OK.
- Acceso local (`localhost`), LAN (`<IP LAN>`), remoto (`<IP tailscale>`).
- Launchers regenerados con las IPs correctas.
- Backup + watchdog operativos, auto-arranque al login instalado.
- Menú gestionado por Admin (los PINs: Admin `0000`, Mesero `1111`, KDS `2222`, Caja `3333`).
- **NIT/IVA/datos cargados en Admin → Configuración** (banner pendiente resuelto).
- **Impresora térmica probada** con ticket de prueba (80mm o 58mm).

**Entregable final al humano:** un resumen con las 6 URLs (por entorno), el `JWT_SECRET` marcado como "guardar en un lugar seguro", y la nota de que el `.env` debe respaldarse (no está en git).

---

## ⚠️ Puntos donde DEBES preguntar al humano

1. **Fase 1**: si falta Node.js, confirmar que lo instales (o que él lo haga).
2. **Fase 2**: el `JWT_SECRET` (generar o pedir) y confirmar `NODE_ENV=production`.
3. **Fase 3**: la cuenta/red de Tailscale que quiere usar (nueva o existente) — le das las instrucciones manuales (instalar + `tailscale up` + login) y esperas a que confirme.
4. **Fase 3**: qué IP usar para `PUBLIC_BASE_URL` (¿Tailscale o LAN?).
5. **Fase 5**: si tiene permisos de admin para la regla de firewall (o lo hace él).
6. **Fase 7.5**: el **NIT** real del restaurante (obligatorio para tickets) y el **IVA** (13% default Bolivia).
7. **Fase 7.5**: la impresora — que confirme haberla conectado/configurado en Windows y el ancho del papel (80mm o 58mm); pregúntale el nombre exacto si no la deja como predeterminada.
8. **Fase 7**: si la PC oficial tendrá **auto-login** de Windows (recomendado para que el servicio arranque solo).

> Si en cualquier momento algo falla, **NO continúes a ciegas** — pausa, reporta el error y la causa probable, y pide confirmación.

---

## 📦 NOTA — Formato de despliegue (zip/.rar vs git clone)

> **¿Cómo llega el código a esta PC?**
> - **Opción A (recomendada si quieres actualizar fácil):** `git clone https://github.com/paulogvs/rey-de-la-chelada.git` — así `scripts/update.bat` funcionará para bajar mejoras futuras.
> - **Opción B (pendrive con `.rar`/zip desde GitHub):** descargas el ZIP/`.rar` del repo. ⚠️ **NO incluye `.git`**, así que `scripts\update.bat` (que usa `git pull`) **NO funcionará**. Sirve para instalar, pero para actualizar habría que volver a bajar el zip o clonar.
>
> **opencode:** si el código llegó por zip, **avisa al humano** que las futuras actualizaciones requerirán clonar el repo (o re-descargar el zip). Si llegó por `git clone`, las actualizaciones son `scripts\update.bat`.

---

## 🔄 ACTUALIZACIONES FUTURAS (después de producción)

Cuando el dueño haga mejoras en su PC de desarrollo y las suba a GitHub:
```
scripts\update.bat        # pull → npm install --legacy-peer-deps → build → restart
```
- **No pierde datos:** la DB (`data/`) y el `.env` NO se tocan (están fuera de git). Las migraciones de schema son aditivas (añaden columnas, nunca borran).
- **Menú:** en PROD `MENU_MANAGEMENT=admin` → el Admin UI es dueño del menú; `update.bat` NO pisa items/precios editados. Para traer items nuevos del seed: **Admin → Menú → "Importar del seed"**.
- **Siempre** `--legacy-peer-deps` en `npm install`.

---

*Rey de la Chelada — FORCH.i by Paulo Velasco · Built with FORCH.i by Paulo Velasco · https://forch-i-a-hub.vercel.app/*
