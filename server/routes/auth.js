/**
 * ═══════════════════════════════════════════════════════════
 *  Auth Routes — Login, Refresh, PIN Verify, Profile
 *
 *  Artículo I:  SSOT — Toda autenticación pasa por aquí.
 *  Artículo VII: Secrets Boundary — JWT_SECRET desde .env.
 *  Artículo VIII: Error Recovery — Mensajes claros en español.
 * ═══════════════════════════════════════════════════════════
 *
 *  POST /api/auth/login     → Login con username + password
 *  POST /api/auth/pin       → Login con PIN (meseros)
 *  POST /api/auth/refresh   → Refresh token
 *  GET  /api/auth/me        → Perfil del usuario autenticado
 *  POST /api/auth/logout    → Logout (invalidate token)
 */

import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { getDb } from '../db/index.js';
import { generateToken, generateRefreshToken, verifyToken, requireAuth } from '../middleware/auth.js';

const router = Router();

// ============================================================
// POST /api/auth/login
// ============================================================

router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({
        success: false,
        error: 'Usuario y contraseña son requeridos',
        code: 'CREDENTIALS_REQUIRED',
      });
    }

    const db = getDb();
    const user = db.prepare('SELECT id, username, password_hash, role, display_name, active FROM staff WHERE username = ?').get(username);

    if (!user) {
      return res.status(401).json({
        success: false,
        error: 'Credenciales inválidas',
        code: 'INVALID_CREDENTIALS',
      });
    }

    if (!user.active) {
      return res.status(403).json({
        success: false,
        error: 'Cuenta desactivada. Contacte al administrador.',
        code: 'ACCOUNT_DISABLED',
      });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({
        success: false,
        error: 'Credenciales inválidas',
        code: 'INVALID_CREDENTIALS',
      });
    }

    // Generate tokens
    const tokenUser = {
      id: user.id,
      username: user.username,
      role: user.role,
      displayName: user.display_name,
    };

    const token = generateToken(tokenUser);
    const refreshToken = generateRefreshToken(tokenUser);

    res.json({
      success: true,
      token,
      refreshToken,
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        displayName: user.display_name,
      },
    });
  } catch (err) {
    console.error('[Auth] Login error:', err.message);
    res.status(500).json({
      success: false,
      error: 'Error al iniciar sesión',
      code: 'LOGIN_ERROR',
    });
  }
});

// ============================================================
// POST /api/auth/pin — PIN login for meseros
// ============================================================

router.post('/pin', (req, res) => {
  try {
    const { pin } = req.body;

    if (!pin) {
      return res.status(400).json({
        success: false,
        error: 'PIN requerido',
        code: 'PIN_REQUIRED',
      });
    }

    const db = getDb();

    // Buscar mesero por PIN
    const user = db.prepare(
      'SELECT id, username, password_hash, role, display_name, pin_hash, active FROM staff WHERE role = ? AND active = 1'
    ).all('mesero');

    // Find matching PIN
    const matched = user.find(u => u.pin_hash && bcrypt.compareSync(pin, u.pin_hash));

    if (!matched) {
      return res.status(401).json({
        success: false,
        error: 'PIN inválido',
        code: 'INVALID_PIN',
      });
    }

    const tokenUser = {
      id: matched.id,
      username: matched.username,
      role: matched.role,
      displayName: matched.display_name,
    };

    const token = generateToken(tokenUser);
    const refreshToken = generateRefreshToken(tokenUser);

    res.json({
      success: true,
      token,
      refreshToken,
      user: {
        id: matched.id,
        username: matched.username,
        role: matched.role,
        displayName: matched.display_name,
      },
    });
  } catch (err) {
    console.error('[Auth] PIN login error:', err.message);
    res.status(500).json({
      success: false,
      error: 'Error al verificar PIN',
      code: 'PIN_ERROR',
    });
  }
});

// ============================================================
// POST /api/auth/refresh
// ============================================================

router.post('/refresh', (req, res) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return res.status(400).json({
        success: false,
        error: 'Refresh token requerido',
        code: 'REFRESH_TOKEN_REQUIRED',
      });
    }

    const decoded = verifyToken(refreshToken);
    if (!decoded || decoded.type !== 'refresh') {
      return res.status(401).json({
        success: false,
        error: 'Refresh token inválido o expirado',
        code: 'INVALID_REFRESH_TOKEN',
      });
    }

    // Get fresh user data
    const db = getDb();
    const user = db.prepare('SELECT id, username, role, display_name FROM staff WHERE id = ? AND active = 1').get(decoded.sub);

    if (!user) {
      return res.status(401).json({
        success: false,
        error: 'Usuario no encontrado o desactivado',
        code: 'USER_NOT_FOUND',
      });
    }

    const tokenUser = {
      id: user.id,
      username: user.username,
      role: user.role,
      displayName: user.display_name,
    };

    const token = generateToken(tokenUser);
    const newRefreshToken = generateRefreshToken(tokenUser);

    res.json({
      success: true,
      token,
      refreshToken: newRefreshToken,
    });
  } catch (err) {
    console.error('[Auth] Refresh error:', err.message);
    res.status(500).json({
      success: false,
      error: 'Error al renovar token',
      code: 'REFRESH_ERROR',
    });
  }
});

// ============================================================
// GET /api/auth/me — Authenticated user profile
// ============================================================

router.get('/me', requireAuth, (req, res) => {
  try {
    const db = getDb();
    const user = db.prepare(
      'SELECT id, username, role, display_name, created_at, last_login FROM staff WHERE id = ?'
    ).get(req.user.sub);

    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'Usuario no encontrado',
        code: 'USER_NOT_FOUND',
      });
    }

    res.json({
      success: true,
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        displayName: user.display_name,
        createdAt: user.created_at,
        lastLogin: user.last_login,
      },
    });
  } catch (err) {
    console.error('[Auth] Me error:', err.message);
    res.status(500).json({
      success: false,
      error: 'Error al obtener perfil',
      code: 'PROFILE_ERROR',
    });
  }
});

// ============================================================
// POST /api/auth/logout
// ============================================================

router.post('/logout', (req, res) => {
  // JWT es stateless — el cliente debe descartar el token.
  // En el futuro, podemos agregar una blocklist.
  res.json({
    success: true,
    message: 'Sesión cerrada exitosamente. Descarte su token.',
  });
});

export default router;
