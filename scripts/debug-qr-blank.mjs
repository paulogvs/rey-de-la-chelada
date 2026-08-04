/**
 * Diagnóstico: URL de QR de mesa queda en blanco.
 * Captura errores de consola + excepciones de página.
 */
import { chromium } from 'playwright-core';

const exe = 'C:\\Users\\paulo\\AppData\\Local\\ms-playwright\\chromium_headless_shell-1228\\chrome-headless-shell-win64\\chrome-headless-shell.exe';
const url = process.argv[2] || 'http://localhost:3002/clientes/?mesa=1&sid=sess_1785848410114_3ytu6i89';

const browser = await chromium.launch({ executablePath: exe });
const page = await browser.newPage();

const consoleErrors = [];
page.on('console', msg => {
  if (msg.type() === 'error') consoleErrors.push(msg.text());
});
page.on('pageerror', err => consoleErrors.push(`PAGEERROR: ${err.message}\n${err.stack || ''}`));
page.on('requestfailed', req => consoleErrors.push(`REQFAILED: ${req.url()} → ${req.failure()?.errorText}`));

try {
  await page.goto(url, { waitUntil: 'networkidle', timeout: 15000 });
} catch (e) {
  consoleErrors.push(`GOTO: ${e.message}`);
}
await page.waitForTimeout(3000);

console.log('=== URL: ' + page.url());
console.log('=== Título: ' + await page.title());
const bodyText = (await page.locator('body').innerText().catch(() => '(no text)')).slice(0, 400);
console.log('=== Body text: ' + bodyText);
console.log('=== Errores de consola (' + consoleErrors.length + '):');
for (const e of consoleErrors) console.log('---\n' + e);

await browser.close();
