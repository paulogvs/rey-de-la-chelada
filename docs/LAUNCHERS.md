# 🔗 Launchers — Acceso rápido a las PWAs

> **Atajos HTML** para abrir cada PWA con **doble clic**, redirigiendo al entorno correcto.
> *FORCH.i by Paulo Velasco — Bolivia*

## ¿Qué son?

Archivos `.html` que **NO son la app** — son **puntos de acceso** (redirecciones). Al abrirlos con doble clic, el navegador redirige automáticamente a la URL real de la PWA servida por el servidor Express en el puerto `:3002`.

> ⚠️ **Aclaración técnica:** una PWA no puede abrirse con `file:///` (doble clic a la app real) porque necesita el servidor Express para servir assets, API, auth y el service worker. Estos launchers resuelven eso: son un HTML local que te lleva a la URL correcta con un clic.

## Estructura

```
launchers/
├── index.html              ← menú principal (elige entorno)
├── localhost/              → http://localhost:3002      (misma PC / caja)
│   ├── clientes.html
│   ├── cocina.html
│   ├── bar.html
│   ├── meseros.html
│   ├── caja.html
│   └── admin.html
├── red/                    → http://192.168.1.2:3002   (red LAN/WiFi del local)
│   └── (mismos 6 .html)
└── tailscale/              → http://100.107.134.122:3002 (acceso remoto)
    └── (mismos 6 .html)
```

| Entorno | Base URL | Uso |
|---------|----------|-----|
| `localhost/` | `http://localhost:3002` | En la **misma PC** (caja/admin) |
| `red/` | `http://192.168.1.2:3002` | En el **WiFi del local** (meseros/cocina/bar/clientes) |
| `tailscale/` | `http://100.107.134.122:3002` | **Acceso remoto** desde cualquier dispositivo en tu red Tailscale |

## Cómo usar

1. Navega a la subcarpeta del entorno que necesitas.
2. **Doble clic** en el `.html` de la PWA (ej. `red/meseros.html`).
3. Se abre el navegador con una tarjeta de acceso (botón "Abrir Meseros") y **redirige automáticamente** a la URL real.
4. Ingresa el **PIN** del rol (Admin `0000`, Mesero `1111`, KDS `2222`, Caja `3333`).

> También puedes abrir `launchers/index.html` para ver un menú con las 3 redes y todos los accesos.

## Regenerar (si cambia la IP)

Si cambia la **IP LAN** o la **IP de Tailscale** del servidor, edita las IPs en el generador y vuelve a ejecutarlo:

1. Abre `scripts/generate-launchers.mjs`.
2. En la constante `ENVIRONMENTS`, edita las `base`:
   ```js
   { id: 'red',       base: 'http://192.168.1.2:3002' },       // ← IP LAN nueva
   { id: 'tailscale', base: 'http://100.107.134.122:3002' },   // ← IP Tailscale nueva
   ```
3. Ejecuta:
   ```bash
   node scripts/generate-launchers.mjs
   ```
4. Se regeneran los 19 archivos (`index.html` + 18 launchers) en `launchers/`.

> **Detectar la IP actual** (en la PC del servidor):
> ```bash
> # LAN
> ipconfig | findstr "IPv4"
> # Tailscale (IP 100.x.x.x)
> Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -match '^100\.' }
> ```

## También actualiza el `.env`

La URL de los QR de las mesas usa `PUBLIC_BASE_URL` en `.env`. Al cambiar la IP del servidor, actualiza también esta variable (mismo valor que pusiste en `red/` o `tailscale/`).

---

*Rey de la Chelada — FORCH.i by Paulo Velasco · Built with FORCH.i by Paulo Velasco · https://forch-i-a-hub.vercel.app/*
