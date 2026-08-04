import { chromium } from 'playwright-core';

const exe = 'C:\\Users\\paulo\\AppData\\Local\\ms-playwright\\chromium_headless_shell-1228\\chrome-headless-shell-win64\\chrome-headless-shell.exe';
const base = 'http://localhost:3002';

const browser = await chromium.launch({ executablePath: exe });
const page = await browser.newPage();
const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push(`CONSOLE: ${m.text()}`); });
page.on('pageerror', e => errors.push(`PAGEERROR: ${e.message}\n${e.stack || ''}`));
page.on('requestfailed', r => errors.push(`REQFAILED: ${r.url()} → ${r.failure()?.errorText}`));

// 1. Login admin + generar QR mesa 1 (misma sesión de navegador)
await page.goto(`${base}/admin/`, { waitUntil: 'networkidle' });
for (let i = 0; i < 4; i++) {
  await page.locator('button', { hasText: /^0$/ }).first().click();
  await page.waitForTimeout(120);
}
await page.locator('button', { hasText: /✓/ }).first().click();
await page.waitForTimeout(1500);
await page.locator('button', { hasText: /Mesas/i }).first().click();
await page.waitForTimeout(1200);
await page.locator('button', { hasText: /^QR$/ }).first().click();
await page.waitForTimeout(1200);
const bodyText = await page.locator('body').innerText();
const urlMatch = bodyText.match(/http[s]?:\/\/[^\s\n"']+/);
console.log('URL QR generada:', urlMatch?.[0]);

// 2. Abrir la URL en NUEVA pestaña (simula el cliente)
const page2 = await browser.newPage();
page2.on('console', m => { if (m.type() === 'error') errors.push(`CLIENT CONSOLE: ${m.text()}`); });
page2.on('pageerror', e => errors.push(`CLIENT PAGEERROR: ${e.message}\n${e.stack || ''}`));
page2.on('requestfailed', r => errors.push(`CLIENT REQFAILED: ${r.url()} → ${r.failure()?.errorText}`));

console.log('=== Abriendo URL del QR en nueva pestaña ===');
try {
  await page2.goto(urlMatch?.[0], { waitUntil: 'networkidle', timeout: 15000 });
} catch (e) {
  errors.push(`GOTO: ${e.message}`);
}
await page2.waitForTimeout(3000);

console.log('Título:', await page2.title());
const clientBody = await page2.locator('body').innerText().catch(() => '(sin texto)');
console.log('Body cliente (primeros 500):', clientBody.slice(0, 500));
const content = await page2.content();
console.log('HTML len:', content.length);

await browser.close();
console.log('=== Errores (' + errors.length + ') ===');
for (const e of errors) console.log('---\n' + e);
