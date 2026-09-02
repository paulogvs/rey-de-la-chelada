# PROMPT FINAL — OpenCode PC PROD OFICIAL (commit b78f8a7)

> **DESTINATARIO:** OpenCode en la PC de PRODUCCIÓN OFICIAL.
> **REPO:** https://github.com/paulogvs/rey-de-la-chelada (público, branch `main`)
> **COMMIT OBJETIVO:** `b78f8a7` (último — incluye fix de layout Admin + scroll horizontal Meseros + v18 del menú)
> **OBJETIVO:** Actualizar la app a la v18/config final SIN romper nada y SIN perder la base de datos de producción.

---

**PROMPT PARA OPENCODE (copia y pega tal cual):**

Actualiza la app **"Rey de la Chelada"** desde el repo público
`https://github.com/paulogvs/rey-de-la-chelada` (branch `main`), dejando el repositorio
**exactamente en el commit `b78f8a7`** (o el `HEAD` de `main` si ya está más adelante y es
compatible). Configúralo todo bien, **sin romper la app** y **sin perder la base de datos de
producción** (`data/rey-de-la-chelada.db`, que tiene movimientos, cierres y menú editado).
Al final el servicio debe quedar **arriba y funcional**.

## PASO 0 — DETECTAR LA RUTA REAL DEL PROYECTO (NO asumas ninguna ruta)

La app puede estar en cualquier carpeta de esta PC. **LOCALIZALA antes de nada.**

1. Busca el archivo de DB:
   `Get-ChildItem -Path C:\,D:\ -Filter "rey-de-la-chelada.db" -Recurse -ErrorAction SilentlyContinue`
2. O busca el `package.json` del proyecto:
   `Get-ChildItem -Path C:\,D:\ -Filter "package.json" -Recurse -ErrorAction SilentlyContinue | Select-String "rey-de-la-chelada"`
3. O busca archivos típicos: `start-hidden.vbs`, `AGENTS.md`, `scripts\backup-db.mjs`, `scripts\start.bat`.

Cuando la encuentres, define:
```powershell
$PROD = "C:\RUTA\REAL\ENCONTRADA"   # ← cámbiala por la carpeta real
Set-Location $PROD
```
> ⚠️ Usa `$PROD` en TODOS los comandos. NO asumas `D:\OTRO DISCO\REY DE LA CHELADA`.

## REGLAS OBLIGATORIAS (LEELAS ANTES DE TOCAR NADA)

1. **La DB de producción es REAL y NO se resetea.** Prohibido: `DROP TABLE`, borrar `data/*.db`,
   `git clean -fdx`, limpiar `orders` / `payments` / `cash_closings`.
2. **Backup obligatorio** ANTES de cualquier paso. Guarda la copia en un lugar seguro:
   ```powershell
   Set-Location $PROD
   node scripts\backup-db.mjs
   ```
   (Backup WAL-safe con integridad verificada. Conserva ese backup toda la sesión.)
3. **Respeta `MENU_MANAGEMENT`** del `.env` (léelo con `Get-Content .env | Select-String MENU_MANAGEMENT`):
   - **`admin`** → el seed NO se re-importa solo. El menú lo gestiona el Admin UI. NO re-seedea; solo migra schema aditivo.
   - **`seed`** (o ausente) → el seed es la autoridad y al arrancar re-importa el catálogo **OJO**: puede pisar precios editados. **Pregúntame ANTES de arrancar** si quieres re-seedar o conservar el menú actual.
4. **NO cambies el modelo de cobro, precios ni flujos de pedidos.** Solo actualiza el código a `b78f8a7`.

## PASOS DE ACTUALIZACIÓN

### 1. Bajar el código al commit objetivo
```powershell
Set-Location $PROD
git fetch origin
git checkout -- . 2>$null   # descarta cambios locales SIN tocar data/ (data/ no está en git)
git pull origin main
git checkout b78f8a7        # fija el commit objetivo (o quédate en HEAD de main si ya es ≥ b78f8a7 y compatible)
git log --oneline -1        # confirma: debe mostrar b78f8a7 (o uno posterior)
```
> Si la carpeta NO es un repo git aún: `git clone https://github.com/paulogvs/rey-de-la-chelada .` dentro de `$PROD`.
> ⚠️ `data/`, `.env` y `node_modules` NO están en git — `git pull`/`checkout` NO los tocan. No pierdes la DB.

### 2. Instalar dependencias
```powershell
Set-Location $PROD
npm install --legacy-peer-deps
```

