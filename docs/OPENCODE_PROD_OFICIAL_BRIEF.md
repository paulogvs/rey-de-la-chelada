# BRIEF — Actualización de la PROD OFICIAL (v18 · no tocar la DB)

> **DESTINATARIO:** OpenCode en la PC de PRODUCCIÓN OFICIAL.
> **AUTOR:** @forchi (Rey de la Chelada — FORCH.iA)
> **Fecha:** 2026-09-02 · **App:** rey-de-la-chelada
> **Objetivo:** Llevar el código NUEVO (v18) desde GitHub hacia la PROD oficial
> **SIN** perder ni tocar la base de datos real (movimientos, cierres, menú editado).

---

## ⚠️ REGLA DE ORO (LEER PRIMERO)

La PC de PRODUCCIÓN OFICIAL tiene una **base de datos REAL** (en `data/rey-de-la-chelada.db`)
con **movimientos, cierres de caja, y menú editado por el dueño**.

**NO RESETEAR LA DB.** Esta actualización es **SOLO DE CÓDIGO** + migración **aditiva** de schema.
NO ejecutar limpieza/borrado, NO `DROP TABLE`, NO borrar `data/*.db`, NO `git clean -fdx`.

---

## Qué cambió en esta versión (v18)

| Cambio | Detalle | Impacto en la PROD oficial |
|--------|---------|-----------------------------|
| **Quitar categoría "Promociones" del seed** | Se ELIMINÓ del `menu-seed.json`. Las promos ahora se manejan **solo desde el ARMADOR** (vista Promos del Admin): tablas `promos`, `promo_lines`, `promo_schedule`. | El seed ya NO siembra items "Promociones". Si en la DB oficial YA existe esa categoría (de antes), **se conserva** (el seed hace upsert, NO borra). El dueño puede ocultarla desde Admin → Menú. |
| **Área de grupo (v17) + fix (v18)** | `menu_categories.area` ('bar'\|'cocina'). **NUEVO: al importar del seed las categorías ahora guardan su `area`** (antes todas quedaban `cocina`). Los items heredan el área de su grupo. | Migración `ADD COLUMN area` aditiva (solo si falta). Categorías existentes sin área infieren el área de su primer item (o `cocina` si vacías) — NO pierde nada. |
| **Item nuevo disponible (v18)** | Al crear un item en Admin ya NO se manda `price: null`. El modal es **solo Nombre + Precio**. El server fuerza `is_available=1` (salvo indicación explícita) → **aparece al instante en meseros**. | Ningún riesgo a la DB; mejora del flujo de menú. |
| **Modal de nuevo apartado simplificado** | Solo **Nombre + Área (Barra/Cocina)**. El icono es **automático** (**🍻 Barra / 🍽 Cocina**) — ya NO se edita manualmente. | Cosmético; sin riesgo a datos. |
| **Iconos estandarizados** | Barra 🍻 · Cocina 🍽 (coincide con el seed `load-menu`). | Cosmético. |

---

## IMPORTANTE — Diferencia seed vs admin-managed (leer antes de elegir pasos)

- `MENU_MANAGEMENT=seed` (default en ausencia de env) → el seed es la autoridad; en cada arranque
  se re-importa (upsert + reconciliación) **pero sin borrar** lo que el admin tenga. NO se trae
  la categoría Promociones (ya no está en el seed).
- `MENU_MANAGEMENT=admin` (PROD real del dueño) → el seed solo se importa la PRIMERA vez (DB vacía).
  El **seed de GitHub NO se re-importa automáticamente**. El dueño usa el Admin UI para el menú
  y el botón "Importar del seed" para traer items nuevos (sin pisar sus precios/editados).

> **Conclusión:** en la PC oficial (sea `seed` o `admin`) **la DB NO se resetea y NO se pierde nada.**
> Si el ecosistema del menú es `admin`, los cambios v18 se ven al crear/editar items desde Admin;
> la categoría Promociones que el dueño tenga se conserva y puede ocultarla manualmente.

---

## PASOS (en la PC OFICIAL)

> **⚠️ La ruta `D:\OTRO DISCO\REY DE LA CHELADA` en esta doc es SOLO un ejemplo de la PC de
> PRUEBAS. En la PC OFICIAL, la carpeta puede ser OTRA.** Antes de ejecutar, **detecta la ruta real**
> (busca `rey-de-la-chelada.db` o el `package.json` del proyecto) y usa esa como base de todos los
> comandos. Los pasos son idénticos salvo las notas ⚠️. Son SEGUROS para la DB real.

1. **RESPALDO de la DB (obligatorio, antes de tocar NADA):**
   ```powershell
   cd "D:\OTRO DISCO\REY DE LA CHELADA"
   node scripts\backup-db.mjs         # backup WAL-safe + integridad + prune 7d
   ```
   Guarda el `.db`/backup resultante en un lugar seguro de la PC oficial.

