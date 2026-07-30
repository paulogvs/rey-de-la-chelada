/**
 * ═══════════════════════════════════════════════════════════
 *  Rey de la Chelada — Express Server Entry Point
 *
 *  Sirve múltiples PWAs desde un solo servidor (monolito).
 *  Cada ruta es un PWA diferente con su propio manifest y SW.
 *
 *  Rutas:
 *    /clientes/*   → Menú Digital (público)
 *    /cocina/*     → KDS Cocina
 *    /bar/*        → KDS Barra
 *    /meseros/*    → Gestión de meseros
 *    /caja/*       → Corte de caja
 *    /admin/*      → Administración
 *    /api/*        → API REST
 *    /health       → Health check
 *
 *  Artículo I:  SSOT — Monolito que sirve múltiples PWAs
 *  Artículo IV: Simplicidad — Un solo servidor, un solo deploy
 * ═══════════════════════════════════════════════════════════
 */

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import path from 'path';
import { fileURLToPath } from 'url';

// ============================================================
// Setup
// ============================================================

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

const PORT = process.env.PORT || 3001;
const DIST_DIR = path.join(__dirname, '..', 'dist');

// ============================================================
// Middleware global
// ============================================================

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(morgan('combined'));
app.use(express.json());

// ============================================================
// PWA Routes — Cada una sirve su propio directorio
// ============================================================

const PWA_ROUTES = [
  { path: '/clientes', dir: 'clientes' },
  { path: '/cocina',   dir: 'cocina' },
  { path: '/bar',      dir: 'bar' },
  { path: '/meseros',  dir: 'meseros' },
  { path: '/caja',     dir: 'caja' },
  { path: '/admin',    dir: 'admin' },
];

// Static files compartidos (icons, fonts, etc.)
app.use('/icons', express.static(path.join(DIST_DIR, 'icons'), { maxAge: '7d' }));

// Cada PWA sirve sus estáticos desde su carpeta
for (const pwa of PWA_ROUTES) {
  const pwaDir = path.join(DIST_DIR, pwa.dir);
  app.use(pwa.path, express.static(pwaDir, { maxAge: '1d' }));

  // SPA fallback: cualquier ruta dentro del PWA sirve su index.html
  app.use(`${pwa.path}/*`, (req, res) => {
    res.sendFile(path.join(pwaDir, 'index.html'));
  });
}

// ============================================================
// API Routes
// ============================================================

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    app: 'Rey de la Chelada',
    version: '1.0.0',
    pwAs: PWA_ROUTES.map(p => p.path),
  });
});

// API routes — se registrarán aquí
// app.use('/api/salon', salonRoutes);
// app.use('/api/orders', orderRoutes);
// app.use('/api/menu', menuRoutes);
// app.use('/api/payments', paymentRoutes);
// app.use('/api/inventory', inventoryRoutes);
// app.use('/api/staff', staffRoutes);
// app.use('/api/reports', reportRoutes);
// app.use('/api/sync', syncRoutes);

// QR Token generation endpoint
app.get('/api/qr-table/:tableNumber', (req, res) => {
  const { tableNumber } = req.params;
  const baseUrl = `${req.protocol}://${req.hostname}:${PORT}`;
  const qrUrl = `${baseUrl}/clientes?mesa=${tableNumber}&sid=sess_${Date.now()}_${Math.random().toString(36).substr(2, 8)}`;
  res.json({ tableNumber, qrUrl });
});

// ============================================================
// WebSocket — KDS Real-Time
// ============================================================

wss.on('connection', (ws, req) => {
  const url = req.url || '';
  const pwaId = url.startsWith('/cocina') ? 'cocina'
    : url.startsWith('/bar') ? 'bar'
    : 'unknown';

  console.log(`[KDS] ${pwaId} connected`);

  ws.on('message', (message) => {
    // Broadcast a todos los KDS clients
    wss.clients.forEach((client) => {
      if (client !== ws && client.readyState === 1) {
        client.send(message);
      }
    });
  });

  ws.on('close', () => {
    console.log(`[KDS] ${pwaId} disconnected`);
  });
});

// ============================================================
// Error handling
// ============================================================

app.use((err, req, res, _next) => {
  console.error('[Server] Error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// ============================================================
// Start
// ============================================================

server.listen(PORT, '0.0.0.0', () => {
  console.log(`
  ╔══════════════════════════════════════╗
  ║  👑 Rey de la Chelada                ║
  ║  Donde las mejores historias         ║
  ║  comienzan con una chelada.          ║
  ║                                      ║
  ║  🍳 /cocina     → KDS Cocina        ║
  ║  🍺 /bar        → Barra             ║
  ║  🪑 /meseros    → Meseros           ║
  ║  💰 /caja       → Caja              ║
  ║  ⚙️ /admin      → Admin             ║
  ║  📱 /clientes   → Menú Digital      ║
  ║                                      ║
  ║  🚀 http://localhost:${PORT}          ║
  ╚══════════════════════════════════════╝
  `);
});
