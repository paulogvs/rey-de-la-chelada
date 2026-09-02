# BRIEF — Actualización de la PROD OFICIAL (no tocar la DB)

> **DESTINATARIO:** OpenCode en la PC de PRODUCCIÓN OFICIAL.
> **AUTOR:** @forchi (Rey de la Chelada — FORCH.iA)
> **Fecha:** 2026-09-02 · **App:** rey-de-la-chelada
> **Objetivo:** Llevar el código NUEVO desde GitHub hacia la PROD oficial
> **SIN** perder ni tocar la base de datos real (movimientos, cierres, menú editado).

---

## ⚠️ REGLA DE ORO (LEER PRIMERO)

La PC de PRODUCCIÓN OFICIAL tiene una **base de datos REAL** (en `data/rey-de-la-chelada.db`)
con movimientos, cierres de caja, y menú posiblemente editado por el dueño.

**NO RESETEAR LA DB.** Esta actualización es **SOLO DE CÓDIGO** + migraciones **aditivas** de schema.
NO ejecutar `load-menu.js` con borrado, NO `DROP TABLE`, NO borrar `data/*.db`.

---

## Contexto de esta versión

- **Brillo del seed:** Se ELIMINÓ la categoría **"Promociones"** del `menu-seed.json`.
  Las promos ahora se manejan **desde el ARMADOR (vista Promos del Admin)** — tablas `promos`,
  `promo_lines`, `promo_schedule`. Ya NO son items del menú.
- **Área de grupo (v17):** `menu_categories.area` ('bar'|'cocina'). El grupo define la pestaña
  en el PWA de meseros (Barra/Cocina), y los items HEREDAN el área del grupo.
- **Item nuevo disponible (v18):** un item creado en Admin queda `is_available=1` → aparece
  al INSTANTE en meseros. El modal de nuevo item es solo **Nombre + Precio** (apartado por defecto).
- **Modal de nuevo apartado:** solo **Nombre + Área (Barra/Cocina)**. El icono es automático
  (**🍻 Barra / 🍽 Cocina**) — ya NO se edita manualmente.
- **Iconos estandarizados:** Barra 🍻 · Cocina 🍽.

---

## PASOS (en la PC OFICIAL, con PROD en `D:\OTRO DISCO\REY DE LA CHELADA`)

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
   git checkout -- .        # descarta cambios locales (si los hay) — OJO revisar antes
   git pull origin main
   ```
   > ⚠️ Si la PC oficial tiene cambios locales NO commiteados (p.ej. `.env`, `data/`, build),
   > NO uses `git checkout -- .` a lo bruto. Mejor `git stash` o revisar antes. `data/` y `.env`
   > NO están en git — `git pull` no los tocará.

4. **Instalar dependencias** (obligatorio `--legacy-peer-deps`):
   ```powershell
   npm install --legacy-peer-deps
   ```

5. **Ejecutar migraciones de schema (ADITIVAS, automáticas al arrancar):**
   - El schema (v17+: `menu_categories.area`) se migra **solo** si falta la columna (`hasColumn`).
   - **NO** borra datos. Es seguro.
   - Migración automática v17: categorías existentes sin `area` infieren el área de su primer item
     (o `cocina` si están vacías) → **no pierde nada**.

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

9. **Verificar que NO se creó la categoría "Promociones" nueva** — como la quitamos del seed,
   NO se siembra. La categoría Promociones que existiera ANTES en la DB oficial se conserva
   (el seed hace upsert, no borra). Si el dueño NO la quiere, se oculta/borra manualmente en
   Admin → Menú → apartado "Promociones" → Ocultar (el ojo) o Borrar (solo si está vacía).

---

## Qué NO debe pasar en la PROD oficial

| Riesgo | Cómo evitarlo |
|--------|---------------|
| Resetear la DB real | NO ejecutamos limpieza; el boot solo hace upsert + migración aditiva. |
| Perder movimientos/cierres | `backup-db.mjs` antes de arrancar; no se tocan tablas de pedidos/pagos. |
| Re-importar el seed con borrado | `load-menu` es idempotente (upsert por `id`/nombre) — NUNCA borra lo existente. |
| Que un item nuevo quede oculto | v18: `is_available=1` por defecto al crear item. |
| Romper la DB (schema) | Migración v17 usa `ADD COLUMN` + `hasColumn` — aditiva y segura. |

---

## Flujo DEV → PROD oficial (resumen para quien lo ejecute)

```
DEV (esta PC de prueba)  --push-->  GitHub  --pull-->  PROD OFICIAL
        ✅ código nuevo                        ⚠️ DB REAL INTACTA (solo migración aditiva)
```

> Si en la PC oficial `MENU_MANAGEMENT=admin` (PROD), el seed NO se re-importa automáticamente
> tras el primer arranque. El menú pertenece al Admin UI. La categoría Promociones que el dueño
> tenga >se conserva< y puede ocultarla desde Admin.
