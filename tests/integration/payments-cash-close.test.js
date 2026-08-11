/**
 * Integración — Pagos & Corte de Caja (FASE 3: simplificación)
 *
 * F3-1 — Propina ELIMINADA: el server rechaza/ignora tip; SOLO 2 métodos: cash | qr
 * F3-2 — Efectivo al centavo: received (lo que entrega el cliente) + change (vuelto);
 *        SUM(amount) = lo que queda en caja; el cierre cuadra al centavo.
 * F3-3 — Cierre: expected = SOLO efectivo (cash); is_reconciled lo decide el server.
 * C2   — failed/refunded NO cuentan como cobrados
 * C3   — Invariante: pedido solo queda paid con pago completed
 *
 * Patrón: server real con DB_PATH = temp (NO toca data/rey-de-la-chelada.db).
 * DB_PATH se setea ANTES de importar server/index.js.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_DB = 'data/test-cash-close.db';

process.env.PORT = '0';
process.env.DB_PATH = TEST_DB;

let server;
let base;
let adminToken;
let meseroToken;

beforeAll(async () => {
  const mod = await import('../../server/index.js');
  server = mod.server;
  let addr = null;
  for (let i = 0; i < 50 && !addr; i++) {
    addr = server.address();
    if (!addr) await new Promise(r => setTimeout(r, 25));
  }
  if (!addr) throw new Error('El server no escuchó en tiempo razonable');
  base = `http://127.0.0.1:${addr.port}`;

  adminToken = await login('0000');
  meseroToken = await login('1111');
});

afterAll(async () => {
  await new Promise(resolve => server.close(resolve));
  const { closeDb } = await import('../../server/db/index.js');
  closeDb();
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(path.resolve(__dirname, '..', '..', TEST_DB + suffix)); } catch { /* noop */ }
  }
});

async function api(p, { method = 'GET', body, token } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${base}${p}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch { /* noop */ }
  return { status: res.status, json };
}

async function login(pin) {
  const r = await api('/api/auth/login', { method: 'POST', body: { pin } });
  return r.json?.token;
}

// ── Fixtures ───────────────────────────────────────────────

let tableCounter = 90;

async function ensureTable(number) {
  const tables = await api('/api/tables', { token: adminToken });
  const existing = tables.json?.tables?.find(t => t.number === number);
  if (existing) return existing.id;
  const created = await api('/api/tables', {
    method: 'POST', token: adminToken,
    body: { number, capacity: 4, section: 'e2e' },
  });
  return created.json?.table?.id;
}

/** Crea un pedido de 1 item (precio fijo del menú) y devuelve { orderId, total } */
async function createOrder() {
  const tableId = await ensureTable(++tableCounter);
  const menu = await api('/api/menu/items');
  const item = menu.json?.items?.find(i => i.price != null && i.area === 'bar');
  const create = await api('/api/orders', {
    method: 'POST', token: meseroToken,
    body: { table_id: tableId, items: [{ menu_item_id: item.id, quantity: 1 }] },
  });
  const order = create.json?.order;
  return { orderId: order.id, total: order.total };
}

/** Registra un pago (wrapper) */
async function pay(orderId, amount, method, extra = {}) {
  return api('/api/payments', {
    method: 'POST', token: meseroToken,
    body: { order_id: orderId, amount, method, ...extra },
  });
}

// Helper: monto base del día (para no acoplar tests entre sí)
async function todayTotalBaseline() {
  const cur = await api('/api/payments/closing/current', { token: adminToken });
  return cur.json?.today?.total || 0;
}

// ═══════════════════════════════════════════════════════════
// F3-1 — Propina ELIMINADA + solo métodos cash|qr
// ═══════════════════════════════════════════════════════════

