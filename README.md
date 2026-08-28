<div align="center">

# 👑 Rey de la Chelada

### Donde las mejores historias comienzan con una chelada.

[![Contributors][contributors-shield]][contributors-url]
[![Forks][forks-shield]][forks-url]
[![Stargazers][stars-shield]][stars-url]
[![Issues][issues-shield]][issues-url]
[![MIT License][license-shield]][license-url]

[contributors-shield]: https://img.shields.io/github/contributors/paulogvs/rey-de-la-chelada.svg?style=for-the-badge
[contributors-url]: https://github.com/paulogvs/rey-de-la-chelada/graphs/contributors
[forks-shield]: https://img.shields.io/github/forks/paulogvs/rey-de-la-chelada.svg?style=for-the-badge
[forks-url]: https://github.com/paulogvs/rey-de-la-chelada/network/members
[stars-shield]: https://img.shields.io/github/stars/paulogvs/rey-de-la-chelada.svg?style=for-the-badge
[stars-url]: https://github.com/paulogvs/rey-de-la-chelada/stargazers
[issues-shield]: https://img.shields.io/github/issues/paulogvs/rey-de-la-chelada.svg?style=for-the-badge
[issues-url]: https://github.com/paulogvs/rey-de-la-chelada/issues
[license-shield]: https://img.shields.io/github/license/paulogvs/rey-de-la-chelada.svg?style=for-the-badge
[license-url]: https://github.com/paulogvs/rey-de-la-chelada/blob/main/LICENSE

