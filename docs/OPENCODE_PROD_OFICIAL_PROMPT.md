# PROMPT — OpenCode PC PROD OFICIAL (v18)

> Copiar y pegar en OpenCode en la PC de PRODUCCIÓN OFICIAL.
> Repo: https://github.com/paulogvs/rey-de-la-chelada (público, branch main)

---

**PROMPT PARA OPENCODE (PC de PRODUCCIÓN OFICIAL):**

Actualiza la app **"Rey de la Chelada"** desde el repo público **https://github.com/paulogvs/rey-de-la-chelada** (branch `main`) hasta la **v18**, configurándolo todo bien, **SIN perder la base de datos de producción** (`data/rey-de-la-chelada.db`).

## REGLAS OBLIGATORIAS (leer antes de tocar nada)

1. **La DB de PRODUCCIÓN es REAL** — tiene **movimientos, cierres de caja y menú posiblemente editado**. **NO la reseteo.** NO `DROP TABLE`, NO borrar `data/*.db`, NO `git clean -fdx`, NO limpiar `orders/payments/cash_closings`.
2. **Backup obligatorio** ANTES de cualquier paso:
   ```powershell
   cd "D:\OTRO DISCO\REY DE LA CHELADA"
   node scripts\backup-db.mjs
   ```
3. **Respeta el `MENU_MANAGEMENT` del `.env`** (léelo primero):
   - **`admin`** — el seed NO se auto-importa. El menú lo gestiona el Admin UI. Solo baja código, migra schema aditivo y NO toques el menú existente.
   - **`seed`** (o ausente) — el seed es autoridad y al arrancar re-importa el catálogo. **Pregúntame** antes de arrancar si quieres que re-seedee el menú (pisa precios editados) o no.

## PASOS

1. `git fetch origin` y `git pull origin main` (o `git clone https://github.com/paulogvs/rey-de-la-chelada` si no existe el repo aún).
2. `npm install --legacy-peer-deps` (obligatorio).
3. **Migración de schema ADITIVA** (`menu_categories.area`, v17): se agrega solo si falta la columna (`hasColumn→ADD COLUMN`). NO borra datos. SEGURA.
4. `npm run build`.
5. Reiniciar el servicio (detener y arrancar con los scripts del proyecto).
6. Verificar `GET /health` (debe responder `ok`).

## DESPUÉS DE ARRANCAR — configurar lo nuevo

1. **Armador de promos (Admin → Promos):** verifica que funcione el CRUD y que sigan las 6 promos de ejemplo (desactivadas). Si el dueño ya creó promos, se conservan.
2. **Menú renovado al nuevo seed** (si aplica, según `MENU_MANAGEMENT`): debe quedar con **99 items / 18 categorías** (12 bar: 🍻 · 6 cocina: 🍽️), **sin la categoría "Promociones"** del menú.
   - Si en la DB existía una categoría **"Promociones"** de antes, y quieres que **desaparezca** del menú, **ocúltala** (Admin → Menú → apartado "Promociones" → ojo). **NO la borres** (podría haber pedidos históricos que la referencien). Si la ocultas, el historial se conserva.
3. **Item nuevo disponible:** crea un item en Admin → Menú → debe aparecer **al instante en meseros** (con nombre + precio). El modal ahora es solo **nombre + precio**.
4. **Grupos con área correcta:** verifica en meseros que cada grupo aparezca SOLO en su pestaña (Barra o Cocina), sin duplicar.

## VERIFICACIÓN FINAL

- [`/health`](http://localhost:3002/health) → `ok`.
- Nº de items / categorías / si existe "Promociones" (reporta el resultado).
- Los movimientos/cierres existentes **NO deben haber cambiado** (compáralos con el backup).

**Nunca improvises.** Seguí este prompt. Si algo no cuadra (repo ya existe, `.env` raro, DB bloqueada), pregúntame antes de continuar. Al final, dame un resumen claro de qué se actualizó y qué se conservó.
