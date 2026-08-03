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
// Rate Limiting
// ============================================================

/**
 * General API rate limiter
 * 100 requests per 15 minutes per IP
 */
export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,  // 15 minutes
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: 'Demasiadas solicitudes. Intente nuevamente en 15 minutos.',
    code: 'RATE_LIMIT_EXCEEDED',
  },
});

/**
 * Stricter limiter for auth endpoints
 * 5 attempts per minute per IP
 */
export const authLimiter = rateLimit({
  windowMs: 60 * 1000,  // 1 minute
  max: Number(process.env.AUTH_RATE_LIMIT_MAX) || 5,
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
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],  // Needed for React dev
      styleSrc: ["'self'", "'unsafe-inline'"],                      // Needed for CSS-in-JS
      imgSrc: ["'self'", "data:", "blob:"],
      connectSrc: ["'self'", "ws:", "wss:"],                        // WebSocket for KDS
      fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
      manifestSrc: ["'self'"],
      workerSrc: ["'self'", "blob:"],                                // Service Workers
      frameSrc: ["'none'"],
      objectSrc: ["'none'"],
      upgradeInsecureRequests: [],
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