2. **Frenar el servicio en marcha** (para liberar el archivo .db):
   ```powershell
   cd "D:\OTRO DISCO\REY DE LA CHELADA"
   scripts\stop.bat
   ```

3. **Bajar el código nuevo desde GitHub** (sin tocar `data/`, `.env`, `node_modules`):
   ```powershell
   git fetch origin
   git checkout -- .        # ⚠️ descarta cambios locales — REVISAR antes
   git pull origin main
   ```
   > ⚠️ Si la PC oficial tiene cambios locales NO commiteados (p.ej. `.env`, `data/`, build),
   > NO uses `git checkout -- .` a lo bruto. Mejor `git stash` o revisar primero. `data/` y `.env`
   > NO están en git — `git pull` NO los tocará.

4. **Instalar dependencias** (obligatorio `--legacy-peer-deps`):
   ```powershell
   npm install --legacy-peer-deps
   ```

5. **Migrar schema (ADITIVA, automática al arrancar):**
   - `menu_categories.area` se agrega **solo si falta** (`hasColumn` → `ADD COLUMN`). SEGURO.
   - Categorías existentes sin `area` → infieren el área de su primer item (o `cocina` si vacías).
   - **NO** borra datos. **NO** toca pedidos/pagos/cierres.

6. **BUILD:**
   ```powershell
   npm run build
   ```

7. **Arrancar el servicio:**
   ```powershell
   scripts\start.bat        # (o start-hidden.vbs según tu setup)
   ```

8. **Verificar salud:**
   ```powershell
   Invoke-RestMethod -Uri "http://localhost:3002/health"
   # → status: ok
   ```

9. **Verificación post-actualización** (opcional, lectura):
   ```powershell
   # Nº de items / categorías / si existe categoría "Promociones":
   node -e "const d=require('better-sqlite3')('data/rey-de-la-chelada.db');const o=s=>d.prepare(s).get();console.log('items',o('SELECT COUNT(*) n FROM menu_items').n,'categorias',o('SELECT COUNT(*) n FROM menu_categories').n,'promos_cat',o(\"SELECT COUNT(*) n FROM menu_categories WHERE name LIKE '%Pro%'\").n)"
   ```
   - La categoría "Promociones" **puede seguir existiendo** en la DB oficial (de antes). Eso es
     **normal y correcto** — NO se fuerza su borrado. El dueño la oculta desde Admin si no la quiere.
   - **Pedidos/pagos/cierres NO deben cambiar** (solo migración de columna `area`).

---

## Qué NO debe pasar en la PROD oficial

| Riesgo | Cómo evitarlo |
|--------|---------------|
| Resetear la DB real | NO ejecutamos limpieza; el boot solo hace upsert + migración aditiva. |
| Perder movimientos/cierres | `backup-db.mjs` antes de arrancar; no se tocan tablas de pedidos/pagos. |
| Re-importar el seed con borrado | `load-menu` es idempotente (upsert por nombre/id) — NUNCA borra lo existente. Solo desactiva categorías/items que YA no están en el seed. |
| Que un item nuevo quede oculto | v18: `is_available=1` por defecto al crear item. |
| Romper la DB (schema) | Migración `ADD COLUMN area` + `hasColumn` — aditiva y segura. |
| Perder la categoría Promociones del dueño | No se borra nada. `load-menu` solo hace upsert. El dueño decide si la oculta. |

> **Nota sobre "desactiva categorías/items que ya no están en el seed":** `load-menu` pone
> `is_active=0` en categorías/items que existían pero Ya no están en el seed. Como la categoría
> "Promociones" (y sus items PROMO-*) **se quitaron del seed**, en modo `seed` quedarían marcados
> como inactivos (ocultos) en el menú — pero sus datos históricos en pedidos NO se borran.
> En modo `admin` NO se re-importa el seed, así que la categoría Promociones del dueño se conserva
> **activa**. Si el dueño no la quiere, la oculta desde Admin.

---

## Flujo DEV → PROD oficial (resumen)

```
DEV (esta PC de prueba)  --push-->  GitHub  --pull-->  PROD OFICIAL
        ✅ código nuevo (v18)              ⚠️ DB REAL INTACTA (solo migración aditiva `area`)
```

---

## 🧪 QUÉ VERIFICAR EN LA PROD OFICIAL (tras actualizar)

1. **Health ok** (`/health` → `ok`).
2. **Meseros** → el menú carga; cada grupo aparece SOLO en su pestaña (Barra/Cocina), sin duplicar.
3. **Admin → Menú → Nuevo apartado:** solo Nombre + Área; icono automático 🍻/🍽.
4. **Admin → Menú → Agregar item:** solo Nombre + Precio → **aparece al instante en meseros**.
5. **Admin → Menú:** la categoría "Promociones" (si existía) sigue ahí — el dueño la oculta si quiere.
6. **Armador de promos (Admin → Promos):** siguen las 6 de ejemplo (desactivadas) y crea nuevas.

---

*Prepado por @forchi (FORCH.iA) para la actualización de la PC de PRODUCCIÓN OFICIAL.*
