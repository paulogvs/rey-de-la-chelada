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
 *  Artículo VI: Observabilidad — Fail loud, never silent
 *  Artículo VII: Secrets Boundary — Config desde .env
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
import net from 'node:net'; // v11: check puerto antes de tocar la DB (race condition P0)

// ── Middleware ────────────────────────────────────────────
import { apiLimiter, readLimiter, authLimiter, kdsLimiter, corsOptions, helmetCspConfig, securityHeaders } from './middleware/security.js';

// ── Database ──────────────────────────────────────────────
import { getDb } from './db/index.js';
import { ensureBootstrap } from './db/bootstrap.js';

// ── Logger (S1/T2): archivo con rotación diaria + consola ─
import { logger } from './utils/logger.js';

// ── WebSocket Broadcaster (SSOT) ──────────────────────────
import { broadcaster, buildKDSEvent, KDSEventType } from './services/websocket-broadcaster.js';
// Re-export so route handlers can import from a single place
export { broadcaster, buildKDSEvent, KDSEventType };

// ── Env guard (P0-2): fail-loud JWT_SECRET en producción ──
import { assertProdSecret } from './config/env-guard.js';

// ============================================================
// Setup
// ============================================================

// Fail-loud: en producción, JWT_SECRET es obligatorio (aborta el arranque).
assertProdSecret();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

const PORT = process.env.PORT || 3002;
const DIST_DIR = path.join(__dirname, '..', 'dist');

// ── Race condition guard (P0) ──────────────────────────────
// Dos procesos sobre la misma DB → SQLITE_BUSY (bootstrap corre ANTES de
// listen). Si el puerto ya está ocupado por OTRO server, abortamos el
// arranque ANTES de tocar la DB. Bypass: ALLOW_MULTIPLE_INSTANCES=1
// (tests/CI levantan instancias en puertos distintos o secuenciales).
function assertPortFree(port) {
  if (process.env.ALLOW_MULTIPLE_INSTANCES === '1' || process.env.NODE_ENV === 'test') return;
  return new Promise((resolve, reject) => {
    const sock = net.connect({ port, host: '127.0.0.1' });
    sock.once('connect', () => {
      sock.destroy();
      reject(new Error(
        `Puerto ${port} ya está en uso por otro proceso (Rey de la Chelada ya corriendo?). ` +
        'Detén el proceso anterior (scripts\\stop.bat) o usa PORT= diferente. ' +
        'Abortando ANTES de tocar la DB para evitar SQLITE_BUSY.'
      ));
    });
    sock.once('error', () => resolve()); // conexión rechazada → puerto libre
  });
}

// ============================================================
// Initialize Database
// ============================================================

let db;
try {
  await assertPortFree(PORT);
  db = getDb();
  logger.info('[DB] Database connected and schema applied');
  // Auto-seed idempotente: garantiza staff + mesas + menú + precios
  // en el primer arranque (fix: PROD arrancaba con staff vacío).
  try {
    ensureBootstrap(db);
  } catch (bootstrapErr) {
    logger.error('[Bootstrap] Error en auto-seed:', bootstrapErr.message);
  }
} catch (err) {
  if (err?.message?.includes('ya está en uso')) {
    console.error(`\n[FATAL] ${err.message}\n`);
    process.exit(1); // abortar ANTES de bootstrap → no tocar la DB
  }
  logger.error('[DB] Failed to initialize database:', err.message);
  // Non-blocking — app can still run in dev mode
}

// Rotación de logs: borra logs > 7 días al arrancar (S1/T2)
try {
  logger.prune();
} catch (pruneErr) {
  logger.warn('[Logger] prune falló:', pruneErr.message);
}

// ============================================================
// Middleware global
// ============================================================

// Seguridad: helmet con CSP configurado
app.use(helmet(helmetCspConfig));

// CORS restringido
app.use(cors(corsOptions));

// Headers de seguridad adicionales
app.use(securityHeaders);

// Logging
app.use(morgan('combined'));