**Built with [FORCH.i](https://forch-i-a-hub.vercel.app/) by Paulo Velasco**

</div>

---

## 📋 Table of Contents

<details>
<summary>Click to expand</summary>

1. [About The Project](#about-the-project)
2. [Built With](#built-with)
3. [Getting Started](#getting-started)
4. [Usage](#usage)
5. [Roadmap](#roadmap)
6. [License](#license)
7. [Contact](#contact)
8. [Acknowledgments](#acknowledgments)
9. [Legal](#legal)

</details>

---

## 🎯 About The Project

**Rey de la Chelada** es un sistema integral de gestión para restaurante/bar ubicado en **Cochabamba, Bolivia**. Diseñado para operar en un entorno con conectividad de internet media, con arquitectura **offline-first** que garantiza 100% de funcionalidad sin conexión.

El sistema maneja **10 mesas**, con **2 meseros por turno**, una **cajera dedicada**, y **cocineros separados del bartender**. Incluye gestión de menú con variantes (preparada/sencilla, tamaños), pagos QR (Yape/QR Simple), tarjeta (POS físico), transferencia bancaria (Banco BISA), y efectivo — todo con IVA incluido en los precios.

**Características principales:**
- 📱 **Offline-first PWA** — Funciona sin internet, sincroniza automáticamente
- 🍳 **KDS (Kitchen Display System)** — Órdenes en tiempo real en cocina
- 🖨️ **Impresión térmica** — Comandas y tickets automáticos
- 📍 **Mapa de mesas** — Layout visual del salón con 10 mesas
- 💳 **Pagos QR Bolivia** — QR Simple, Yape, OpenBCB
- 👥 **Roles** — Admin, Mesero (2), Cocina, Caja
- 📊 **Corte de caja** — Reportes diarios con IVA incluido

---

## 🛠️ Built With

| Category | Technology |
|----------|------------|
| **Frontend** | React 19 + Vite 6 + TypeScript |
| **Backend** | Node.js (≥22.9) + Express 5 |
| **Database** | SQLite (better-sqlite3) |
| **Offline** | Service Worker (NetworkOnly API) + IndexedDB |
| **PWA** | vite-plugin-pwa + Workbox (multi-PWA, 6 apps) |
| **KDS** | WebSocket para tiempo real |
| **QR Payments** | QR Simple / OpenBCB / Yape |
| **Printing** | esc-pos-printer (XP-80C) |
| **Network** | Tailscale VPN mesh |
| **Deploy** | `scripts\setup.bat` / `scripts\update.bat` (Windows self-hosted) |

---

## 📚 Documentación completa

> **👉 [Arquitectura + Runbook de Producción](./docs/ARQUITECTURA_Y_PRODUCCION.md)** — fuente única de verdad técnica: cómo funciona el sistema a fondo, dependencias, variables de entorno, contratos de datos, endpoints y los pasos para ponerlo en producción (desarrollar + desplegar) en una **computadora nueva**. Pensado para retomar el proyecto en una **sesión fresca**.

Otros documentos:
- [`docs/MANUAL_DE_INSTALACION.md`](./docs/MANUAL_DE_INSTALACION.md) — instalación en PC nueva paso a paso (`setup.bat`)
- [`docs/MANUAL_DE_USUARIO.md`](./docs/MANUAL_DE_USUARIO.md) — manual de uso (6 PWAs, PINs, flujos)
- [`AGENTS.md`](./AGENTS.md) — contratos de datos (SSOT) y comandos

---

## 🚀 Getting Started

### Prerequisites

```bash
node --version  # v22.9+ required (necesario por --env-file-if-exists)
npm --version   # v10+ required
```

### Installation (para desarrollo)

1. Clone the repo:
   ```bash
   git clone https://github.com/paulogvs/rey-de-la-chelada.git
   cd rey-de-la-chelada
   ```

2. Install dependencies (**SIEMPRE con `--legacy-peer-deps`**):
   ```bash
   npm install --legacy-peer-deps
   ```

3. Set up environment variables:
   ```bash
   cp .env.example .env
   # Editar .env (JWT_SECRET, DB_PATH, MENU_MANAGEMENT=seed en dev, etc.)
   ```

4. Run the servers (2 terminales):
   ```bash
   npm run dev:server   # terminal 1: API Express en :3002 (carga .env)
   npm run dev          # terminal 2: Vite dev server (HMR) en :3001
   ```

5. Open [http://localhost:3002/clientes/](http://localhost:3002/clientes/) in your browser.

> **En producción**, el deploy NO usa `npm run dev`. Usa `scripts\setup.bat` (PC nueva) o `scripts\update.bat` (actualizar) — ver [Runbook de producción](./docs/ARQUITECTURA_Y_PRODUCCION.md#11-runbook-pc-nueva--producción-paso-a-paso).

---

## 💡 Usage

### Roles del Sistema

| Rol | Acceso | Dispositivo |
|-----|--------|-------------|
| **Admin** | Full access, configuración, reportes | PC/Tablet |
| **Mesero** | Tomar pedidos, ver mesas, cobrar | Tablet (8-11") |
| **Cocina** | KDS, marcar preparación | Display grande |
| **Caja** | Facturación, corte de caja | PC/Tablet |

### Flujo de Trabajo

1. **Llega cliente** → Mesero asigna mesa en el mapa
2. **Toma pedido** → Menú digital con modificadores
3. **Cocina recibe** → KDS muestra orden en tiempo real
4. **Cocina prepara** → Marca como listo
5. **Mesero sirve** → Actualiza estado
6. **Cliente paga** → QR/Cash/Tarjeta/Transferencia
7. **Cierre** → Corte de caja con IVA incluido

---

## 🗺️ Roadmap

### Phase 1 — MVP (6-8 semanas)
- [ ] Digital Menu with categories, photos, prices, modifiers
- [ ] Table Map (visual salon layout — 10 mesas)
- [ ] Order Taking (offline-first with IndexedDB)
- [ ] KDS (Kitchen Display System) — real-time orders
- [ ] Payment processing (QR Bolivia + Cash)
- [ ] Thermal printer integration (tickets, commands)
- [ ] Role-based access (Admin, Mesero, Cocina, Caja)
- [ ] Basic cash closing (corte de caja)

### Phase 2 — Growth
- [ ] Inventory with recipe-based auto-deduction
- [ ] Reports dashboard (sales, products, staff)
- [ ] Multi-device sync (local network + cloud)

### Phase 3 — Advanced
- [ ] Delivery integration
- [ ] Loyalty program
- [ ] AI-powered stock prediction

---

## 📄 License

Distributed under the MIT License. See `LICENSE` for more information.

---

## 📞 Contact

**Paulo Velasco** — [@paulogvs](https://github.com/paulogvs)

Project Link: [https://github.com/paulogvs/rey-de-la-chelada](https://github.com/paulogvs/rey-de-la-chelada)

---

## 🎖️ Acknowledgments

- **[FORCH.iA Ecosystem](https://forch-i-a-hub.vercel.app/)** — 264 agents, 475 skills, 44 rules
- **[@forchi](https://forch-i-a-hub.vercel.app/)** — Orchestrator IA
- **[Paulo Velasco](https://github.com/paulogvs)** — Bolivia 🇧🇴
- **[Rey de la Chelada](https://github.com/paulogvs/rey-de-la-chelada)** — Cochabamba, Bolivia

Built with ❤️ in Bolivia by Paulo Velasco, powered by FORCH.iA.

---

## ⚖️ Legal

This app includes the following legal documents:

- [Privacy Policy](./legal/privacy-policy.md)
- [Terms of Service](./legal/terms-of-service.md)
- [Acceptable Use Policy](./legal/acceptable-use-policy.md)

See [LEGAL.md](./LEGAL.md) for compliance status.

---

<div align="center">

**Built with [FORCH.i](https://forch-i-a-hub.vercel.app/) by Paulo Velasco**

🇧🇴 Made in Bolivia

</div>
