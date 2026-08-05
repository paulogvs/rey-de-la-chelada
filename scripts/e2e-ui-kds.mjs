/**
 * E2E UI (Playwright) — KDS separado en el navegador real.
 *
 *   node scripts/e2e-ui-kds.mjs
 *
 * Verifica la FASE 1 en UI (no solo API):
 *   1. /bar/ → LoginScreen (keypad numérico) → PIN 2222 → header "Barra"
 *   2. /cocina/ → LoginScreen → PIN 2222 → header "Cocina"
 *   3. /bar/ NO redirige a /cocina/ (el redirect fue eliminado)
 *   4. Pedido mixto creado vía API → KDS bar muestra SOLO bebidas,
 *      KDS cocina muestra SOLO comidas (ambas pantallas a la vez)
 *
 * Requiere: servidor en 3003 (node scripts/run-e2e-server.mjs o manual)
 * Usa el chromium headless shell local.
 */

import { chromium } from 'playwright-core';
import { api, makeReporter, ensureThrowawayTable, getCleanupDb } from './e2e-lib.mjs';
import { tokenFor } from './e2e-session.mjs';

// Fallback: si playwright-core no resuelve desde el root, probar desde
// node_modules de @playwright/test (monorepo npm)
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let chromiumInstance = null;
try {
  chromiumInstance = require('playwright-core')?.chromium;
} catch {
  chromiumInstance = null;
}
const chromiumLib = chromiumInstance || chromium;

const BASE = process.env.E2E_BASE || 'http://localhost:3003';
const CHROME = process.env.CHROME_PATH || 'C:\\Users\\paulo\\AppData\\Local\\ms-playwright\\chromium_headless_shell-1228\\chrome-headless-shell-win64\\chrome-headless-shell.exe';
const reporter = makeReporter('ui-kds');
const TABLE_NUMBER = 90;

async function loginWithKeypad(page, pin) {
  await page.waitForSelector('.login-screen', { timeout: 15000 });
  for (const digit of pin) {
    await page.click(`.login-screen__key:has-text("${digit}")`);
    await page.waitForTimeout(80);
  }
  await page.click('.login-screen__key--ok');
}