describe('F3-1 — sin propina, solo cash|qr', () => {
  it('rechaza métodos legacy (qr_yape/card/transfer) → 400 INVALID_METHOD', async () => {
    const { orderId, total } = await createOrder();
    for (const m of ['qr_yape', 'qr_simple', 'card', 'transfer', 'tarjeta']) {
      const r = await pay(orderId, total, m);
      expect(r.status).toBe(400);
      expect(r.json.code).toBe('INVALID_METHOD');
    }
    // Y el pedido NO quedó paid
    const order = await api(`/api/orders/${orderId}`, { token: meseroToken });
    expect(order.json.order.is_paid).toBe(0);
  });

  it('acepta cash y qr (efectivo y QR simple)', async () => {
    const o1 = await createOrder();
    const cash = await pay(o1.orderId, o1.total, 'cash');
    expect(cash.status).toBe(201);
    expect(cash.json.fully_paid).toBe(true);

    const o2 = await createOrder();
    const qr = await pay(o2.orderId, o2.total, 'qr');
    expect(qr.status).toBe(201);
    expect(qr.json.fully_paid).toBe(true);
    expect(qr.json.payment.method).toBe('qr');
  });

  it('el payment devuelto NO tiene campo tip (columna eliminada)', async () => {
    const { orderId, total } = await createOrder();
    const r = await pay(orderId, total, 'qr');
    expect(r.status).toBe(201);
    expect(r.json.payment.tip).toBeUndefined();
  });

  it('un tip enviado por el cliente se IGNORA (no rompe el flujo)', async () => {
    const { orderId, total } = await createOrder();
    const r = await pay(orderId, total, 'qr', { tip: 5 });
    expect(r.status).toBe(201);
    expect(r.json.fully_paid).toBe(true);
    expect(r.json.payment.tip).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════
// F3-2 — Efectivo al centavo: received/change
// ═══════════════════════════════════════════════════════════

describe('F3-2 — efectivo received/change (vuelto al centavo)', () => {
  it('pago cash con received > amount → registra change = received - amount', async () => {
    const { orderId, total } = await createOrder();
    const received = Math.round((total + 10) * 100) / 100; // cliente entrega billete de más
    const r = await pay(orderId, total, 'cash', { received });
    expect(r.status).toBe(201);
    expect(r.json.payment.amount).toBe(total);
    expect(r.json.payment.received).toBe(received);
    expect(r.json.payment.change).toBe(Math.round((received - total) * 100) / 100);
    expect(r.json.fully_paid).toBe(true);
  });

  it('pago cash sin received → default received = amount, change = 0 (retrocompat)', async () => {
    const { orderId, total } = await createOrder();
    const r = await pay(orderId, total, 'cash');
    expect(r.status).toBe(201);
    expect(r.json.payment.received).toBe(total);
    expect(r.json.payment.change).toBe(0);
  });

  it('rechaza received < amount (no puede entregar menos de lo que se cobra) → 400', async () => {
    const { orderId, total } = await createOrder();
    const r = await pay(orderId, total, 'cash', { received: Math.round((total - 1) * 100) / 100 });
    expect(r.status).toBe(400);
    expect(r.json.code).toBe('INVALID_RECEIVED');
  });

  it('el corte actual reporta received_total y change_total del efectivo (cuadre al centavo)', async () => {
    const before = await api('/api/payments/closing/current', { token: adminToken });
    const baselineReceived = before.json?.today?.received_total || 0;
    const baselineChange = before.json?.today?.change_total || 0;

    const { orderId, total } = await createOrder();
    const received = Math.round((total + 20) * 100) / 100;
    await pay(orderId, total, 'cash', { received });

    const cur = await api('/api/payments/closing/current', { token: adminToken });
    expect(cur.json.today.received_total).toBe(Math.round((baselineReceived + received) * 100) / 100);
    expect(cur.json.today.change_total).toBe(Math.round((baselineChange + (received - total)) * 100) / 100);
    // El neto en caja (amount) sigue cuadrando: received_total - change_total == cash total
    const net = Math.round((cur.json.today.received_total - cur.json.today.change_total) * 100) / 100;
    expect(net).toBe(cur.json.today.cash);
  });
});

// ═══════════════════════════════════════════════════════════
// C2 — failed/refunded NO cuentan como cobrados
// ═══════════════════════════════════════════════════════════

describe('C2 — pagos failed/refunded no cuentan como cobrados', () => {
  it('un pago failed NO deja el pedido paid y NO bloquea el pago completed posterior', async () => {
    const before = await todayTotalBaseline();
    const { orderId, total } = await createOrder();

    // Pago failed por el total (el route acepta status en body)
    const failed = await pay(orderId, total, 'cash', { status: 'failed' });
    expect(failed.status).toBe(201);
    expect(failed.json.fully_paid).toBe(false);

    const afterFailed = await api(`/api/orders/${orderId}`, { token: meseroToken });
    expect(afterFailed.json.order.is_paid).toBe(0);
    expect(afterFailed.json.order.status).not.toBe('paid');

    // Pago completed por el total → el failed NO debe contar en el saldo
    const completed = await pay(orderId, total, 'cash');
    expect(completed.status).toBe(201);
    expect(completed.json.fully_paid).toBe(true);

    const after = await api(`/api/orders/${orderId}`, { token: meseroToken });
    expect(after.json.order.status).toBe('paid');

    // closing/current: total del día = SOLO el completed (failed excluido)
    const cur = await api('/api/payments/closing/current', { token: adminToken });
    expect(cur.json.today.total).toBe(before + total);
  });

  it('pagos refunded tampoco cuentan en el total del día', async () => {
    const before = await todayTotalBaseline();
    const { orderId, total } = await createOrder();
    // completed (cuenta) + refunded (no cuenta)
    await pay(orderId, total, 'qr');
    const ref = await pay(orderId, 10, 'qr', { status: 'refunded' });
    expect(ref.status).toBe(201);
    const cur = await api('/api/payments/closing/current', { token: adminToken });
    expect(cur.json.today.total).toBe(before + total);
  });
});

// ═══════════════════════════════════════════════════════════
// C3 — Invariante: paid requiere pago completed
// ═══════════════════════════════════════════════════════════

describe('C3 — invariante: pedido solo queda paid con pago completed', () => {
  it('PATCH status paid SIN pago → 409 PAYMENT_REQUIRED', async () => {
    const { orderId } = await createOrder();
    const r = await api(`/api/orders/${orderId}/status`, {
      method: 'PATCH', token: meseroToken, body: { status: 'paid' },
    });
    expect(r.status).toBe(409);
    expect(r.json.code).toBe('PAYMENT_REQUIRED');
    const order = await api(`/api/orders/${orderId}`, { token: meseroToken });
    expect(order.json.order.is_paid).toBe(0);
  });

  it('PATCH status paid con pago parcial → 409; con pago completo → 200', async () => {
    const { orderId, total } = await createOrder();
    const half = Math.round((total / 2) * 100) / 100;

    await pay(orderId, half, 'qr');
    const partial = await api(`/api/orders/${orderId}/status`, {
      method: 'PATCH', token: meseroToken, body: { status: 'paid' },
    });
    expect(partial.status).toBe(409);
    expect(partial.json.code).toBe('PAYMENT_REQUIRED');

    await pay(orderId, Math.round((total - half) * 100) / 100, 'qr');
    const full = await api(`/api/orders/${orderId}/status`, {
      method: 'PATCH', token: meseroToken, body: { status: 'paid' },
    });
    expect(full.status).toBe(200);
  });
});

// ═══════════════════════════════════════════════════════════
// F3-3 / C5 — Corte: expected = solo efectivo (cash)
// ═══════════════════════════════════════════════════════════

describe('C5 — expected_cash = solo efectivo', () => {
  it('corte con SOLO pagos QR → el QR NO aporta al expected (solo efectivo cuenta)', async () => {
    const before = await api('/api/payments/closing/current', { token: adminToken });
    const baselineCash = before.json?.today?.cash || 0;

    const { orderId, total } = await createOrder();
    await pay(orderId, total, 'qr');

    const open = await api('/api/payments/closing', { method: 'POST', token: adminToken, body: {} });
    expect(open.status).toBe(201);
    expect(open.json.closing.expected).toBe(baselineCash);

    const cur = await api('/api/payments/closing/current', { token: adminToken });
    expect(cur.json.today.cash).toBe(baselineCash);
    expect(cur.json.today.total).toBeGreaterThan(0); // el día sí registra ventas (QR)

    const close = await api('/api/payments/closing/close', {
      method: 'PUT', token: adminToken, body: { actual_cash: baselineCash, is_reconciled: false },
    });
    expect(close.status).toBe(200);
    expect(close.json.closing.difference).toBe(0);
    expect(close.json.closing.is_reconciled).toBe(1);
  });

  it('corte mixto: expected = SOLO cash; el vuelto (change) ya está descontado en amount', async () => {
    const before = await api('/api/payments/closing/current', { token: adminToken });
    const baselineCash = before.json?.today?.cash || 0;
    const baselineTotal = before.json?.today?.total || 0;

    // Pedido A pagado con QR, Pedido B con cash (cliente entrega billete de más)
    const oA = await createOrder();
    await pay(oA.orderId, oA.total, 'qr');
    const oB = await createOrder();
    const receivedB = Math.round((oB.total + 50) * 100) / 100;
    await pay(oB.orderId, oB.total, 'cash', { received: receivedB });

    const open = await api('/api/payments/closing', { method: 'POST', token: adminToken, body: {} });
    expect(open.status).toBe(201);
    // El expected NO incluye el vuelto: amount ya es neto (received - change)
    expect(open.json.closing.expected).toBe(Math.round((baselineCash + oB.total) * 100) / 100);

    const cur = await api('/api/payments/closing/current', { token: adminToken });
    expect(cur.json.today.cash).toBe(Math.round((baselineCash + oB.total) * 100) / 100);
    expect(cur.json.today.total).toBe(Math.round((baselineTotal + oA.total + oB.total) * 100) / 100);

    const closeOk = await api('/api/payments/closing/close', {
      method: 'PUT', token: adminToken, body: { actual_cash: baselineCash + oB.total, is_reconciled: false },
    });
    expect(closeOk.status).toBe(200);
    expect(closeOk.json.closing.difference).toBe(0);
    expect(closeOk.json.closing.is_reconciled).toBe(1);

    // Nuevo corte; cerrar con efectivo incorrecto → server decide no reconciliado
    const open2 = await api('/api/payments/closing', { method: 'POST', token: adminToken, body: {} });
    expect(open2.json.closing.expected).toBe(Math.round((baselineCash + oB.total) * 100) / 100);
    const closeBad = await api('/api/payments/closing/close', {
      method: 'PUT', token: adminToken, body: { actual_cash: baselineCash + oB.total - 10, is_reconciled: true },
    });
    expect(closeBad.status).toBe(200);
    expect(closeBad.json.closing.difference).toBe(-10);
    expect(closeBad.json.closing.is_reconciled).toBe(0);
  });
});
