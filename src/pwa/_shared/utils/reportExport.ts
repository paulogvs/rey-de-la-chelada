/**
 * reportExport — Generación de reporte HTML imprimible (→ PDF) + texto WhatsApp.
 *
 * @forchi — Rey de la Chelada
 *
 * Genera un HTML autocontenido (con CSS inline, estética dorado/oscuro de la app)
 * que se puede "Guardar como PDF" desde el navegador (Ctrl+P → Guardar como PDF),
 * y un resumen en texto plano listo para pegar en WhatsApp.
 *
 * Funciones puras, sin dependencias externas. Reciben montos en CENTAVOS.
 */

import { formatMoney } from './format';

// ============================================================
// Tipos de entrada (minimales, desacoplados del API)
// ============================================================

export interface ReportClosing {
  closing_date: string;
  opened_at: string;
  closed_at?: string | null;
  closed_by_name?: string | null;
  opening_cash?: number | null;
  expected_cash: number;
  actual_cash: number;
  expected_qr?: number | null;
  expenses_cash?: number | null;
  expenses_qr?: number | null;
  transactions?: number | null;
  total_general?: number | null;
  cash_difference: number;
  notes?: string | null;
}

export interface ReportDaily {
  totalOrders: number;
  completedOrders: number;
  cancelledOrders: number;
  grossRevenue: number;
  totalSales: number;
  totalIva: number;
  baseRevenue: number;
  averageTicket: number;
  byMethod: Record<string, number>;
  hourly?: { hour: number; orders: number; revenue: number }[];
}

export interface ReportPopularItem {
  item_name: string;
  category_name?: string | null;
  times_ordered: number;
  total_quantity: number;
  total_revenue: number;
}

export interface ReportSource {
  closing: ReportClosing | null;
  daily: ReportDaily | null;
  popularQty: ReportPopularItem[];
  popularRevenue: ReportPopularItem[];
  businessName?: string;
  nit?: string;
}

// ============================================================
// Helpers
// ============================================================

const METHOD_LABELS: Record<string, string> = {
  cash: 'Efectivo',
  qr: 'QR',
};

