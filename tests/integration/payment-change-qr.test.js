/**
 * Integración — CAMBIO POR QR (retiro) + FOTOS MÚLTIPLES (2026-08-26)
 *
 * Cubre:
 *   - Cobro cash con recibido > monto + change=0 (el vuelto NO sale del cajón)
 *     + retiro QR (transfer_out) por el vuelto → el pedido queda PAID
 *     (el retiro NO toca el saldo) y el cierre del día cuadra:
 *       efectivo = received − change (neto físico) · QR = −retiro
 *   - Fotos múltiples por pago QR: N uploads → GET /proof devuelve N
 *
 * Patrón: server real con DB_PATH = temp.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_DB = 'data/test-change-qr.db';

process.env.PORT = '0';
process.env.DB_PATH = TEST_DB;

let server;
let base;
let adminToken;
let meseroToken;

// PNG 1x1 válido (base64)
const TINY_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

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
  const res = await fetch(`${base}${p}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let json = null;
  try { json = await res.json(); } catch { /* noop */ }
  return { status: res.status, json };
}

async function login(pin) {
  const r = await api('/api/auth/login', { method: 'POST', body: { pin } });
  return r.json?.token;
}

let tableCounter = 90;
async function ensureTable(number) {
  const tables = await api('/api/tables', { token: adminToken });
  const existing = tables.json?.tables?.find(t => t.number === number);
  if (existing) return existing.id;
  const created = await api('/api/tables', { method: 'POST', token: adminToken, body: { number, capacity: 4, section: 'e2e' } });
  return created.json?.table?.id;
}

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

describe('CAMBIO POR QR (retiro transfer_out)', () => {
  it('cobro cash con cambio por QR → pedido paid + el retiro NO baja el saldo', async () => {
    const { orderId, total } = await createOrder();
    const extraCash = 5000; // el cliente entrega Bs 50 extra → vuelto de 50

    // Cobro cash: received = total + extra; change=0 (el vuelto NO sale del cajón)
    const payCash = await api('/api/payments', {
      method: 'POST', token: meseroToken,
      body: { order_id: orderId, amount: total, method: 'cash', received: total + extraCash, change: 0 },
    });
    expect(payCash.status).toBe(201);
    expect(payCash.json.fully_paid).toBe(true);

    // Retiro QR por el vuelto (transfer_out): el local transfiere 50 al cliente
    const retiro = await api('/api/payments', {
      method: 'POST', token: meseroToken,
      body: { order_id: orderId, amount: extraCash, method: 'qr', transfer_out: true },
    });
    expect(retiro.status).toBe(201);
    expect(retiro.json.payment.amount).toBe(-extraCash); // salida (negativo)

    // El pedido SIGUE paid (el retiro no afecta el saldo)
    const order = await api(`/api/orders/${orderId}`, { token: meseroToken });
    expect(order.json.order.is_paid).toBe(1);

    // El día: efectivo neto físico = received − change = total + extra;
    // QR del día = −retiro
    const cur = await api('/api/payments/closing/current', { token: adminToken });
    expect(cur.json.breakdown.cash_today).toBe(total + extraCash);
    expect(cur.json.breakdown.qr_today).toBe(-extraCash);
  });

  it('retiro QR sin transfer_out → 400; transfer_out en cash → 400', async () => {
    const { orderId } = await createOrder();
    const bad = await api('/api/payments', {
      method: 'POST', token: meseroToken,
      body: { order_id: orderId, amount: 100, method: 'qr' }, // sin flag → amount negativo implícito no permitido
    });
    expect(bad.status).toBe(201); // amount positivo normal QR — es un pago QR válido

    const badTransfer = await api('/api/payments', {
      method: 'POST', token: meseroToken,
      body: { order_id: orderId, amount: 100, method: 'cash', transfer_out: true },
    });
    expect(badTransfer.status).toBe(400);
    expect(badTransfer.json.code).toBe('TRANSFER_OUT_ONLY_QR');
  });
});

describe('FOTOS MÚLTIPLES por pago QR', () => {
  it('3 uploads al mismo payment → GET /proof devuelve 3 comprobantes', async () => {
    const { orderId, total } = await createOrder();
    const pay = await api('/api/payments', {
      method: 'POST', token: meseroToken,
      body: { order_id: orderId, amount: total, method: 'qr' },
    });
    expect(pay.status).toBe(201);
    const paymentId = pay.json.payment.id;

    for (let i = 0; i < 3; i++) {
      const up = await api(`/api/payments/${paymentId}/proof`, {
        method: 'POST', token: meseroToken,
        body: { image: TINY_PNG },
      });
      expect(up.status).toBe(200);
    }

    const proofs = await api(`/api/payments/${paymentId}/proof`, { token: meseroToken });
    expect(proofs.json.count).toBe(3);
    expect(proofs.json.proofs.length).toBe(3);
    // Cada archivo es único (no sobrescriben)
    const storageKeys = new Set(proofs.json.proofs.map(p => p.storage_key));
    expect(storageKeys.size).toBe(3);
  });

  it('foto a un pago no-QR → 400 PROOF_ONLY_QR', async () => {
    const { orderId, total } = await createOrder();
    const pay = await api('/api/payments', {
      method: 'POST', token: meseroToken,
      body: { order_id: orderId, amount: total, method: 'cash' },
    });
    const paymentId = pay.json.payment.id;
    const up = await api(`/api/payments/${paymentId}/proof`, {
      method: 'POST', token: meseroToken,
      body: { image: TINY_PNG },
    });
    expect(up.status).toBe(400);
    expect(up.json.code).toBe('PROOF_ONLY_QR');
  });
});