async function run() {
  console.log('== E2E UI: KDS separado (bar vs cocina) ==');
  const browser = await chromiumLib.launch({ executablePath: CHROME });

  const adminToken = tokenFor('admin');
  const meseroToken = tokenFor('mesero');

  try {
    // ── 1. KDS BAR: login + header + sin redirect ──
    console.log('1. PWA /bar/ → KDS Barra');
    const barContext = await browser.newContext(); // localStorage limpio
    const barPage = await barContext.newPage();
    await barPage.goto(`${BASE}/bar/`, { waitUntil: 'domcontentloaded' });
    // NO debe redirigir a /cocina/
    await barPage.waitForTimeout(2500); // el antiguo redirect tardaba 1.5s
    const barUrl = barPage.url();
    reporter.assert(!barUrl.includes('/cocina'), `bar NO redirige a cocina (url: ${barUrl})`);

    await loginWithKeypad(barPage, '2222');
    await barPage.waitForSelector('.kds-header__title', { timeout: 20000 });
    const barTitle = await barPage.textContent('.kds-header__title');
    reporter.assert(barTitle.includes('Barra'), `header Barra (${barTitle.trim()})`);
    reporter.assert(!barTitle.includes('Unificado'), 'sin título "Unificado"');

    // ── 2. KDS COCINA: login + header ──
    console.log('2. PWA /cocina/ → KDS Cocina');
    const cocinaContext = await browser.newContext(); // localStorage limpio
    const cocinaPage = await cocinaContext.newPage();
    await cocinaPage.goto(`${BASE}/cocina/`, { waitUntil: 'domcontentloaded' });
    await loginWithKeypad(cocinaPage, '2222');
    await cocinaPage.waitForSelector('.kds-header__title', { timeout: 20000 });
    const cocinaTitle = await cocinaPage.textContent('.kds-header__title');
    reporter.assert(cocinaTitle.includes('Cocina'), `header Cocina (${cocinaTitle.trim()})`);

    // ── 3. Pedido mixto via API (2 bebidas + 1 comida) ──
    console.log('3. Pedido mixto (mesero → API)');
    const table = await ensureThrowawayTable(TABLE_NUMBER, { adminToken });
    const menuRes = await api('/api/menu/items');
    const items = menuRes.json.items.filter(i => i.price != null);
    const barItem = items.find(i => i.area === 'bar');
    const barItem2 = items.find(i => i.area === 'bar' && i.id !== barItem.id);
    const cocinaItem = items.find(i => i.area === 'cocina' || !i.area);

    const create = await api('/api/orders', {
      method: 'POST', token: meseroToken,
      body: {
        table_id: table.id, guest_count: 2,
        items: [
          { menu_item_id: barItem.id, quantity: 1 },
          { menu_item_id: barItem2.id, quantity: 1 },
          { menu_item_id: cocinaItem.id, quantity: 1 },
        ],
      },
    });
    const orderId = create.json.order.id;
    await api(`/api/orders/${orderId}/submit`, { method: 'PATCH', token: meseroToken });
    await api(`/api/orders/${orderId}/confirm`, { method: 'PATCH', token: meseroToken });

    // ── 4. Verificar que ambas pantallas muestran SOLO su área ──
    console.log('4. Verificación visual del aislamiento');
    await barPage.reload({ waitUntil: 'domcontentloaded' });
    // Después de reload, el token persiste (localStorage) → va directo al KDS
    await barPage.waitForSelector('.kds-order, .kds-screen', { timeout: 20000 });
    await barPage.waitForTimeout(1500);

    const barText = (await barPage.textContent('.kds-screen')).toLowerCase();
    reporter.assert(barText.includes(barItem.name.toLowerCase()) || barText.includes('michelada'),
      `bar muestra bebidas (${barItem.name})`);
    reporter.assert(!barText.includes(cocinaItem.name.toLowerCase()),
      `bar NO muestra comida (${cocinaItem.name})`);

    await cocinaPage.reload({ waitUntil: 'domcontentloaded' });
    await cocinaPage.waitForSelector('.kds-order, .kds-screen', { timeout: 20000 });
    await cocinaPage.waitForTimeout(1500);
    const cocinaText = (await cocinaPage.textContent('.kds-screen')).toLowerCase();
    reporter.assert(cocinaText.includes(cocinaItem.name.toLowerCase()),
      `cocina muestra comida (${cocinaItem.name})`);
    reporter.assert(!cocinaText.includes(barItem.name.toLowerCase()),
      `cocina NO muestra bebida (${barItem.name})`);

    // ── 5. Fullscreen button presente (touch target ≥ 48px) ──
    const fsBtn = await barPage.$('.kds-header__audio-btn[title*="Pantalla"]');
    reporter.assert(!!fsBtn, 'botón fullscreen presente');
    if (fsBtn) {
      const box = await fsBtn.boundingBox();
      reporter.assert(box && box.width >= 48 && box.height >= 48,
        `touch target fullscreen ≥48px (${box?.width}x${box?.height})`);
    }

    // ── Limpieza ──
    console.log('5. Limpieza');
    const db = await getCleanupDb();
    db.prepare('DELETE FROM payments WHERE order_id = ?').run(orderId);
    db.prepare('DELETE FROM order_items WHERE order_id = ?').run(orderId);
    db.prepare('DELETE FROM orders WHERE id = ?').run(orderId);
    db.prepare('DELETE FROM client_sessions WHERE table_number = ?').run(TABLE_NUMBER);
    db.prepare('DELETE FROM waiter_calls WHERE table_id = ?').run(table.id);
    db.prepare('DELETE FROM tables WHERE id = ?').run(table.id);

    await barPage.close();
    await barContext.close();
    await cocinaPage.close();
    await cocinaContext.close();
  } finally {
    await browser.close();
  }

  reporter.finish();
}

run().catch(err => {
  console.error('E2E UI crash:', err);
  process.exit(1);
});