// Body parsing — 12mb: pedidos grandes (muchos items + modificadores) y
// sync push con N pedidos en una sola llamada pueden superar 1mb. Además,
// los comprobantes QR van en base64 dentro del body de POST /api/payments/:id/proof
// (ruta usa su propio parser de 20mb) — el global DEBE ser >= para no
// rechazar la foto del comprobante con 413 antes de llegar a la ruta.
app.use(express.json({ limit: '12mb' }));
app.use(express.urlencoded({ extended: true, limit: '12mb' }));

// Rate limiting global para /api/*
// F1 2026-08-10: lecturas (polling) con techo alto, escrituras estrictas.
// Orden importa: readLimiter cuenta TODO (anti-hammer), apiLimiter salta GET.
app.use('/api', readLimiter);
app.use('/api', apiLimiter);

// ============================================================
// Static Files
// ============================================================

// Badges (FORCH.i)
app.use('/badges', express.static(path.join(__dirname, '..', 'public', 'badges'), { maxAge: '7d' }));

// Icons compartidos
app.use('/icons', express.static(path.join(DIST_DIR, 'icons'), { maxAge: '7d' }));

// Menu photos (micheladas, categorías)
app.use('/menu-photos', express.static(path.join(__dirname, '..', 'public', 'menu'), { maxAge: '30d' }));

// App logo (brand identity)
app.use('/logo', express.static(path.join(__dirname, '..', 'public', 'logo'), { maxAge: '30d' }));

// QR de pago estático del restobar (FASE 5 — public/payment/qr.png)
app.use('/payment', express.static(path.join(__dirname, '..', 'public', 'payment'), { maxAge: '1d' }));

// Los comprobantes son privados: se sirven solo desde /api/payments/:id/proof/content.

// Shared Vite chunks (multi-PWA build emits shared code to dist/assets root)
app.use('/assets', express.static(path.join(DIST_DIR, 'assets'), { maxAge: '30d' }));

// ============================================================
// Root redirect — UX: '/' apunta al menú público (clientes)
// (Solo matchea la ruta exacta '/', no interfiere con /api/*)
// ============================================================
app.get('/', (req, res) => {
  res.redirect(302, '/clientes/');
});

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

// Cada PWA sirve sus estáticos desde su carpeta
for (const pwa of PWA_ROUTES) {
  const pwaDir = path.join(DIST_DIR, pwa.dir);
  app.use(pwa.path, express.static(pwaDir, { maxAge: '1d' }));

  // SPA fallback: cualquier ruta dentro del PWA sirve su index.html
  // (Express 5: sin wildcards '/*' — mount en la misma ruta)
  app.use(pwa.path, (req, res) => {
    res.sendFile(path.join(pwaDir, 'index.html'));
  });
}

// ============================================================
// API Routes
// ============================================================

// Health check (público) — S1/T3: incluye SELECT 1 de la DB (watchdog lo usa)
app.get('/health', (req, res) => {
  let dbStatus = 'disconnected';
  let dbError = null;
  if (db) {
    try {
      db.prepare('SELECT 1').get();
      dbStatus = 'connected';
    } catch (err) {
      dbStatus = 'error';
      dbError = err.message;
    }
  }
  res.json({
    status: dbStatus === 'error' ? 'degraded' : 'ok',
    app: 'Rey de la Chelada',
    version: '1.0.0',
    database: dbStatus,
    ...(dbError && { databaseError: dbError }),
    pwAs: PWA_ROUTES.map(p => p.path),
    uptime: process.uptime(),
  });
});

// QR Token generation endpoint (público — genera URLs para imprimir en mesas)
app.get('/api/qr-table/:tableNumber', (req, res) => {
  const { tableNumber } = req.params;
  const num = parseInt(tableNumber, 10);
  if (isNaN(num) || num < 1 || num > 50) {
    return res.status(400).json({
      success: false,
      error: 'Número de mesa inválido (1-50)',
      code: 'INVALID_TABLE_NUMBER',
    });
  }

  const baseUrl = `${req.protocol}://${req.hostname}:${PORT}`;
  const qrUrl = `${baseUrl}/clientes?mesa=${num}`;
  res.json({ success: true, tableNumber: num, qrUrl });
});

