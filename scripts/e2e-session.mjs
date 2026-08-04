/**
 * E2E sesión — login 1 vez, persiste tokens (evita authLimiter).
 *
 *   node scripts/e2e-session.mjs          → login + guardar tokens
 *   node scripts/e2e-session.mjs --fresh  → login nuevo (fuerza)
 *   node scripts/e2e-session.mjs --show   → mostrar tokens sin login
 *
 * Guarda en .e2e-session.json (gitignored) los 3 tokens. Los scripts
 * E2E los cargan desde ahí y NO vuelven a llamar /api/auth/login
 * (rate limit: 5/min por IP).
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { login, BASE } from './e2e-lib.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SESSION_FILE = resolve(__dirname, '.e2e-session.json');

export function loadSession() {
  if (!existsSync(SESSION_FILE)) return null;
  try {
    return JSON.parse(readFileSync(SESSION_FILE, 'utf-8'));
  } catch {
    return null;
  }
}

export function saveSession(session) {
  writeFileSync(SESSION_FILE, JSON.stringify(session, null, 2), 'utf-8');
  return session;
}

export async function loginAll() {
  const [admin, mesero, kds] = await Promise.all([
    login('0000'),
    login('1111'),
    login('2222'),
  ]);
  if (!admin.ok || !mesero.ok || !kds.ok) {
    const statuses = { admin: admin.status, mesero: mesero.status, kds: kds.status };
    throw new Error(`Login failed: ${JSON.stringify(statuses)} — ¿rate limit? Espera 60s.`);
  }
  return {
    base: BASE,
    loggedAt: new Date().toISOString(),
    admin: { token: admin.token, role: admin.user.role },
    mesero: { token: mesero.token, role: mesero.user.role },
    kds: { token: kds.token, role: kds.user.role },
  };
}

export function tokenFor(role) {
  const session = loadSession();
  if (!session?.[role]?.token) return null;
  return session[role].token;
}

// CLI
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const arg = process.argv[2];
  if (arg === '--show') {
    const s = loadSession();
    if (!s) {
      console.error('No session file. Run: node scripts/e2e-session.mjs');
      process.exit(1);
    }
    console.log(`Session válida: ${s.base} | admin=${!!s.admin.token} mesero=${!!s.mesero.token} kds=${!!s.kds.token}`);
    process.exit(0);
  }
  if (arg === '--fresh' || !loadSession()) {
    try {
      const session = await loginAll();
      saveSession(session);
      console.log(`Session creada: admin/mesero/kds OK (${session.base})`);
    } catch (err) {
      console.error(`Session error: ${err.message}`);
      process.exit(1);
    }
  } else {
    console.log('Session ya existe. Usa --fresh para renovar.');
  }
}
