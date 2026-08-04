/**
 * E2E — Flujo QR server-side (fix "pantalla en blanco / sesión no encontrada")
 *
 * QR ESTÁTICO (Opción A): el QR codifica SOLO `{base}/clientes?mesa=N`
 * (sin sid). El cliente crea la sesión LAZY al abrir la URL.
 *
 * Pasos:
 *  1. Login admin (PIN 0000, teclado numérico) → Mesas → QR mesa 1
 *  2. El modal pide la URL estática a POST /api/client-sessions/table/:mesa
 *  3. Extraer la URL del modal
 *  4. Abrir la URL en un NUEVO CONTEXTO (simula el CELULAR del cliente,
 *     sin cookies del admin) → la sesión se crea lazy contra el SERVIDOR
 *  5. Verificar que el menú carga SIN "Sesión no encontrada"
 *
 * Antes del fix: el paso 4 fallaba siempre porque la sesión vivía en un Map
 * del navegador del admin.
 */

import { chromium } from 'playwright-core';

const exe = 'C:\\Users\\paulo\\AppData\\Local\\ms-playwright\\chromium_headless_shell-1228\\chrome-headless-shell-win64\\chrome-headless-shell.exe';
const base = 'http://localhost:3003';

const browser = await chromium.launch({ executablePath: exe });
const errors = [];
const log = (s) => console.log(s);

function watchPage(page, tag) {
  page.on('console', m => { if (m.type() === 'error') errors.push(`${tag} CONSOLE: ${m.text()}`); });
  page.on('pageerror', e => errors.push(`${tag} PAGEERROR: ${e.message}`));
  page.on('requestfailed', r => errors.push(`${tag} REQFAILED: ${r.url()} → ${r.failure()?.errorText}`));
}

// ── 1. Login admin → Mesas → QR ───────────────────────────────
const adminCtx = await browser.newContext();
const admin = await adminCtx.newPage();
watchPage(admin, 'ADMIN');

log('1. Abriendo /admin/ …');
await admin.goto(`${base}/admin/`, { waitUntil: 'networkidle' });

log('2. Ingresando PIN 0000 …');
for (let i = 0; i < 4; i++) {
  await admin.locator('button', { hasText: /^0$/ }).first().click();
  await admin.waitForTimeout(120);
}
await admin.locator('button', { hasText: /✓/ }).first().click();
await admin.waitForTimeout(1500);

log('3. Navegando a Mesas …');
await admin.locator('button', { hasText: /Mesas/i }).first().click();
await admin.waitForTimeout(1200);

log('4. Click en QR de la primera mesa …');
await admin.locator('button', { hasText: /^QR$/ }).first().click();

// El modal ahora pide la URL al servidor (async) — esperar el texto de URL
let qrUrl = null;
for (let i = 0; i < 20 && !qrUrl; i++) {
  await admin.waitForTimeout(300);
  const body = await admin.locator('body').innerText().catch(() => '');
  const match = body.match(/http[s]?:\/\/[^\s\n"']+/);
  if (match) qrUrl = match[0];
}
log(`5. URL QR obtenida del modal: ${qrUrl}`);
if (!qrUrl) { errors.push('No se encontró URL en el modal QR'); }

// ── 4. Abrir la URL en NUEVO CONTEXTO (cliente = otro dispositivo) ──
const clientCtx = await browser.newContext(); // sin cookies compartidas
const client = await clientCtx.newPage();
watchPage(client, 'CLIENT');

log('6. Abriendo URL del QR en contexto NUEVO (simula celular) …');
try {
  await client.goto(qrUrl, { waitUntil: 'networkidle', timeout: 15000 });
} catch (e) {
  errors.push(`GOTO: ${e.message}`);
}
await client.waitForTimeout(3500);

const clientBody = await client.locator('body').innerText().catch(() => '(sin texto)');
log('7. Body del cliente (primeros 600):');
log('---');
log(clientBody.slice(0, 600));
log('---');

// ── Verificación ──────────────────────────────────────────────
const failed = clientBody.includes('Sesión no encontrada') || clientBody.includes('QR no válido o expirado');
const hasMenu = clientBody.includes('Micheladas') || clientBody.includes('Bs') || clientBody.includes('Agregar');
const hasSessionError = clientBody.includes('Error al validar la sesión');

log('');
log('═══ RESULTADO E2E ═══');
log(`URL válida en modal:      ${!!qrUrl}`);
log(`Menú renderizado:         ${hasMenu}`);
log(`Error de sesión en UI:    ${failed}`);
log(`Error de red/validación:  ${hasSessionError}`);
log(`Errores consola/red:      ${errors.length}`);

const pass = !!qrUrl && hasMenu && !failed && !hasSessionError && errors.length === 0;
log(`\n${pass ? '✅ E2E QR PASS — sesión server-side funcionando entre dispositivos' : '❌ E2E QR FAIL — revisar errores'}`);

for (const e of errors) log('---\n' + e);

await browser.close();
process.exit(pass ? 0 : 1);
