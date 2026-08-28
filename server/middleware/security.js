/**
 * ═══════════════════════════════════════════════════════════
 *  SECURITY MIDDLEWARE — Rate Limiting, CORS, Helmet Config
 *
 *  Artículo VI: Observabilidad — Fail loud, never silent.
 *  Artículo VII: Secrets Boundary — Config desde .env.
 * ═══════════════════════════════════════════════════════════
 */

import rateLimit from 'express-rate-limit';

// ============================================================
// Rate Limiting — diseño por método (F1 2026-08-10, v2 2026-08-28)
//
//  El polling multi-PWA (6 PWAs en una IP) quemaba el presupuesto
//  global de 100 req/15min → 429 "Demasiadas solicitudes". Solución:
//
//   GET/HEAD/OPTIONS  → readLimiter  (techo ALTO: 10000/15min ≈ 667 req/min)
//   POST/PUT/PATCH/DELETE → apiLimiter (2500/15min ≈ 167 mut/min)
//   POST /api/auth    → authLimiter  (60/min, anti brute-force PIN)
//
//  v2 (2026-08-28, audit de capacidad 19 dispositivos):
//   1 cocina + 1 bar + 1 caja + 4 meseros + 1 admin + 11 clientes =
//   ~180-230 req/min de polling legítimo (pico ~3500/15min). El techo
//   6000 daba margen 1.3-1.7x → se sube a 10000 para respirar en picos
//   (2 teléfonos por mesa). El abuso real se controla en apiLimiter.
//   authLimiter: TODOS los dispositivos salen de la MISMA IP (LAN) —
//   20/min se agotaba con 8 logins de inicio de turno + reintentos →
//   60/min sigue siendo seguro contra fuerza bruta (PIN 4 dígitos + bcrypt).
// ============================================================

/** ¿La request es de LECTURA? (GET/HEAD/OPTIONS — polling legítimo) */
export function shouldSkipRateLimit(method) {
  return ['GET', 'HEAD', 'OPTIONS'].includes(method);
}

/**
 * Rate limiter de LECTURAS (polling) — techo alto para no bloquear
 * el uso legítimo multi-dispositivo. Cuenta TODO (GET incluido).
 */
export const readLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,  // 15 minutes
  limit: Number(process.env.API_READ_RATE_LIMIT_MAX) || 10000,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: 'Demasiadas solicitudes. Intente nuevamente en 15 minutos.',
    code: 'RATE_LIMIT_EXCEEDED',
  },
});

/**
 * Rate limiter de ESCRITURAS — estricto, SKIP en lecturas.
 * Un bot sin auth puede spammear POST /api/client-orders o
 * POST /api/waiter-calls: este tope lo frena sin afectar el polling.
 */
export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,  // 15 minutes
  limit: Number(process.env.API_WRITE_RATE_LIMIT_MAX) || 2500,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => shouldSkipRateLimit(req.method),
  message: {
    success: false,
    error: 'Demasiadas solicitudes. Intente nuevamente en 15 minutos.',
    code: 'RATE_LIMIT_EXCEEDED',
  },
});

/**
 * Stricter limiter for auth endpoints
 * 60 attempts per minute per IP (override vía env)
 */
export const authLimiter = rateLimit({
  windowMs: 60 * 1000,  // 1 minute
  limit: Number(process.env.AUTH_RATE_LIMIT_MAX) || 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: 'Demasiados intentos de autenticación. Espere 1 minuto.',
    code: 'AUTH_RATE_LIMIT',
  },
});

/**
 * KDS endpoint limiter (higher tolerance for real-time)
 * 60 requests per 10 seconds per IP
 */
export const kdsLimiter = rateLimit({
  windowMs: 10 * 1000,  // 10 seconds
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: 'KDS rate limit exceeded',
    code: 'KDS_RATE_LIMIT',
  },
});

// ============================================================
// CORS Configuration
// ============================================================

/**
 * CORS allowed origins
 * In production, restrict to known origins
 */
export const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (server-to-server, curl, etc.)
    if (!origin) return callback(null, true);

    const allowedOrigins = [
      // Local development
      'http://localhost:3001',
      'http://localhost:3002',
      'http://localhost:5173',
      'http://127.0.0.1:3001',
      'http://127.0.0.1:3002',
      'http://127.0.0.1:5173',
      // Tailscale IPs
      'http://100.100.100.100:3001',
      'http://100.100.100.100:3002',
      // Production (to be configured)
      ...(process.env.CORS_ORIGINS ? process.env.CORS_ORIGINS.split(',') : []),
    ];

    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      // Log unauthorized origin attempts
      console.warn(`[Security] CORS blocked origin: ${origin}`);
      callback(null, false);
    }
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  exposedHeaders: ['X-RateLimit-Remaining', 'X-RateLimit-Reset'],
  credentials: true,
  maxAge: 86400,  // 24 hours
};

// ============================================================
// Helmet Content Security Policy
// ============================================================

/**
 * Content Security Policy configuration
 * Restricts scripts, styles, and connections to trusted sources
 */
export const helmetCspConfig = {
  // Disable Cross-Origin-Resource-Policy: same-origin.
  // The multi-PWA build references shared chunks with `crossorigin`
  // (Vite modulepreload). CORP same-origin + crossorigin blocks them
  // silently in the browser → blank page. Static assets must allow
  // cross-origin reads (CORS middleware handles the Access-Control-*).
  crossOriginResourcePolicy: false,
  // Disable HSTS (Strict-Transport-Security). The server serves plain
  // HTTP over LAN/Tailscale (no TLS) — HSTS would make the browser
  // remember to force HTTPS for that IP, reinforcing the splash bug.
  strictTransportSecurity: false,
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],  // Needed for React dev
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],  // CSS-in-JS + Google Fonts
      imgSrc: ["'self'", "data:", "blob:"],
      connectSrc: ["'self'", "ws:", "wss:"],                        // WebSocket for KDS
      fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
      manifestSrc: ["'self'"],
      workerSrc: ["'self'", "blob:"],                                // Service Workers
      frameSrc: ["'none'"],
      objectSrc: ["'none'"],
      // CRITICAL: helmet v8 merges its DEFAULT directives (which include
      // upgrade-insecure-requests) with these. On a plain-HTTP server
      // (LAN/Tailscale, no TLS) that directive forces the browser to
      // request EVERY sub-resource over HTTPS → ERR_SSL_PROTOCOL_ERROR
      // → eternal splash when accessed via IP (localhost is exempt).
      // Setting `null` DELETES the directive from the merged header
      // while keeping the rest of helmet's defaults (base-uri,
      // form-action, frame-ancestors, script-src-attr, ...).
      upgradeInsecureRequests: null,
    },
  },
};

// ============================================================
// Security Headers
// ============================================================

/**
 * Additional security headers beyond helmet defaults
 */
export function securityHeaders(req, res, next) {
  // Prevent MIME-type sniffing
  res.setHeader('X-Content-Type-Options', 'nosniff');

  // Prevent clickjacking
  res.setHeader('X-Frame-Options', 'DENY');

  // Enable XSS filter in older browsers
  res.setHeader('X-XSS-Protection', '1; mode=block');

  // Referrer policy
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

  // Permissions policy
  res.setHeader('Permissions-Policy', [
    'camera=()',
    'microphone=()',
    'geolocation=()',
    'interest-cohort=()',
  ].join(', '));

  next();
}

export default { apiLimiter, authLimiter, kdsLimiter, corsOptions, helmetCspConfig, securityHeaders };
