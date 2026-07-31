/**
 * ═══════════════════════════════════════════════════════════
 *  Auth Routes — Login, PIN, Refresh, Profile
 *
 *  v2: PIN login matches ANY staff row with that PIN.
 *  Returns JWT with role. No username needed.
 *
 *  POST /api/auth/login     → Login con PIN (matches any staff)
 *  POST /api/auth/pin       → Alias for /login
 *  POST /api/auth/refresh   → Refresh token
 *  GET  /api/auth/me        → Perfil del usuario autenticado
 *  POST /api/auth/logout    → Logout
 *
 *  Alineado al SSOT: server/db/schema.js → staff (pin_hash, is_active)
 * ═══════════════════════════════════════════════════════════
 */

import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { getDb } from '../db/index.js';
import { generateToken, generateRefreshToken, verifyToken, requireAuth } from '../middleware/auth.js';

const router = Router();

// ============================================================
// POST /api/auth/login — PIN login (matches any staff row)
// ============================================================

router.post('/login', (req, res) => {
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
    const users = db.prepare(
      'SELECT id, pin_hash, role, display_name, is_active FROM staff WHERE is_active = 1'
    ).all();

    const matched = users.find(u => u.pin_hash && bcrypt.compareSync(String(pin), u.pin_hash));

    if (!matched) {
      return res.status(401).json({
        success: false,
        error: 'PIN inválido',
        code: 'INVALID_PIN',
      });
    }

    db.prepare("UPDATE staff SET last_login_at = datetime('now') WHERE id = ?").run(matched.id);

    const tokenUser = {
      id: matched.id,
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
        role: matched.role,
        displayName: matched.display_name,
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
// POST /api/auth/pin — Alias for /login
// ============================================================

router.post('/pin', (req, res) => {
  // Redirect to login handler
  req.url = '/login';
  router.handle(req, res);
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

    const db = getDb();
    const user = db.prepare(
      'SELECT id, role, display_name FROM staff WHERE id = ? AND is_active = 1'
    ).get(decoded.sub);

    if (!user) {
      return res.status(401).json({
        success: false,
        error: 'Usuario no encontrado o desactivado',
        code: 'USER_NOT_FOUND',
      });
    }

    const tokenUser = {
      id: user.id,
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
      'SELECT id, role, display_name, is_active, current_shift, last_login_at, created_at FROM staff WHERE id = ?'
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
        role: user.role,
        displayName: user.display_name,
        isActive: !!user.is_active,
        currentShift: user.current_shift,
        lastLogin: user.last_login_at,
        createdAt: user.created_at,
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
  res.json({
    success: true,
    message: 'Sesión cerrada exitosamente. Descarte su token.',
  });
});

export default router;
