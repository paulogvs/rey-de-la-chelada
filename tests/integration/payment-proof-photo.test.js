/**
 * Integración — Comprobante foto de pago QR (FASE 5)
 *
 * POST /api/payments/:id/proof — sube el comprobante en base64:
 *   - SOLO aplica a method='qr' (efectivo NO necesita foto)
 *   - Guarda en data/payment-proofs/{paymentId}.{ext} y enlaza
 *     vía payments.proof_photo
 *   - Validaciones: imagen inválida, MIME no soportado, >8MB
 *
 * Patrón: server real con DB_PATH = temp (NO toca data/rey-de-la-chelada.db).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_DB = 'data/test-proof-photo.db';

process.env.PORT = '0';
process.env.DB_PATH = TEST_DB;

let server;
let base;
let adminToken;
let paymentId;
let orderId;

// Un PNG 1x1 válido en base64
const TINY_PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

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

  // Crear un pedido y pagarlo con QR para tener un payment real
  const order = await createOrder(adminToken);
  orderId = order.id;
  const payRes = await fetch(`${base}/api/payments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ order_id: order.id, amount: order.total, method: 'qr' }),
  });
  expect(payRes.status).toBe(201);
  const payBody = await payRes.json();
  paymentId = payBody.payment.id;
});

afterAll(async () => {
  await new Promise(resolve => server.close(resolve));
  const { closeDb } = await import('../../server/db/index.js');
  closeDb();
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(path.resolve(__dirname, '..', '..', TEST_DB + suffix)); } catch { /* noop */ }
  }
  // Limpiar comprobantes creados en el test
  try { fs.rmSync(path.resolve(__dirname, '..', '..', 'data', 'payment-proofs', `${paymentId}.png`), { force: true }); } catch { /* noop */ }
});

async function login(pin) {
  const res = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin }),
  });
  const body = await res.json();
  return body.token;
}

async function createOrder(token) {
  // Crear mesa temporal + 1 item bar del menú
  const tableNum = Math.floor(Math.random() * 40) + 100;
  const tablesRes = await fetch(`${base}/api/tables`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ number: tableNum, capacity: 4, section: 'proof-test' }),
  });
  const tablesBody = await tablesRes.json();
  const tableId = tablesBody.table?.id;

  const menu = await (await fetch(`${base}/api/menu/items`)).json();
  const item = menu.items?.find(i => i.price != null && i.area === 'bar');
  const res = await fetch(`${base}/api/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      table_id: tableId,
      items: [{ menu_item_id: item.id, quantity: 1 }],
    }),
  });
  const body = await res.json();
  expect(res.status).toBe(201);
  return body.order;
}

describe('POST /api/payments/:id/proof — comprobante foto QR', () => {
  it('sube un comprobante válido (base64 png) y enlaza proof_photo', async () => {
    const res = await fetch(`${base}/api/payments/${paymentId}/proof`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ image: `data:image/png;base64,${TINY_PNG_B64}` }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.proof_photo).toMatch(/^\/payment-proofs\/.+\.png$/);

    // Verificar que la DB guardó la ruta
    const { getDb } = await import('../../server/db/index.js');
    const payment = getDb().prepare('SELECT proof_photo FROM payments WHERE id = ?').get(paymentId);
    expect(payment.proof_photo).toBe(body.proof_photo);

    // Verificar que el archivo existe en disco
    const absPath = path.resolve(__dirname, '..', '..', 'data', 'payment-proofs', `${paymentId}.png`);
    expect(fs.existsSync(absPath)).toBe(true);
  });

  it('rechaza imagen sin data URL', async () => {
    const res = await fetch(`${base}/api/payments/${paymentId}/proof`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ image: 'not-base64' }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('INVALID_PROOF_IMAGE');
  });

  it('rechaza imagen de pago inexistente', async () => {
    const res = await fetch(`${base}/api/payments/no-existe/proof`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ image: `data:image/png;base64,${TINY_PNG_B64}` }),
    });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.code).toBe('PAYMENT_NOT_FOUND');
  });

  it('requiere rol admin/mesero/caja', async () => {
    // Login como kds (PIN 2222) — NO tiene permiso
    const kdsToken = await login('2222');
    const res = await fetch(`${base}/api/payments/${paymentId}/proof`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${kdsToken}` },
      body: JSON.stringify({ image: `data:image/png;base64,${TINY_PNG_B64}` }),
    });
    expect(res.status).toBe(403);
  });
});