// ── Route imports ─────────────────────────────────────────
import authRoutes from './routes/auth.js';
import tablesRoutes from './routes/tables.js';
import menuRoutes from './routes/menu.js';
import ordersRoutes from './routes/orders.js';
import paymentsRoutes from './routes/payments.js';
import staffRoutes from './routes/staff.js';
import syncRoutes from './routes/sync.js';
import reportsRoutes from './routes/reports.js';
import waiterCallsRoutes from './routes/waiter-calls.js';
import clientOrdersRoutes from './routes/client-orders.js';
import clientSessionsRoutes from './routes/client-sessions.js';
import promotionsRoutes from './routes/promotions.js'; // Sprint Promos 2026-08-19
import settingsRoutes from './routes/settings.js';     // v14: configuración restaurante (Admin)
import printRoutes from './routes/print.js';           // v14: impresión térmica server-side

// ── Route registration ────────────────────────────────────
app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/tables', tablesRoutes);          // Auth handled inside
app.use('/api/menu', menuRoutes);              // Public read, admin write (handled inside)
// P2-2 (2026-08-11): kdsLimiter (60/10s) definido pero NUNCA montado —
// el polling del KDS está protegido ahora (cocina + bar).
app.use('/api/orders/kds', kdsLimiter);
app.use('/api/orders', ordersRoutes);
app.use('/api/payments', paymentsRoutes);
app.use('/api/staff', staffRoutes);
app.use('/api/sync', syncRoutes);
app.use('/api/reports', reportsRoutes);
app.use('/api/waiter-calls', waiterCallsRoutes);
app.use('/api/client-orders', clientOrdersRoutes);  // PUBLIC — clientes PWA (sin JWT)
app.use('/api/client-sessions', clientSessionsRoutes); // POST admin + GET validate público
app.use('/api/promotions', promotionsRoutes);          // PUBLIC — promos del día laboral
app.use('/api/settings', settingsRoutes);              // Admin — configuración (NIT/impresora)
app.use('/api/print', printRoutes);                    // Admin/Caja — impresión térmica

// ============================================================
// WebSocket — KDS Real-Time (delegated to broadcaster SSOT)
// ============================================================

broadcaster.attach(wss);

// Per-client lifecycle: confirm connection + cleanup on close
wss.on('connection', (ws, req) => {
  const url = (req && req.url) || '';
  const module = broadcaster._moduleFromUrl(url);

  console.log(`[KDS] ${module} connected (clients: ${broadcaster.getClientCount()})`);

  // Send initial connection confirmation
  try {
    if (ws.readyState === 1) {
      ws.send(JSON.stringify({
        type: 'connected',
        module,
        timestamp: new Date().toISOString(),
      }));
    }
  } catch (err) {
    logger.warn(`[KDS] Initial send failed: ${err.message}`);
  }

  ws.on('close', () => {
    broadcaster.unregisterClient(ws);
    console.log(`[KDS] ${module} disconnected (clients: ${broadcaster.getClientCount()})`);
  });

  ws.on('error', (err) => {
    logger.error(`[KDS] ${module} error:`, err.message);
    broadcaster.unregisterClient(ws);
  });
});

// ============================================================
// Error handling
// ============================================================

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'Ruta no encontrada',
    code: 'NOT_FOUND',
    path: req.path,
  });
});

// Error handler global
app.use((err, req, res, _next) => {
  logger.error('[Server] Error:', err);

  // Errores conocidos
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({
      success: false,
      error: 'JSON inválido en el cuerpo de la solicitud',
      code: 'INVALID_JSON',
    });
  }

  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({
      success: false,
      error: 'Archivo demasiado grande',
      code: 'FILE_TOO_LARGE',
    });
  }

  // Error genérico
  res.status(err.status || 500).json({
    success: false,
    error: process.env.NODE_ENV === 'production'
      ? 'Error interno del servidor'
      : err.message,
    code: 'INTERNAL_ERROR',
    ...(process.env.NODE_ENV !== 'production' && { stack: err.stack }),
  });
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
  ║  🔒 Security: helmet + rate-limit    ║
  ║  🗄️  Database: SQLite                ║
  ║                                      ║
  ║  🚀 http://localhost:${PORT}          ║
  ╚══════════════════════════════════════╝
  `);
});

export { app, server, wss };
