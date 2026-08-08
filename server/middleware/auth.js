/**
 * ═══════════════════════════════════════════════════════════
 *  AUTH MIDDLEWARE — JWT + PIN Access Control
 *
 *  Artículo I:  SSOT — Auth definido en un solo lugar.
 *  Artículo VI: Observabilidad — Fail loud, never silent.
 *  Artículo VII: Secrets Boundary — JWT_SECRET desde .env.
 * ═══════════════════════════════════════════════════════════
 *
 *  Roles del sistema (v5: 4 roles):
 *    admin  → Acceso total
 *    mesero → Mesas, pedidos, pagos, waiter calls
 *    kds    → KDS cocina+barra unificado
 *    caja   → Corte de caja, pagos y reportes (NO administración)
 */

import jwt from 'jsonwebtoken';

// ============================================================
// Config
// ============================================================

// T5 (S1): JWT_SECRET real. Fail loud — si no hay secret en env, avisamos
// en consola en vez de seguir en silencio con el fallback de desarrollo.
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-do-not-use-in-production';
if (!process.env.JWT_SECRET) {
  console.warn(
    '[Auth] ⚠️ JWT_SECRET NO configurado — usando fallback de DESARROLLO. ' +
    'Configura JWT_SECRET en .env (ver .env.example) antes de producción.'
  );
}
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '24h';
const PIN_LENGTH = parseInt(process.env.MESERO_PIN_LENGTH || '4', 10);

// ============================================================
// Helpers
// ============================================================

/**
 * Generate a JWT token for a staff user
 */
export function generateToken(user) {
  const payload = {
    sub: user.id,
    username: user.username,
    role: user.role,
    displayName: user.display_name || user.displayName,
  };

  return jwt.sign(payload, JWT_SECRET, {
    expiresIn: JWT_EXPIRES_IN,
    issuer: 'rey-de-la-chelada',
  });
}

/**
 * Generate a refresh token (longer-lived)
 */
export function generateRefreshToken(user) {
  const payload = {
    sub: user.id,
    type: 'refresh',
  };

  return jwt.sign(payload, JWT_SECRET, {
    expiresIn: '7d',
    issuer: 'rey-de-la-chelada',
  });
}

/**
 * Verify and decode a token
 */
export function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return null;
    }
    if (err.name === 'JsonWebTokenError') {
      return null;
    }
    return null;
  }
}

// ============================================================
// Middleware
// ============================================================

/**
 * Require authentication (JWT in Authorization header)
 */
export function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return res.status(401).json({
      success: false,
      error: 'Se requiere autenticación',
      code: 'AUTH_REQUIRED',
    });
  }

  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    return res.status(401).json({
      success: false,
      error: 'Formato de token inválido. Use: Bearer <token>',
      code: 'INVALID_TOKEN_FORMAT',
    });
  }

  const decoded = verifyToken(parts[1]);
  if (!decoded) {
    return res.status(401).json({
      success: false,
      error: 'Token inválido o expirado. Inicie sesión nuevamente.',
      code: 'INVALID_TOKEN',
    });
  }

  req.user = decoded;
  next();
}

/**
 * Require specific role(s)
 * Usage: requireRole('admin') or requireRole('mesero', 'caja')
 */
export function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'Autenticación requerida',
        code: 'AUTH_REQUIRED',
      });
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        error: `Acceso restringido. Roles permitidos: ${allowedRoles.join(', ')}`,
        code: 'FORBIDDEN_ROLE',
        userRole: req.user.role,
      });
    }

    next();
  };
}

/**
 * PIN authentication for meseros (quick access)
 * Validates PIN from request body against stored hash
 */
export function requirePinAuth(req, res, next) {
  const { pin, userId } = req.body;

  if (!pin || !userId) {
    return res.status(400).json({
      success: false,
      error: 'PIN y userId son requeridos',
      code: 'PIN_REQUIRED',
    });
  }

  if (typeof pin !== 'string' || pin.length !== PIN_LENGTH) {
    return res.status(400).json({
      success: false,
      error: `El PIN debe tener ${PIN_LENGTH} dígitos`,
      code: 'INVALID_PIN_LENGTH',
    });
  }

  // Attach to request for the route handler to verify against DB
  req.pinAuth = { userId, pin };
  next();
}

/**
 * Optional auth — attaches user if token present, but doesn't block
 */
export function optionalAuth(req, res, next) {
  const authHeader = req.headers.authorization;

  if (authHeader) {
    const parts = authHeader.split(' ');
    if (parts.length === 2 && parts[0] === 'Bearer') {
      const decoded = verifyToken(parts[1]);
      if (decoded) {
        req.user = decoded;
      }
    }
  }

  next();
}

// ============================================================
// Session helpers for PWA modules
// ============================================================

/**
 * Module capability check
 * Validates that the authenticated user's role can access a PWA module
 */
const MODULE_ROLES = {
  clientes:  [],       // Public — no auth needed
  cocina:    ['kds', 'admin'],
  bar:       ['kds', 'admin'],
  meseros:   ['mesero', 'admin'],
  caja:      ['caja', 'admin'],   // v5: el rol caja entra a la PWA caja
  admin:     ['admin'],
};

export function canAccessModule(userRole, moduleId) {
  const allowed = MODULE_ROLES[moduleId];
  if (!allowed) return false;
  if (allowed.length === 0) return true; // Public module
  return allowed.includes(userRole);
}

export { JWT_SECRET, PIN_LENGTH, MODULE_ROLES };
