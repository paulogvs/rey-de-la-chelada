/**
 * ═══════════════════════════════════════════════════════════
 *  Client Sessions Service — Sesiones QR server-side
 *
 *  FIX DEL BUG: la sesión QR vivía en la memoria del navegador
 *  del Admin (SecurityEngine.activeSessions). El cliente, al abrir
 *  la URL, tenía su propia instancia vacía → "Sesión no encontrada".
 *
 *  Ahora las sesiones viven en SQLite (tabla client_sessions):
 *    - Admin crea la sesión: POST /api/client-sessions
 *    - Cliente valida:      GET  /api/client-sessions/:sid/validate
 *  Mismo patrón que client-orders (público, sin JWT).
 *
 *  "El pedido activo es el permiso" se mantiene: validate recibe
 *  hasActiveOrder desde el servidor (estado real de la mesa).
 *
 *  Alineado al SSOT: server/db/schema.js → client_sessions
 * ═══════════════════════════════════════════════════════════
 */

import { randomUUID } from 'node:crypto';

/** Duración por defecto del QR (minutos) — configurable por caller */
const DEFAULT_TTL_MINUTES = 180;

function nowIso() {
  return new Date().toISOString();
}

function addMinutesIso(minutes) {
  return new Date(Date.now() + minutes * 60 * 1000).toISOString();
}

/**
 * Crea una sesión QR para una mesa (server-side).
 * @param {object} db — better-sqlite3 instance
 * @param {number} tableNumber
 * @param {number} [ttlMinutes=180]
 * @returns {{ success: boolean, sessionId?: string, tableNumber?: number, expiresAt?: string, code?: string, error?: string }}
 */
