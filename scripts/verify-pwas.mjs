/**
 * ═══════════════════════════════════════════════════════════
 *  verify-pwas.mjs — Multi-PWA build verifier
 *
 *  Verifica que las 6 PWAs cargan correctamente desde el server:
 *   1. Cada PWA responde 200 en su HTML
 *   2. TODOS los assets referenciados en cada index.html responden 200
 *      (incluye shared chunks en /assets/ raíz — el bug de pantalla negra)
 *   3. GET / → 302 redirect a /clientes/
 *
 *  Uso:
 *   node scripts/verify-pwas.mjs [baseUrl]   (default http://localhost:3002)
 *
 *  Exit code 0 = ALL PASS, 1 = any failure (usable en CI)
 *
 *  Artículo I: SSOT — Verificación E2E única para el monolito multi-PWA
 *  Artículo VI: Observabilidad — Fail loud, never silent
 * ═══════════════════════════════════════════════════════════
 */

const BASE = process.argv[2] || 'http://localhost:3002';

const PWA_ROUTES = ['clientes', 'cocina', 'bar', 'meseros', 'caja', 'admin'];

/** Fetch with timeout + status extraction */
async function fetchStatus(url, { redirect = 'manual' } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(url, { redirect, signal: controller.signal });
    return {
      status: res.status,
      location: res.headers.get('location') || null,
      body: res.status === 200 ? await res.text() : null,
    };
  } catch (err) {
    return { status: 0, location: null, body: null, error: err.message };
  } finally {
    clearTimeout(timer);
  }
}

/** Extrae todas las URLs de assets locales (/assets/*, /[pwa]/assets/*) */
function extractAssetUrls(html) {
  const urls = new Set();
  // <script src="/clientes/assets/x.js">
  // <link rel="modulepreload" href="/assets/x.js">
  // <link rel="stylesheet" href="/assets/x.css">
  const re = /(?:src|href)=["'](\/[^"']*\.(?:js|css))["']/g;
  let m;
  while ((m = re.exec(html)) !== null) urls.add(m[1]);
  return [...urls];
}

async function verifyPwa(pwa) {
  const htmlUrl = `${BASE}/${pwa}/`;
  const html = await fetchStatus(htmlUrl);
  if (html.status !== 200) {
    return { pwa, htmlStatus: html.status, assets: [], failures: [`HTML ${html.status} (esperado 200)`], pass: false };
  }

  const assetUrls = extractAssetUrls(html.body);
  const results = [];
  const failures = [];

  for (const asset of assetUrls) {
    const full = asset.startsWith('http') ? asset : `${BASE}${asset}`;
    const r = await fetchStatus(full);
    const ok = r.status === 200;
    results.push({ asset, status: r.status, ok });
    if (!ok) failures.push(`${asset} → ${r.status} (esperado 200)`);
  }

  return {
    pwa,
    htmlStatus: html.status,
    assetCount: results.length,
    assets: results,
    failures,
    pass: failures.length === 0,
  };
}

async function verifyRootRedirect() {
  const r = await fetchStatus(`${BASE}/`);
  const ok = r.status === 302 && r.location && r.location.startsWith('/clientes');
  return { status: r.status, location: r.location, pass: ok };
}

function fmtStatus(n) {
  return n === 200 ? '200 OK' : n === 302 ? '302' : `${n} !!!`;
}

async function main() {
  console.log(`\n🔎  verify-pwas.mjs — base: ${BASE}\n`);
  const pad = n => n.padEnd(10);

  const results = [];
  for (const pwa of PWA_ROUTES) {
    results.push(await verifyPwa(pwa));
  }
  const root = await verifyRootRedirect();

  // ── Tabla por PWA ────────────────────────────────────────
  console.log(`${pad('PWA')}${pad('HTML')}${pad('Assets')}${'Resultado'}`);
  console.log('─'.repeat(58));
  for (const r of results) {
    const status = r.pass ? '✅ PASS' : `❌ FAIL (${r.failures.length})`;
    console.log(`${pad(r.pwa)}${pad(fmtStatus(r.htmlStatus))}${pad(String(r.assetCount))}${status}`);
  }
  const rootStatus = root.pass ? '✅ PASS (302 → /clientes/)' : `❌ FAIL (${root.status} → ${root.location || 'sin Location'})`;
  console.log(`${pad('/')}${pad('—')}${pad('—')}${rootStatus}`);

  // ── Detalle de failures ─────────────────────────────────
  const allFailures = [];
  for (const r of results) {
    if (r.pass) continue;
    console.log(`\n❌ ${r.pwa}/ — ${r.htmlStatus === 200 ? 'HTML ok pero assets rotos:' : 'HTML NO responde 200'}`);
    for (const f of r.failures) console.log(`   ${f}`);
    allFailures.push(...r.failures);
  }

  // ── Resumen de assets por PWA (shared chunks incluidos) ─
  console.log('\n📦  Detalle de assets (shared chunks /assets/* = el fix):');
  for (const r of results) {
    console.log(`\n  ${r.pwa}/ (${r.assetCount} assets):`);
    for (const a of r.assets) {
      const marker = a.asset.startsWith('/assets/') ? '🧩 shared' : '   pwa  ';
      console.log(`    ${marker} ${a.asset} → ${fmtStatus(a.status)}`);
    }
  }

  const totalAssets = results.reduce((s, r) => s + r.assetCount, 0);
  const failedAssets = allFailures.length;
  const failedPwas = results.filter(r => !r.pass).length;
  const allPass = failedPwas === 0 && root.pass;

  console.log('\n' + '═'.repeat(58));
  console.log(`PWAs: ${results.length} | HTML 200: ${results.filter(r => r.htmlStatus === 200).length}/${results.length} | Assets: ${totalAssets - failedAssets}/${totalAssets} OK | Redirect /: ${root.pass ? 'OK' : 'FAIL'}`);
  console.log(allPass
    ? '✅ ALL PASS — pantalla negra resuelta: todos los shared chunks sirven 200\n'
    : `❌ FAILURES: ${failedPwas} PWAs rotas, ${failedAssets} assets 404\n`);

  process.exitCode = allPass ? 0 : 1;
}

main().catch(err => {
  console.error('❌ verify-pwas.mjs error:', err);
  process.exitCode = 1;
});
