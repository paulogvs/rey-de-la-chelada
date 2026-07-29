# Master Specification: Rey de la Chelada

**Created with FORCH.i by Paulo Velasco**

## 1. Overview
- **Purpose**: Sistema integral de gestión para Restaurante/Bar
- **Business**: "Rey de la Chelada" — Restaurante con Bar
- **Slogan**: "Donde las mejores historias comienzan con una chelada."
- **Location**: Cochabamba, Bolivia
- **Type**: Restaurante con Bar (Resto-Bar)
- **Architecture**: Modular Monolith with offline-first PWA
- **Deployment Profile**: RESTAURANT (Windows Self-Hosted + Local Network)

## 2. Business Context
- **Mesas**: 10 mesas
- **Meseros por turno**: 2
- **Cajera**: Dedicada (1)
- **Cocineros**: Separados del bartender
- **Variantes de menú**: Sí (preparada/sencilla, tamaños)
- **IVA**: Incluido en precios (13% Bolivia)
- **Métodos de pago**: Efectivo, QR (Yape/QR Simple), Tarjeta (POS físico), Transferencia
- **Banco**: Banco BISA
- **Internet**: Estabilidad media → OFFLINE-FIRST crítico
- **Logo**: `logo/rey_de_la_chelada_logo.png`

## 3. Core Features
### Phase 1 — MVP (6-8 semanas)
- [ ] FR01: Digital Menu with categories, photos, prices, modifiers (preparada/sencilla)
- [ ] FR02: Table Map (visual salon layout — 10 mesas, naming)
- [ ] FR03: Order Taking (offline-first with IndexedDB)
- [ ] FR04: KDS (Kitchen Display System) — real-time orders to cocina
- [ ] FR05: Payment processing (QR Bolivia + Cash + POS + Transferencia)
- [ ] FR06: Thermal printer integration (tickets for cocina, commands for client)
- [ ] FR07: Role-based access (Admin, Mesero ×2, Cocina, Caja)
- [ ] FR08: Basic cash closing (corte de caja with IVA 13%)
- [ ] FR09: IVA 13% handling (included in all prices)

### Phase 2 — Growth
- [ ] FR10: Inventory with recipe-based auto-deduction
- [ ] FR11: Supplier management + purchase orders
- [ ] FR12: Reports dashboard (sales, products, staff)
- [ ] FR13: Multi-device sync (local network + cloud via Tailscale)

### Phase 3 — Advanced
- [ ] FR14: Delivery integration (pedidos ya, etc.)
- [ ] FR15: Loyalty program (clientes frecuentes)
- [ ] FR16: Multi-branch support
- [ ] FR17: AI-powered stock prediction

## 4. Architecture
- **Pattern**: Modular Monolith with domain modules
- **Frontend**: PWA (React 19 + Vite + Tailwind CSS v4)
- **Backend**: Node.js + Express 5
- **Database**: PostgreSQL (server) + IndexedDB (client offline)
- **Sync**: Background sync with conflict resolution (server-wins)
- **Local Network**: Tailscale VPN mesh
- **Printing**: Thermal printer via USB (XP-80C, esc-pos library)
- **Payments**: QR Simple / OpenBCB / Yape integration
- **Auth**: JWT with refresh tokens, PIN for mesero quick access
- **Deploy**: Windows Self-Hosted (PM2 + nssm)

## 5. Domain Modules
- `salon/` — Table management (10 mesas), map layout
- `orders/` — Order taking, modifiers (variantes), KDS
- `menu/` — Products, categories, pricing with IVA
- `payments/` — QR, cash, POS, transferencia, invoice generation
- `inventory/` — Stock, recipes, suppliers
- `staff/` — Users, roles, shifts (2 meseros/turno)
- `reports/` — Analytics, cash closing (corte de caja)
- `sync/` — Offline-first sync engine with IndexedDB

