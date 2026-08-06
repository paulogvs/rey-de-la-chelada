/**
 * Integración — Pagos & Corte de Caja (Fase 1: "la caja cuadre al centavo")
 *
 * C2 — failed/refunded NO cuentan como cobrados
 * C3 — Invariante: pedido solo queda paid con pago completed
 * C4 — Propina funcional (columna tip; total cobrado = amount + tip)
 * C5 — Corte: expected = SOLO efectivo (cash); is_reconciled lo decide el server
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

// ═══════════════════════════════════════════════════════════
// C2 — failed/refunded NO cuentan como cobrados
// ═══════════════════════════════════════════════════════════

describe('C2 — pagos failed/refunded no cuentan como cobrados', () => {
  it('un pago failed NO deja el pedido paid y NO bloquea el pago completed posterior', async () => {
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
    expect(cur.json.today.total).toBe(total);
  });

  it('pagos refunded tampoco cuentan en el total del día', async () => {
    const before = await todayTotalBaseline();
    const { orderId, total } = await createOrder();
    // completed (cuenta) + refunded (no cuenta)
    await pay(orderId, total, 'card');
    const ref = await pay(orderId, 10, 'card', { status: 'refunded' });
    expect(ref.status).toBe(201);
    const cur = await api('/api/payments/closing/current', { token: adminToken });
    expect(cur.json.today.total).toBe(before + total);
  });
});

// Helper: monto base del día (para no acoplar tests entre sí)
async function todayTotalBaseline() {
  const cur = await api('/api/payments/closing/current', { token: adminToken });
  return cur.json?.today?.total || 0;
}

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
    // is_paid NO debe quedar en 1 sin pago
    const order = await api(`/api/orders/${orderId}`, { token: meseroToken });
    expect(order.json.order.is_paid).toBe(0);
  });

  it('PATCH status paid con pago parcial → 409; con pago completo → 200', async () => {
    const { orderId, total } = await createOrder();
    const half = Math.round((total / 2) * 100) / 100;

    await pay(orderId, half, 'qr_yape');
    const partial = await api(`/api/orders/${orderId}/status`, {
      method: 'PATCH', token: meseroToken, body: { status: 'paid' },
    });
    expect(partial.status).toBe(409);
    expect(partial.json.code).toBe('PAYMENT_REQUIRED');

    // Completar pago (processPayment marca paid automáticamente)
    await pay(orderId, Math.round((total - half) * 100) / 100, 'qr_yape');
    const full = await api(`/api/orders/${orderId}/status`, {
      method: 'PATCH', token: meseroToken, body: { status: 'paid' },
    });
    expect(full.status).toBe(200);
  });
});

// ═══════════════════════════════════════════════════════════
// C4 — Propina funcional (tip)
// ═══════════════════════════════════════════════════════════

describe('C4 — propina funcional', () => {
  it('split cash+QR con propina: 2 payments, suma(amount+tip) == total, tip en el payment cash', async () => {
    const { orderId, total } = await createOrder();
    const half = Math.round((total / 2) * 100) / 100;
    const rest = Math.round((total - half) * 100) / 100;
    const tip = 5;
    // SEMÁNTICA C4 (documentada): amount + tip <= remaining. La propina va
    // DENTRO del split que la recibe: cash envía amount = rest - tip.
    const qr = await pay(orderId, half, 'qr_yape');
    expect(qr.status).toBe(201);
    expect(qr.json.payment.tip).toBe(0);

    const cash = await pay(orderId, Math.round((rest - tip) * 100) / 100, 'cash', { tip });
    expect(cash.status).toBe(201);
    expect(cash.json.fully_paid).toBe(true);
    expect(cash.json.payment.tip).toBe(tip);

    const order = await api(`/api/orders/${orderId}`, { token: meseroToken });
    expect(order.json.order.status).toBe('paid');
    expect(order.json.order.is_paid).toBe(1);

    const list = await api(`/api/payments?order_id=${orderId}`, { token: meseroToken });
    expect(list.json.payments).toHaveLength(2);
    // La suma de cobros (amount + tip) cubre EXACTAMENTE el total del pedido
    const sum = list.json.payments.reduce((s, p) => s + p.amount + p.tip, 0);
    expect(Math.round(sum * 100) / 100).toBe(total);
    const cashPay = list.json.payments.find(p => p.method === 'cash');
    expect(cashPay.tip).toBe(tip);
  });

  it('pago con propina NO rompe el flujo (regresión: el bug era 409 tras propina)', async () => {
    const { orderId, total } = await createOrder();
    // amount (del pedido) y tip (propina) por separado → suma cuadra
    const amount = Math.round((total - 5) * 100) / 100;
    const r = await pay(orderId, amount, 'cash', { tip: 5 });
    expect(r.status).toBe(201);
    expect(r.json.fully_paid).toBe(true);
    expect(r.json.payment.tip).toBe(5);
  });

  it('retrocompat: pago sin tip funciona igual (tip default 0)', async () => {
    const { orderId, total } = await createOrder();
    const r = await pay(orderId, total, 'card');
    expect(r.status).toBe(201);
    expect(r.json.payment.tip).toBe(0);
    expect(r.json.fully_paid).toBe(true);
  });

  it('rechaza tip negativo (400)', async () => {
    const { orderId, total } = await createOrder();
    const r = await pay(orderId, total, 'cash', { tip: -1 });
    expect(r.status).toBe(400);
    expect(r.json.code).toBe('INVALID_TIP');
  });

  it('rechaza amount+tip que exceda el saldo del pedido (409)', async () => {
    const { orderId, total } = await createOrder();
    // amount total + tip 5 → excede el saldo (amount+tip > remaining)
    const r = await pay(orderId, total, 'cash', { tip: 5 });
    expect(r.status).toBe(409);
    expect(r.json.code).toBe('PAYMENT_CONFLICT');
  });
});

// ═══════════════════════════════════════════════════════════
// C5 — Corte: expected = solo efectivo (cash)
// ═══════════════════════════════════════════════════════════

describe('C5 — expected_cash = solo efectivo', () => {
  it('corte con SOLO pagos QR → el QR NO aporta al expected (solo efectivo cuenta)', async () => {
    // Baseline: efectivo ya registrado hoy por tests anteriores
    const before = await api('/api/payments/closing/current', { token: adminToken });
    const baselineCash = before.json?.today?.cash || 0;

    const { orderId, total } = await createOrder();
    await pay(orderId, total, 'qr_yape');

    const open = await api('/api/payments/closing', { method: 'POST', token: adminToken, body: {} });
    expect(open.status).toBe(201);
    // El pago QR NO suma al efectivo esperado
    expect(open.json.closing.expected).toBe(baselineCash);

    const cur = await api('/api/payments/closing/current', { token: adminToken });
    expect(cur.json.today.cash).toBe(baselineCash);
    expect(cur.json.today.total).toBeGreaterThan(0); // el día sí registra ventas (QR)

    // Cerrar con el efectivo correcto → difference 0 y reconciliado (aunque el cliente mande false)
    const close = await api('/api/payments/closing/close', {
      method: 'PUT', token: adminToken, body: { actual_cash: baselineCash, is_reconciled: false },
    });
    expect(close.status).toBe(200);
    expect(close.json.closing.difference).toBe(0);
    expect(close.json.closing.is_reconciled).toBe(1);
  });

  it('corte mixto: expected = SOLO cash (+baseline); server decide is_reconciled', async () => {
    const before = await api('/api/payments/closing/current', { token: adminToken });
    const baselineCash = before.json?.today?.cash || 0;
    const baselineTotal = before.json?.today?.total || 0;

    // Pedido A pagado con QR (no suma al efectivo), Pedido B con cash
    const oA = await createOrder();
    await pay(oA.orderId, oA.total, 'qr_yape');
    const oB = await createOrder();
    await pay(oB.orderId, oB.total, 'cash');

    const open = await api('/api/payments/closing', { method: 'POST', token: adminToken, body: {} });
    expect(open.status).toBe(201);
    expect(open.json.closing.expected).toBe(Math.round((baselineCash + oB.total) * 100) / 100);

    const cur = await api('/api/payments/closing/current', { token: adminToken });
    expect(cur.json.today.cash).toBe(Math.round((baselineCash + oB.total) * 100) / 100);
    expect(cur.json.today.total).toBe(Math.round((baselineTotal + oA.total + oB.total) * 100) / 100);

    // Cerrar con el efectivo correcto pero cliente manda is_reconciled=false → server decide 1
    const closeOk = await api('/api/payments/closing/close', {
      method: 'PUT', token: adminToken, body: { actual_cash: baselineCash + oB.total, is_reconciled: false },
    });
    expect(closeOk.status).toBe(200);
    expect(closeOk.json.closing.difference).toBe(0);
    expect(closeOk.json.closing.is_reconciled).toBe(1);

    // Nuevo corte; cerrar con efectivo incorrecto pero cliente manda true → server decide 0
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