### 3. Migración de schema ADITIVA (v17 — menu_categories.area)
- Se ejecuta **sola** al arrancar. Es **aditiva**: usa `ADD COLUMN` + `hasColumn`.
- Si la columna `area` ya existe, NO hace nada (no rompe).
- Si no existe, la agrega e infiere el área de cada categoría desde su primer item (o `cocina` si está vacía).
- **NO borra datos, NO toca pedidos/pagos/cierres.** Es SEGURA.

### 4. Build
```powershell
Set-Location $PROD
npm run build
```

### 5. Detener el servicio (si está corriendo) y liberar la DB
```powershell
Set-Location $PROD
if (Test-Path scripts\stop.bat) { cmd /c scripts\stop.bat }
elseif (Test-Path stop.bat) { cmd /c stop.bat }
Start-Sleep -Seconds 3
```

### 6. Arrancar el servicio
```powershell
Set-Location $PROD
if (Test-Path scripts\start.bat) { cmd /c scripts\start.bat }
elseif (Test-Path start.bat) { cmd /c start.bat }
# Si usas start-hidden.vbs / PM2, usa el método habitual de esta PC.
Start-Sleep -Seconds 8
```

## VERIFICACIÓN DE SERVICIO FUNCIONAL

### 1. Health check
```powershell
Invoke-RestMethod -Uri "http://localhost:3002/health" -TimeoutSec 8
# → status: ok
```

### 2. Verificar que la DB NO se perdió (movimientos intactos)
```powershell
node -e "const d=require('better-sqlite3')('data/rey-de-la-chelada.db');const o=s=>d.prepare(s).get();console.log('pedidos',o('SELECT COUNT(*) n FROM orders').n,'pagos',o('SELECT COUNT(*) n FROM payments').n,'cierres',o('SELECT COUNT(*) n FROM cash_closings').n)"
```
- Los conteos de `orders` / `payments` / `cash_closings` deben ser **los mismos que antes del update**
  (compáralos con el backup o con lo que reportaste antes de tocar).
- **No deben ser 0** si había movimiento real. Si eran 0, OK; si no, **NO reinicies desde cero**.

### 3. Verificar menú (solo lectura)
```powershell
node -e "const d=require('better-sqlite3')('data/rey-de-la-chelada.db');const o=s=>d.prepare(s).get();const q=s=>d.prepare(s).all();console.log('items',o('SELECT COUNT(*) n FROM menu_items').n,'categorias',o('SELECT COUNT(*) n FROM menu_categories').n);console.log('promos_cat',o(\"SELECT COUNT(*) n FROM menu_categories WHERE name LIKE '%Promo%'\").n);console.log('BAR',q(\"SELECT COUNT(*) n FROM menu_categories WHERE area='bar'\")[0].n,'COCINA',q(\"SELECT COUNT(*) n FROM menu_categories WHERE area='cocina'\")[0].n)"
```

## DESPUÉS DE ARRANCAR — CONFIGURAR LO NUEVO (v18)

1. **Armador de promos (Admin → Promos):** verificar que el CRUD funcione y que sigan las promos
   existentes (si el dueño creó, se conservan). Si el seed sembró las 6 de ejemplo, quedan desactivadas.
2. **Item nuevo disponible:** Admin → Menú → "Agregar item" → ahora el modal es **solo nombre + precio**.
   Crea uno de prueba → debe aparecer **al instante en meseros**. (Esto valida el bug v18 corregido.)
3. **Grupos con área correcta:** en meseros, cada grupo debe verse SOLO en su pestaña
   (Barra o Cocina), sin duplicarse.
4. **Categoría "Promociones" en el menú:** si existe en la DB oficial, **NO la borres**.
   Solo repórtamela. Si quieres que no se vea, la oculto luego desde Admin (el historial se conserva).

## QUÉ REPORTARME AL FINAL

- **La ruta `$PROD`** que usaste.
- **Confirmación** de `git log --oneline -1` (idealmente `b78f8a7`).
- **Health** → `ok`.
- **Conteos** de `orders` / `payments` / `cash_closings` (que no hayan cambiado vs backup).
- **Menú**: nº items, nº categorías, si existe categoría "Promociones", nº BAR/COCINA.
- Si hubo que **re-seedar** (y si pisó precios editados) o no.
- Cualquier **warning/error** de build, migración o arranque.

## REGLAS FINALES

- **NO improvises**, NO asumas rutas, NO toques la DB real.
- Si algo no cuadra (no encuentras la carpeta, la DB está bloqueada, `git` da conflicto,
  `npm install` falla, `start` no levanta), **PREGUNTAME ANTES de continuar**.
- El objetivo es **dejar el servicio arriba y funcional** sin romper la app ni perder movimientos.