## 6. Roles
| Rol | Acceso | Cantidad |
|-----|--------|----------|
| **Admin** | Full access, config, reports | 1 (dueño) |
| **Mesero** | Orders, tables, payments | 2 por turno |
| **Cocina** | KDS, mark preparation status | 2+ |
| **Caja** | Invoicing, cash closing | 1 dedicada |
| **Bartender** | Bar orders, drink prep | 1 (separado de cocina) |

## 7. Tech Stack
- Frontend: React 19 + Vite + Tailwind CSS v4 + React Router v7
- Backend: Node.js + Express 5
- Database: PostgreSQL (server) + Dexie/IndexedDB (client)
- Offline: Service Worker + Background Sync API
- PWA: vite-plugin-pwa + Workbox
- QR: QR Simple API / OpenBCB
- Printing: esc-pos-printer (thermal, XP-80C)
- Network: Tailscale VPN mesh
- Process: PM2 + nssm (Windows service)
- HTTPS: Tailscale Serve

## 8. Non-Functional Requirements
- **Offline-first**: 100% functionality without internet
- **Sync**: Background auto-sync when connection restores
- **Performance**: KDS updates < 500ms via WebSocket
- **Touch targets**: Minimum 48px (tablet-first for meseros)
- **KDS display**: High contrast, big fonts (48px order #), audible alerts
- **Security**: HTTPS via Tailscale, encrypted tokens, PIN auth for meseros
- **Dark mode default**: Restaurant environment = low light
- **IVA handling**: IVA 13% incluido en precios, desglosado en corte de caja

## 9. Legal Compliance
- Bolivia: Ley 164 (Protección de Datos)
- SIN: Facturación con NIT (dosificación)
- Privacy Policy
- Terms of Service
- Acceptable Use Policy

## 10. Payment Methods
| Método | Detalle | Procesador |
|--------|---------|------------|
| **Efectivo** | Vuelto calculado automáticamente | — |
| **QR** | Yape / QR Simple | QR Simple API |
| **Tarjeta** | POS físico (débito/crédito) | POS externo |
| **Transferencia** | Banco BISA | Manual (referencia) |

## 11. Project Structure
```
rey-de-la-chelada/
├── AGENTS.md
├── constitution.md
├── DESIGN.md
├── SPEC_INICIAL.md
├── VALIDATION_GATES.md
├── forchi-brand.md
├── branding.json
├── package.json
├── ecosystem.config.js
├── README.md
├── logo/
│   └── rey_de_la_chelada_logo.png
├── src/
│   ├── core/
│   │   ├── engine/           # SSOT — business logic
│   │   ├── types/            # Shared types
│   │   └── config/           # Configuration
│   ├── modules/
│   │   ├── salon/            # Table management (10 mesas)
│   │   ├── orders/           # Order taking + KDS
│   │   ├── menu/             # Products & categories
│   │   ├── payments/         # Payment processing
│   │   ├── inventory/        # Stock & recipes
│   │   ├── staff/            # Users & roles
│   │   ├── reports/          # Analytics, corte de caja
│   │   └── sync/             # Offline sync engine
│   ├── ui/
│   │   ├── components/       # Shared components
│   │   ├── pages/            # Page components
│   │   └── tokens/           # Design tokens (generated)
│   └── lib/                  # Utilities
├── server/
│   ├── index.js              # Express entry point
│   ├── routes/
│   ├── middleware/
│   ├── db/
│   └── services/
├── public/
│   ├── manifest.json
│   ├── sw.js
│   └── icons/
├── scripts/
│   ├── setup.bat
│   ├── update.bat
│   ├── backup.bat
│   └── tailscale-serve.bat
├── tests/
│   ├── unit/
│   ├── integration/
│   └── e2e/
├── docs/
│   ├── plans/
│   └── adr/
├── legal/
├── logs/
└── data/
```

---

*Generated by FORCH.i by Paulo Velasco | 2026-07-29*
