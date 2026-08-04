/**
 * E2E helper compartido — Rey de la Chelada (FASE 2)
 *
 * Uso: node scripts/e2e-lib.mjs  (solo definiciones, no corre nada)
 *
 * Patrón de cada script:
 *   import { api, login, assert, ensureThrowawayTable, cleanupOrder } from './e2e-lib.mjs';
 *
 * Reglas de diseño:
 *   - BASE configurable: 3003 (aislado) por defecto, 3002 (PROD) para smoke.
 *   - Mesas throwaway: numbers 90-99 (se crean y se limpian, no tocan reales).
 *   - NUNCA borra pedidos/tablas reales: solo los que el propio script crea.
 *   - No dispara rate limit: 1 login por script, pocos intentos fallidos.
 */

export const BASE = process.env.E2E_BASE || 'http://localhost:3003';

// Tokens compartidos entre scripts vía env (evita disparar authLimiter:
// 5 requests/min sobre /api/auth/* — ver hallazgo en e2e-login.mjs).
//   E2E_ADMIN_TOKEN / E2E_MESERO_TOKEN / E2E_KDS_TOKEN
export const SHARED_TOKENS = {
  admin: process.env.E2E_ADMIN_TOKEN || null,
  mesero: process.env.E2E_MESERO_TOKEN || null,
  kds: process.env.E2E_KDS_TOKEN || null,
};

// ============================================================
// HTTP helpers
// ============================================================

export async function api(path, { method = 'GET', body, token } = {}) {
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    // Non-JSON response
  }
  return { status: res.status, json };
}

export async function login(pin) {
  const res = await api('/api/auth/login', { method: 'POST', body: { pin } });
  return {
    ok: res.status === 200 && res.json?.token != null,
    status: res.status,
    token: res.json?.token || null,
    user: res.json?.user || null,
    code: res.json?.code || null,
  };
}

// ============================================================
// Assertions
// ============================================================

export function makeReporter(flowName) {
  const failures = [];
  let checks = 0;
  return {
    assert(cond, label) {
      checks += 1;
      if (cond) {
        console.log(`  ✓ ${label}`);
      } else {
        failures.push(label);
        console.error(`  ✗ ${label}`);
      }
    },
    /** Termina con exit code correcto */
    finish() {
      console.log(`\n[${flowName}] checks: ${checks} | failures: ${failures.length}`);
      if (failures.length > 0) {
        console.error(`[${flowName}] FAILED: ${failures.join(' | ')}`);
        process.exit(1);
      }
      console.log(`[${flowName}] ALL CHECKS PASSED ✅`);
      process.exit(0);
    },
    get failures() {
      return failures;
    },
  };
}

// ============================================================
// Fixtures — mesa throwaway + items del menú
// ============================================================

let _menu = null;

/** Devuelve el menú real cacheado: { items, barItems, cocinaItems } */
export async function getMenu() {
  if (_menu) return _menu;
  const res = await api('/api/menu/items');
  if (res.status !== 200 || !res.json?.items) {
    throw new Error(`Menu fetch failed: HTTP ${res.status}`);
  }
  const items = res.json.items.filter(i => i.price != null && i.price > 0);
  _menu = {
    items,
    barItems: items.filter(i => i.area === 'bar'),
    cocinaItems: items.filter(i => i.area === 'cocina' || !i.area),
  };
  return _menu;
}

/**
 * Asegura que exista una mesa throwaway (número dado, 90-99) usando
 * admin. Devuelve { id, number }. Idempotente.
 */
export async function ensureThrowawayTable(number = 99, { adminToken } = {}) {
  const list = await api('/api/tables', { token: adminToken });
  const existing = list.json?.tables?.find(t => t.number === number);
  if (existing) return { id: existing.id, number };

  const created = await api('/api/tables', {
    method: 'POST',
    token: adminToken,
    body: { number, capacity: 4, section: 'e2e' },
  });
  if (created.status !== 201 || !created.json?.table) {
    throw new Error(`Table ${number} create failed: HTTP ${created.status}`);
  }
  return { id: created.json.table.id, number };
}

// ============================================================
// Cleanup — SOLO lo que creó el script (order + mesa throwaway)
// ============================================================

/** Borra un pedido y sus pagos/items directamente (admin-owned flow). */
export async function cleanupOrder(orderId, { adminToken } = {}) {
  if (!orderId) return;
  try {
    await api(`/api/payments/${orderId}`, { method: 'DELETE', token: adminToken });
  } catch { /* payments DELETE puede no existir — se limpia por DB */ }
  // Mejor vía directa no disponible por HTTP → los scripts que lo necesiten
  // importan better-sqlite3 localmente (ver e2e-mesero-flow.mjs cleanup).
  void adminToken;
}

/** Borra una mesa throwaway (admin). */
export async function deleteThrowawayTable(tableId, { adminToken } = {}) {
  if (!tableId) return;
  await api(`/api/tables/${tableId}`, { method: 'DELETE', token: adminToken });
}

// ============================================================
// Fixtures de pedido — items bar + cocina para KDS separado
// ============================================================

/** Escoge un item de barra y uno de cocina (para pedido mixto). */
export async function pickMixedItems() {
  const menu = await getMenu();
  if (menu.barItems.length === 0 || menu.cocinaItems.length === 0) {
    throw new Error('Menú sin items mixtos (bar+cocina) para el test');
  }
  return { bar: menu.barItems[0], cocina: menu.cocinaItems[0] };
}

export default { BASE, api, login, makeReporter, getMenu, ensureThrowawayTable, cleanupOrder, deleteThrowawayTable, pickMixedItems };