export function createClientSession(db, tableNumber, ttlMinutes = DEFAULT_TTL_MINUTES) {
  const table = db.prepare('SELECT id FROM tables WHERE number = ?').get(tableNumber);
  if (!table) {
    return { success: false, code: 'TABLE_NOT_FOUND', error: 'Mesa no encontrada' };
  }

  const sessionId = `sess_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;
  const expiresAt = addMinutesIso(ttlMinutes);

  db.prepare(`
    INSERT INTO client_sessions (id, session_id, table_number, expires_at)
    VALUES (?, ?, ?, ?)
  `).run(randomUUID(), sessionId, tableNumber, expiresAt);

  return {
    success: true,
    sessionId,
    tableNumber,
    expiresAt,
  };
}

/**
 * Obtiene o crea la sesión activa de una mesa (creación LAZY).
 *
 * QR estático (Opción A): el QR codifica SOLO `{base}/clientes?mesa=N`
 * (sin sid). Cuando el cliente abre esa URL, este servicio crea/obtiene
 * la sesión en el servidor y la persiste en localStorage del cliente.
 *
 * Regla de reutilización (SSOT):
 *  - Si la mesa tiene una sesión vigente (no expirada) → se REUTILIZA.
 *    Así el mismo dispositivo/cliente conserva su sesión entre visitas.
 *  - Si no existe o expiró → se crea una nueva.
 *
 * @param {object} db
 * @param {number} tableNumber
 * @returns {{ success: boolean, sessionId?: string, tableNumber?: number, expiresAt?: string, reused?: boolean, code?: string, error?: string }}
 */
export function getOrCreateClientSession(db, tableNumber) {
  const table = db.prepare('SELECT id FROM tables WHERE number = ?').get(tableNumber);
  if (!table) {
    return { success: false, code: 'TABLE_NOT_FOUND', error: 'Mesa no encontrada' };
  }

  // 1) Reutilizar sesión vigente (no expirada) de esta mesa, si existe.
  // Comparación en JS (Date) — igual que validateClientSession — para
  // evitar mezclar formatos ISO vs datetime('now') en SQL.
  const rows = db.prepare(`
    SELECT session_id, expires_at, created_at FROM client_sessions
    WHERE table_number = ? ORDER BY created_at DESC
  `).all(tableNumber);

  const valid = rows.find(r => new Date(r.expires_at).getTime() > Date.now());

  if (valid) {
    return {
      success: true,
      sessionId: valid.session_id,
      tableNumber,
      expiresAt: valid.expires_at,
      reused: true,
    };
  }

  // 2) No queda sesión vigente: purgar las expiradas de esta mesa
  //    (housekeeping puntual) y crear una nueva (lazy).
  db.prepare("DELETE FROM client_sessions WHERE table_number = ?").run(tableNumber);

  const created = createClientSession(db, tableNumber, DEFAULT_TTL_MINUTES);
  if (!created.success) return created;
  return { ...created, reused: false };
}

/**
 * Valida una sesión QR contra el servidor.
 * @param {object} db
 * @param {string} sessionId
 * @param {number} tableNumber
 * @param {boolean} hasActiveOrder — hay pedido activo en la mesa (renueva si expiró)
 * @returns {{ valid: boolean, reason?: string, sessionId?: string }}
 */
export function validateClientSession(db, sessionId, tableNumber, hasActiveOrder) {
  const session = db.prepare(
    'SELECT * FROM client_sessions WHERE session_id = ?'
  ).get(sessionId);

  // Caso 1: Sesión no encontrada
  if (!session) {
    return { valid: false, reason: 'Sesión no encontrada. Escanea el QR nuevamente.' };
  }

  // Caso 2: Mesa incorrecta
  if (session.table_number !== tableNumber) {
    return { valid: false, reason: 'Mesa incorrecta.' };
  }

  // Caso 3: Token expirado
  if (new Date(session.expires_at) < new Date()) {
    db.prepare('DELETE FROM client_sessions WHERE session_id = ?').run(sessionId);

    // Si hay pedido activo, renueva automáticamente
    if (hasActiveOrder) {
      const renewed = renewClientSession(db, session, tableNumber);
      return { valid: true, sessionId: renewed.sessionId };
    }

    return { valid: false, reason: 'Sesión expirada. Escanea el QR nuevamente.' };
  }

  // ✅ Válido — actualizar actividad
  db.prepare(`
    UPDATE client_sessions
    SET last_active_at = ?, interactions = interactions + 1
    WHERE session_id = ?
  `).run(nowIso(), sessionId);

  return { valid: true };
}

/**
 * Renueva una sesión expirada (nuevo sessionId, misma mesa).
 * @param {object} db
 * @param {object} oldSession
 * @param {number} tableNumber
 * @returns {{ sessionId: string }}
 */
function renewClientSession(db, oldSession, tableNumber) {
  const sessionId = `sess_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;
  const expiresAt = addMinutesIso(DEFAULT_TTL_MINUTES);

  db.prepare(`
    INSERT INTO client_sessions (id, session_id, table_number, expires_at, order_id)
    VALUES (?, ?, ?, ?, ?)
  `).run(randomUUID(), sessionId, tableNumber, expiresAt, oldSession.order_id || null);

  return { sessionId };
}

/**
 * Invalida una sesión (cuando se paga la cuenta).
 * @param {object} db
 * @param {string} sessionId
 */
export function invalidateClientSession(db, sessionId) {
  db.prepare('DELETE FROM client_sessions WHERE session_id = ?').run(sessionId);
}

/**
 * Asocia un pedido a una sesión y renueva su expiración.
 * @param {object} db
 * @param {string} sessionId
 * @param {string} orderId
 */
export function associateOrderToSession(db, sessionId, orderId) {
  db.prepare(`
    UPDATE client_sessions
    SET order_id = ?, expires_at = ?, last_active_at = ?
    WHERE session_id = ?
  `).run(orderId, addMinutesIso(DEFAULT_TTL_MINUTES), nowIso(), sessionId);
}

/**
 * Limpia sesiones expiradas sin pedido (housekeeping).
 * @param {object} db
 * @returns {number} — sesiones eliminadas
 */
export function cleanExpiredSessions(db) {
  const res = db.prepare(
    "DELETE FROM client_sessions WHERE expires_at < datetime('now') AND (order_id IS NULL OR order_id = '')"
  ).run();
  return res.changes;
}
