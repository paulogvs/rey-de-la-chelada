# PROMPT — OpenCode PC PROD OFICIAL (v18)

> Copiar y pegar en OpenCode en la PC de PRODUCCIÓN OFICIAL.
> Repo: https://github.com/paulogvs/rey-de-la-chelada (público, branch main)

---

**PROMPT PARA OPENCODE (PC de PRODUCCIÓN OFICIAL):**

Actualiza la app **"Rey de la Chelada"** desde el repo público **https://github.com/paulogvs/rey-de-la-chelada** (branch `main`) hasta la **v18**, configurándolo todo bien, **SIN perder la base de datos de producción** (el archivo `data/rey-de-la-chelada.db`).

## PASO 0 — DETECTAR LA RUTA REAL DEL PROYECTO (NO la asumas)

Antes de ejecutar nada, **localiza la carpeta donde está instalada la app** en esta PC.
No tengo una ruta fija: puede ser `D:\OTRO DISCO\REY DE LA CHELADA`, otro disco, u otra carpeta.

**Cómo detectarla (pruébalas en orden):**
1. `Get-ChildItem -Path C:\,D:\ -Filter "rey-de-la-chelada.db" -Recurse -ErrorAction SilentlyContinue` → busca el archivo de DB.
2. O busca el `package.json` con `"name": "rey-de-la-chelada"`: `Get-ChildItem -Path C:\,D:\ -Filter "package.json" -Recurse -ErrorAction SilentlyContinue | Select-String "rey-de-la-chelada"`.
3. O pregunta si hay una carpeta app conocida (ej. `start-hidden.vbs`, `AGENTS.md`, `scripts\backup-db.mjs`).

> ⚠️ **Importante:** cuando encuentres la carpeta, define una variable local `$PROD` con esa ruta y **úsala en TODOS** los comandos que siguen. **NO uses la ruta de esta doc como si fuera fija.**

Ejemplo genérico (ajusta `$PROD` a la ruta real encontrada):
```powershell
$PROD = "C:\RUTA\REAL\ENCONTRADA"   # ← cámbiala
Set-Location $PROD
```

## REGLAS OBLIGATORIAS (leer antes de tocar nada)

1. **La DB de PRODUCCIÓN es REAL** — tiene **movimientos, cierres de caja y menú posiblemente editado**. **NO la reseteo.** NO `DROP TABLE`, NO borrar `data/*.db`, NO `git clean -fdx`, NO limpiar `orders/payments/cash_closings`.
2. **Backup obligatorio** ANTES de cualquier paso (desde `$PROD`):
   ```powershell
   Set-Location $PROD
   node scripts\backup-db.mjs
   ```
   Guarda el `.db`/backup resultante en un lugar seguro.
3. **Respeta el `MENU_MANAGEMENT` del `.env`** (léelo primero):
   - **`admin`** → el seed NO se auto-importa. El menú lo gestiona el Admin UI. Solo baja código, migra schema aditivo y NO toques el menú existente.
   - **`seed`** (o ausente) → el seed es autoridad y al arrancar re-importa el catálogo. **Pregúntame** antes de arrancar si quieres que re-seedee el menú (pisa precios editados) o no.

## PASOS (todos desde `$PROD`)

1. **Clonar/pull** desde `https://github.com/paulogvs/rey-de-la-chelada`:
   - Si la carpeta **ya es un repo git**: `git fetch origin` + `git pull origin main`.
   - Si **NO existe** el repo aún: `git clone https://github.com/paulogvs/rey-de-la-chelada .` (dentro de `$PROD`).
2. `npm install --legacy-peer-deps` (obligatorio).
3. **Migración de schema ADITIVA** (`menu_categories.area`, v17): se agrega solo si falta la columna (`hasColumn→ADD COLUMN`). NO borra datos. SEGURA.
4. `npm run build`.
5. **Reiniciar el servicio** (detener y arrancar con los scripts del proyecto — según lo que haya: `scripts\stop.bat`, `scripts\start.bat`, `start-hidden.vbs`).
6. Verificar `GET /health` (debe responder `ok`).

## DESPUÉS DE ARRANCAR — configurar lo nuevo

1. **Armador de promos (Admin → Promos):** verifica que funcione el CRUD y que sigan las 6 promos de ejemplo (desactivadas). Si el dueño ya creó promos, se conservan.
2. **Menú renovado al nuevo seed** (si aplica, según `MENU_MANAGEMENT`): debe quedar con **99 items / 18 categorías** (12 bar: 🍻 · 6 cocina: 🍽️), **sin la categoría "Promociones"** del menú.
   - Si en la DB existía una categoría **"Promociones"** de antes, y quieres que **desaparezca** del menú, **ocúltala** (Admin → Menú → apartado "Promociones" → ojo). **NO la borres** (podría haber pedidos históricos que la referencien). Si la ocultas, el historial se conserva.
3. **Item nuevo disponible:** crea un item en Admin → Menú → debe aparecer **al instante en meseros** (con nombre + precio). El modal ahora es solo **nombre + precio**.
4. **Grupos con área correcta:** verifica en meseros que cada grupo aparezca SOLO en su pestaña (Barra o Cocina), sin duplicar.

## VERIFICACIÓN FINAL

- `GET /health` → `ok`.
- Nº de items / categorías / si existe "Promociones" (reporta el resultado).
- Los movimientos/cierres existentes **NO deben haber cambiado** (compáralos con el backup).

**Nunca improvises ni asumas rutas.** Seguí este prompt. Si algo no cuadra (repo ya existe, `.env` raro, DB bloqueada, o no encuentras la carpeta), **pregúntame** antes de continuar. Al final, dame un resumen claro de: la ruta `$PROD` que usaste, qué se actualizó y qué se conservó.