/** Date ISO → fecha legible es-ES (dd/mm/aaaa). */
function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('es-BO', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

/** Date ISO → fecha + hora legible. */
function fmtDateTime(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('es-BO', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function row(label: string, value: string, opts: { total?: boolean; className?: string } = {}): string {
  return `<tr class="${opts.total ? 'fila--total' : ''} ${opts.className || ''}"><td>${label}</td><td class="val">${value}</td></tr>`;
}

/** Barra de progreso (CSS-only) para el top de productos. */
function bars(items: ReportPopularItem[], field: 'total_quantity' | 'total_revenue', money = false): string {
  if (!items.length) return '<p class="muted">Sin datos de ventas del día.</p>';
  const max = Math.max(...items.map(i => i[field]), 1);
  const rows = items.map((it, i) => {
    const v = it[field];
    const pct = Math.max(4, Math.round((v / max) * 100));
    const disp = money ? formatMoney(v) : String(v);
    return `
      <div class="top-item">
        <div class="top-item__head"><span>${i + 1}. ${it.item_name} <em>${it.category_name || ''}</em></span><b>${disp}</b></div>
        <div class="top-item__track"><span class="top-item__fill" style="width:${pct}%"></span></div>
      </div>`;
  });
  return `<div class="top-list">${rows.join('')}</div>`;
}

// ============================================================
// HTML imprimible
// ============================================================

export function buildReportHtml(src: ReportSource): string {
  const c = src.closing;
  const d = src.daily;

  const header = `
    <header class="head">
      <div class="brand">🍻 ${src.businessName || 'Rey de la Chelada'}</div>
      ${src.nit ? `<div class="muted">NIT: ${src.nit}</div>` : ''}
      <div class="muted">Reporte del día laboral · <b>${c ? fmtDate(c.closing_date) : '—'}</b></div>
    </header>`;

  // ── Cierre ──
  let closeBlock = '<div class="card"><h2>🔒 Cierre del día</h2>';
  if (c) {
    closeBlock += `
      <table>
        ${row('Apertura', fmtDateTime(c.opened_at))}
        ${row('Cierre', fmtDateTime(c.closed_at))}
        ${c.closed_by_name ? row('Cerrado por', c.closed_by_name) : ''}
        ${row('Nº transacciones', String(c.transactions ?? 0))}
        ${row('Efectivo inicial', formatMoney(c.opening_cash ?? 0))}
        ${row('Efectivo ingresado', formatMoney((c.expected_cash - (c.opening_cash ?? 0)) + (c.expenses_cash ?? 0)))}
        ${row('QR ingresado', formatMoney((c.expected_qr ?? 0) + (c.expenses_qr ?? 0)))}
        ${row('TOTAL GENERAL', formatMoney(c.total_general ?? 0), { total: true })}
        ${row('Gastos / retiros EFECTIVO', formatMoney(c.expenses_cash ?? 0))}
        ${row('Gastos / retiros QR', formatMoney(c.expenses_qr ?? 0))}
        ${row('Efectivo esperado', formatMoney(c.expected_cash))}
        ${row('Efectivo contado', formatMoney(c.actual_cash))}
        ${row('QR esperado', formatMoney(c.expected_qr ?? 0))}
        ${row('Diferencia', (c.cash_difference >= 0 ? '+' : '') + formatMoney(c.cash_difference), { className: c.cash_difference >= 0 ? 'positive' : 'negative' })}
        ${c.notes ? row('Notas', c.notes) : ''}
      </table>`;
  } else {
    closeBlock += '<p class="muted">No hay cierre registrado para este día.</p>';
  }
  closeBlock += '</div>';

  // ── Pedidos / Ventas ──
  let salesBlock = '<div class="card"><h2>🧾 Pedidos y ventas del día</h2>';
  if (d) {
    const byMethod = Object.entries(d.byMethod || {})
      .map(([k, v]) => row(METHOD_LABELS[k] || k, formatMoney(v)))
      .join('');
    salesBlock += `
      <table>
        ${row('Pedidos totales', String(d.totalOrders))}
        ${row('Pedidos pagados', String(d.completedOrders))}
        ${row('Pedidos cancelados', String(d.cancelledOrders))}
        ${row('Venta bruta', formatMoney(d.grossRevenue))}
        ${row('Venta neta', formatMoney(d.totalSales), { total: true })}
        ${row('IVA', formatMoney(d.totalIva))}
        ${row('Base imponible', formatMoney(d.baseRevenue))}
        ${row('Ticket promedio', formatMoney(d.averageTicket))}
        ${byMethod}
      </table>`;
  } else {
    salesBlock += '<p class="muted">Sin ventas del día.</p>';
  }
  salesBlock += '</div>';

  // ── Top ventas ──
  const topBlock = `
    <div class="card"><h2>🏆 Lo más vendido del día</h2>
      <h3>Por cantidad</h3>
      ${bars(src.popularQty, 'total_quantity')}
      <h3>Por monto</h3>
      ${bars(src.popularRevenue, 'total_revenue', true)}
    </div>`;

  const footer = `
    <footer class="foot">
      <div>Generado por <b>Rey de la Chelada</b> · FORCH.iA</div>
      <div class="muted">Para guardar como PDF: Ctrl+P (CMD+P en Mac) → Destino "Guardar como PDF".</div>
    </footer>`;

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Reporte cierre · ${c ? fmtDate(c.closing_date) : ''}</title>
<style>
  :root { --dorado:#c9a227; --oscuro:#111; --panel:#181818; --borde:#2c2c2c; --texto:#f4f0e6; --muted:#a89f8f; --pos:#2fbf71; --neg:#e05252; }
  * { box-sizing:border-box; }
  body { margin:0; font-family:'Segoe UI',system-ui,Roboto,Helvetica,Arial,sans-serif; background:var(--oscuro); color:var(--texto); padding:24px; }
  .head { border-bottom:2px solid var(--dorado); padding-bottom:12px; margin-bottom:20px; }
  .brand { font-size:26px; font-weight:800; letter-spacing:.5px; }
  .muted { color:var(--muted); font-size:12px; }
  .card { background:var(--panel); border:1px solid var(--borde); border-top:2px solid var(--dorado); border-radius:10px; padding:16px 20px; margin-bottom:18px; }
  h2 { font-size:17px; margin:0 0 12px; border-bottom:1px solid var(--borde); padding-bottom:8px; }
  h3 { font-size:13px; color:var(--dorado); margin:16px 0 8px; text-transform:uppercase; letter-spacing:.5px; }
  table { width:100%; border-collapse:collapse; }
  td { padding:8px 6px; border-bottom:1px solid var(--borde); font-size:14px; }
  td.val { text-align:right; font-variant-numeric:tabular-nums; font-weight:600; }
  tr.fila--total td { font-size:16px; font-weight:800; color:var(--dorado); border-top:2px solid var(--dorado); }
  .positive { color:var(--pos); } .negative { color:var(--neg); }
  .top-list { display:flex; flex-direction:column; gap:10px; }
  .top-item__head { display:flex; justify-content:space-between; gap:8px; font-size:14px; margin-bottom:4px; }
  .top-item__head em { color:var(--muted); font-style:italic; font-size:12px; }
  .top-item__track { height:10px; background:var(--borde); border-radius:99px; overflow:hidden; }
  .top-item__fill { display:block; height:100%; background:linear-gradient(90deg,var(--dorado),#e6c14d); border-radius:99px; }
  .foot { border-top:1px solid var(--borde); padding-top:12px; margin-top:20px; text-align:center; font-size:12px; }
  @media print { body { background:#fff; color:#000; } .card { background:#fff; border-color:#ccc; } .muted,.top-item__head em{color:#555;} }
</style>
</head>
<body>
${header}
${closeBlock}
${salesBlock}
${topBlock}
${footer}
<script>window.onload=function(){setTimeout(function(){window.print();},300);};</script>
</body>
</html>`;
}

// ============================================================
// Texto para WhatsApp
// ============================================================

export function buildWhatsAppText(src: ReportSource): string {
  const c = src.closing;
  const d = src.daily;
  const line = '────────────────────';

  const lines: string[] = [];
  lines.push(`🍻 *Reporte del día* · ${c ? fmtDate(c.closing_date) : '—'}`);
  lines.push(line);

  if (c) {
    lines.push(`💰 *Cierre:* ${formatMoney(c.total_general ?? 0)}`);
    lines.push(`🧾 Transacciones: ${c.transactions ?? 0}`);
    lines.push(`💵 Efectivo esperado: ${formatMoney(c.expected_cash)}`);
    lines.push(`💵 Efectivo contado: ${formatMoney(c.actual_cash)}`);
    const diff = c.cash_difference;
    lines.push(`${diff >= 0 ? '✅' : '⚠️'} Diferencia: ${(diff >= 0 ? '+' : '') + formatMoney(diff)}`);
  }

  if (d) {
    lines.push(line);
    lines.push(`📦 Pedidos: ${d.totalOrders} (pagados ${d.completedOrders}, cancelados ${d.cancelledOrders})`);
    lines.push(`💵 Venta neta: ${formatMoney(d.totalSales)}`);
    lines.push(`🎫 Ticket promedio: ${formatMoney(d.averageTicket)}`);
  }

  const top = src.popularQty.slice(0, 3);
  if (top.length) {
    lines.push(line);
    lines.push('🏆 *Más vendido:*');
    top.forEach((t, i) => lines.push(`${i + 1}. ${t.item_name} — ${t.total_quantity} uds`));
  }

  lines.push(line);
  lines.push('_Generado por Rey de la Chelada · FORCH.iA_');
  return lines.join('\n');
}

// ============================================================
// Descarga de HTML
// ============================================================

export function downloadReportHtml(filename: string, html: string): void {
  const blob = new Blob([html], { type: 'text/html;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export default { buildReportHtml, buildWhatsAppText, downloadReportHtml };
