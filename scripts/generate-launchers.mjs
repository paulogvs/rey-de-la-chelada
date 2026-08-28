/**
 * generate-launchers.mjs — Genera archivos HTML "launcher" para abrir cada PWA
 * con doble clic, redirigiendo al entorno correcto (localhost / red / tailscale).
 *
 * Los archivos HTML NO cargan la app (una PWA necesita el servidor Express con
 * assets/API/service-worker). Son PUNTOS DE ACCESO: al abrirlos, el navegador
 * redirige a la URL real de la PWA según el entorno.
 *
 * Salida: launchers/
 *   ├── localhost/   → http://localhost:3002/<pwa>/   (misma PC)
 *   ├── red/         → http://192.168.1.2:3002/<pwa>/  (red LAN/WiFi)
 *   └── tailscale/   → http://100.107.134.122:3002/<pwa>/ (acceso remoto)
 *
 * Uso: node scripts/generate-launchers.mjs
 *   Entornos editables abajo (ADDRESS) — si cambia la IP LAN o Tailscale,
 *   edita y vuelve a ejecutar.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'launchers');

// ── Entornos (editar aquí si cambia la red/IP) ──────────────
const ENVIRONMENTS = [
  { id: 'localhost', label: 'Local (esta PC)', base: 'http://localhost:3002' },
  { id: 'red', label: 'Red WiFi (LAN)', base: 'http://192.168.1.2:3002' },
  { id: 'tailscale', label: 'Tailscale (remoto)', base: 'http://100.107.134.122:3002' },
];

// ── PWAs (id = subcarpeta, title = nombre a mostrar) ─────────
const PWAS = [
  { id: 'clientes', title: 'Menú Digital', emoji: '🍺', desc: 'Menú del cliente (público)' },
  { id: 'cocina', title: 'Cocina (KDS)', emoji: '🍳', desc: 'Pantalla de cocina' },
  { id: 'bar', title: 'Bar (KDS)', emoji: '🍹', desc: 'Pantalla de barra' },
  { id: 'meseros', title: 'Meseros', emoji: '🍽️', desc: 'Mesas + pedidos + cobros' },
  { id: 'caja', title: 'Caja', emoji: '💰', desc: 'Corte de caja' },
  { id: 'admin', title: 'Admin', emoji: '⚙️', desc: 'Administración' },
];

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function buildHtml({ base, label, pwa }) {
  const url = `${base}/${pwa.id}/`;
  return `<!DOCTYPE html>
<html lang="es" dir="ltr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(pwa.emoji)} ${esc(pwa.title)} — ${esc(label)}</title>
<meta http-equiv="refresh" content="0; url=${url}">
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    min-height: 100vh; display: grid; place-items: center;
    background: radial-gradient(circle at 50% 20%, #2b2b2b, #121212 70%);
    color: #f5e6c8; text-align: center; padding: 24px;
  }
  .card {
    max-width: 420px; width: 100%; padding: 40px 32px;
    background: rgba(40, 38, 34, 0.9); border: 1px solid #5a4a2e;
    border-radius: 18px; box-shadow: 0 12px 40px rgba(0,0,0,0.6);
  }
  .emoji { font-size: 56px; display: block; margin-bottom: 12px; }
  h1 { font-size: 26px; font-weight: 700; color: #f5e6c8; margin-bottom: 6px; }
  .env { font-size: 13px; text-transform: uppercase; letter-spacing: 0.12em;
         color: #c9a227; margin-bottom: 18px; }
  .desc { color: #b9a98a; font-size: 15px; margin-bottom: 26px; }
  a.btn {
    display: inline-block; background: #c9a227; color: #121212;
    padding: 14px 26px; border-radius: 10px; font-weight: 700; font-size: 16px;
    text-decoration: none; transition: transform .15s, background .15s;
  }
  a.btn:hover { transform: translateY(-2px); background: #dbb63a; }
  .auto { margin-top: 18px; font-size: 13px; color: #8a7a5e; }
  .auto a { color: #c9a227; }
</style>
</head>
<body>
  <div class="card">
    <span class="emoji">${esc(pwa.emoji)}</span>
    <h1>${esc(pwa.title)}</h1>
    <div class="env">${esc(label)}</div>
    <p class="desc">${esc(pwa.desc)}</p>
    <a class="btn" href="${url}">Abrir ${esc(pwa.title)}</a>
    <p class="auto">Redirige automáticamente… <a href="${url}">${esc(url)}</a></p>
  </div>
</body>
</html>`;
}

// ── Generar estructura ──────────────────────────────────────
let created = 0;
fs.mkdirSync(OUT_DIR, { recursive: true });

for (const env of ENVIRONMENTS) {
  const envDir = path.join(OUT_DIR, env.id);
  fs.mkdirSync(envDir, { recursive: true });
  for (const pwa of PWAS) {
    const file = path.join(envDir, `${pwa.id}.html`);
    fs.writeFileSync(file, buildHtml({ base: env.base, label: env.label, pwa }), 'utf-8');
    created++;
  }
}

// Home base con enlaces a los 3 entornos
const home = `<!DOCTYPE html>
<html lang="es" dir="ltr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Rey de la Chelada — Acceso</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    min-height: 100vh; padding: 40px 20px;
    background: radial-gradient(circle at 50% 20%, #2b2b2b, #121212 70%);
    color: #f5e6c8; text-align: center;
  }
  h1 { font-size: 30px; font-weight: 800; color: #f5e6c8; margin-bottom: 4px; }
  .sub { color: #c9a227; font-size: 14px; margin-bottom: 30px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 20px; max-width: 960px; margin: 0 auto; }
  .env {
    background: rgba(40, 38, 34, 0.9); border: 1px solid #5a4a2e; border-radius: 16px;
    padding: 24px; text-align: left;
  }
  .env h2 { font-size: 18px; color: #f5e6c8; margin-bottom: 6px; display: flex; align-items: center; gap: 8px; }
  .env .base { font-size: 12px; color: #8a7a5e; word-break: break-all; margin-bottom: 16px; }
  .env ul { list-style: none; }
  .env li { margin-bottom: 6px; }
  .env a { color: #c9a227; text-decoration: none; font-size: 15px; }
  .env a:hover { text-decoration: underline; }
  .env .muted { font-size: 12px; color: #8a7a5e; }
</style>
</head>
<body>
  <h1>👑 Rey de la Chelada</h1>
  <p class="sub">Elige cómo vas a abrir las apps</p>
  <div class="grid">
${ENVIRONMENTS.map(env => `    <div class="env">
      <h2>${esc(env.label)}</h2>
      <div class="base">${esc(env.base)}</div>
      <ul>
${PWAS.map(pwa => `        <li><a href="${env.base}/${pwa.id}/">${esc(pwa.emoji)} ${esc(pwa.title)}</a></li>`).join('\n')}
      </ul>
    </div>`).join('\n')}
  </div>
</body>
</html>`;
fs.writeFileSync(path.join(OUT_DIR, 'index.html'), home, 'utf-8');

console.log(`✓ Generados ${created} launchers + index.html en: ${OUT_DIR}`);
for (const env of ENVIRONMENTS) {
  console.log(`  • ${env.id}/  → ${env.base}  (${PWAS.length} PWAs)`);
}
