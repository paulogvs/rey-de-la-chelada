/**
 * Client Sessions Service Tests
 *
 * TDD: server-side QR sessions for the clientes PWA.
 *
 * The bug: QR sessions lived in the ADMIN browser's in-memory
 * SecurityEngine map, so the clientes PWA (separate instance) always
 * got "Sesión no encontrada" → and the QR URL used localhost → blank
 * page on phones. Fix: sessions are created + validated on the SERVER
 * (SQLite + public API), mirroring the client-orders pattern.
 *
 * Verifies:
 *  - createClientSession: creates a session with future expiry
 *  - sessionId is generated (sess_ prefix)
 *  - validateClientSession: valid when exists + correct table + not expired
 *  - invalid when missing, wrong table, or expired
 *  - expired session with active order is renewed (new id)
 *  - invalidate removes the session
 */

import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { applySchema } from '../../server/db/schema.js';
import {
  createClientSession,
  getOrCreateClientSession,
  validateClientSession,
  invalidateClientSession,
} from '../../server/services/client-sessions.js';

let db;

beforeEach(() => {
  db = new Database(':memory:');
  applySchema(db);
  // Mesa 1 + waiter para FK
  db.prepare(
    "INSERT INTO tables (id, number, capacity, status, section, position) VALUES (?, ?, ?, 'free', 'interior', 1)"
  ).run('tbl-1', 1, 4);
  db.prepare(
    "INSERT INTO staff (id, pin_hash, role, display_name) VALUES ('w1', 'x', 'mesero', 'Mesero')"
  ).run();
});

function makeOrder(tableNumber, status) {
  const id = `order-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  db.prepare(`
    INSERT INTO orders (id, table_id, table_number, waiter_id, waiter_name, status,
                        subtotal, iva_amount, discount, total, guest_count)
    VALUES (?, 'tbl-1', ?, 'w1', 'Mesero', ?, 0, 0, 0, 0, 1)
  `).run(id, tableNumber, status);
  return id;
}

describe('createClientSession', () => {
  it('creates a session with future expiry and sess_ id', () => {
    const result = createClientSession(db, 1, 180);
    expect(result.success).toBe(true);
    expect(result.sessionId).toMatch(/^sess_/);

    const row = db.prepare('SELECT * FROM client_sessions WHERE session_id = ?').get(result.sessionId);
    expect(row).toBeTruthy();
    expect(row.table_number).toBe(1);
    expect(new Date(row.expires_at).getTime()).toBeGreaterThan(Date.now());
  });

  it('rejects unknown table', () => {
    const result = createClientSession(db, 99, 180);
    expect(result.success).toBe(false);
    expect(result.code).toBe('TABLE_NOT_FOUND');
  });
});

describe('validateClientSession', () => {
  it('returns valid for an existing, unexpired, correct-table session', () => {
    const { sessionId } = createClientSession(db, 1, 180);
    const res = validateClientSession(db, sessionId, 1, false);
    expect(res.valid).toBe(true);
    expect(res.reason).toBeUndefined();
  });

  it('invalid when session missing', () => {
    const res = validateClientSession(db, 'sess_unknown', 1, false);
    expect(res.valid).toBe(false);
    expect(res.reason).toContain('Sesión no encontrada');
  });

  it('invalid when wrong table', () => {
    const { sessionId } = createClientSession(db, 1, 180);
    const res = validateClientSession(db, sessionId, 2, false);
    expect(res.valid).toBe(false);
    expect(res.reason).toContain('Mesa incorrecta');
  });

  it('invalid when expired (no active order)', () => {
    // Crear sesión ya expirada
    const { sessionId } = createClientSession(db, 1, -1);
    const res = validateClientSession(db, sessionId, 1, false);
    expect(res.valid).toBe(false);
    expect(res.reason).toContain('expirada');
  });

  it('renews an expired session when there is an active order (new id)', () => {
    const { sessionId } = createClientSession(db, 1, -1); // expirada
    makeOrder(1, 'confirmed'); // pedido activo

    const res = validateClientSession(db, sessionId, 1, true);
    expect(res.valid).toBe(true);
    // Sesión vieja removida, nueva creada
    const old = db.prepare('SELECT * FROM client_sessions WHERE session_id = ?').get(sessionId);
    expect(old).toBeFalsy();
    const count = db.prepare('SELECT COUNT(*) AS n FROM client_sessions').get().n;
    expect(count).toBe(1);
  });
});

describe('getOrCreateClientSession (QR estático / lazy)', () => {
  it('crea una sesión para la mesa cuando no existe ninguna', () => {
    const res = getOrCreateClientSession(db, 1);
    expect(res.success).toBe(true);
    expect(res.sessionId).toMatch(/^sess_/);
    expect(res.reused).toBe(false);
    const count = db.prepare('SELECT COUNT(*) AS n FROM client_sessions').get().n;
    expect(count).toBe(1);
  });

  it('reutiliza la sesión vigente de la mesa (mismo sessionId)', () => {
    const first = getOrCreateClientSession(db, 1);
    const second = getOrCreateClientSession(db, 1);
    expect(first.success).toBe(true);
    expect(second.success).toBe(true);
    expect(second.sessionId).toBe(first.sessionId);
    expect(second.reused).toBe(true);
    const count = db.prepare('SELECT COUNT(*) AS n FROM client_sessions').get().n;
    expect(count).toBe(1); // no se duplicó
  });

  it('crea una sesión nueva cuando la anterior expiró', () => {
    const first = createClientSession(db, 1, -1); // expirada
    const res = getOrCreateClientSession(db, 1);
    expect(res.success).toBe(true);
    expect(res.sessionId).not.toBe(first.sessionId);
    expect(res.reused).toBe(false);
    // La expirada quedó purgada
    const old = db.prepare('SELECT * FROM client_sessions WHERE session_id = ?').get(first.sessionId);
    expect(old).toBeFalsy();
  });

  it('rechaza mesa inexistente', () => {
    const res = getOrCreateClientSession(db, 99);
    expect(res.success).toBe(false);
    expect(res.code).toBe('TABLE_NOT_FOUND');
  });
});

describe('invalidateClientSession', () => {
  it('removes the session (payment done)', () => {
    const { sessionId } = createClientSession(db, 1, 180);
    invalidateClientSession(db, sessionId);
    const row = db.prepare('SELECT * FROM client_sessions WHERE session_id = ?').get(sessionId);
    expect(row).toBeFalsy();
  });
});
