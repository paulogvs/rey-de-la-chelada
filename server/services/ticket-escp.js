/**
 * ticket-escp.js — Generador de tickets ESC/POS (server-side).
 *
 * v1 (2026-08-28): implementa la impresión real que el hook cliente
 * usePrinter.ts dejó como stub ("In production: use WebUSB or WebSocket").
 * El server genera los bytes ESC/POS y los envía a la impresora default
 * de Windows (o la configurada) vía printer.js → scripts/print-raw.ps1.
 *
 * SSOT: recibe business/tax/invoicing como parámetros (desde settings o
 * app.config) — NUNCA hardcodea. Ancho de papel 58mm/80mm configurable.
 * Precios SIEMPRE del server (order_items.unit_price/subtotal en centavos).
 */

export const PAPER_SIZES = ['58mm', '80mm'];

// ---------------------------------------------------------------------------
// Comandos ESC/POS (impresora térmica "delgadita" estándar)
// ---------------------------------------------------------------------------
const ESC = '\x1b';
const GS = '\x1d';

const ESCPOS = {
  INIT: `${ESC}@`,
  LINE_FEED: '\x0a',
  CUT: `${GS}V\x42\x00`,
  BOLD_ON: `${ESC}\x45\x01`,
  BOLD_OFF: `${ESC}\x45\x00`,
  DOUBLE_ON: `${ESC}\x21\x10`,
  DOUBLE_OFF: `${ESC}\x21\x00`,
  ALIGN_CENTER: `${ESC}\x61\x01`,
  ALIGN_LEFT: `${ESC}\x61\x00`,
  ALIGN_RIGHT: `${ESC}\x61\x02`,
  FONT_B: `${ESC}\x4d\x01`,
  FONT_A: `${ESC}\x4d\x00`,
  QR_CODE: (data) => {
    const dataLen = data.length + 3;
    const pL = dataLen & 0xff;
    const pH = (dataLen >> 8) & 0xff;
    return (
      GS + '\x28\x6b' + String.fromCharCode(pL) + String.fromCharCode(pH) +
      '\x31\x50\x30' + data +
      GS + '\x28\x6b\x03\x00\x31\x51\x4d'
    );
  },
};

const DEFAULT_CONFIG = {
  business: {
    name: 'Rey de la Chelada',
    slogan: '',
    address: '',
    nit: '',
  },
  taxConfig: { iva: { percentage: 13 } },
  invoicing: { enabled: false },
  paperSize: '80mm',
};

/**
 * Fecha local America/La_Paz determinista (sin dependencias).
 */
function localDateTimeStr(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso || '');
  const parts = new Intl.DateTimeFormat('es-BO', {
    timeZone: 'America/La_Paz',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(d);
  const get = (t) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('day')}/${get('month')}/${get('year')} ${get('hour')}:${get('minute')}`;
}

/**
 * Formatea centavos → "Bs. 12,50" (coma decimal, sin dependencias).
 */
function formatBs(cents) {
  const v = (Number(cents) || 0) / 100;
  return `Bs. ${v.toFixed(2).replace('.', ',')}`;
}

/**
 * Genera los bytes ESC/POS de un ticket de pedido.
 *
 * @param {object} opts
 * @param {object} opts.business        { name, slogan, address, nit }
 * @param {object} opts.taxConfig       { iva: { percentage } }
 * @param {object} opts.invoicing       { enabled }
 * @param {string} [opts.paperSize]     '58mm' | '80mm' (default '80mm')
 * @param {object} order                Shape de buildOrder(): id, table_number,
 *   created_at, waiter_name, subtotal, iva_amount, discount, total,
 *   payment_method, items[{ menu_item_name, quantity, unit_price,
 *   modifiers_json, subtotal, promo_label }]
 * @param {object} [payment]            { id, method, reference }
 * @returns {Uint8Array} bytes ESC/POS listos para imprimir
 */
export function buildTicketEscp(opts) {
  const cfg = { ...DEFAULT_CONFIG, ...opts };
  const cpl = cfg.paperSize === '58mm' ? 32 : 42;
  const { business, taxConfig, invoicing } = cfg;
  const order = cfg.order;
  const payment = cfg.payment || null;

  const repeat = (ch, n) => ch.repeat(Math.max(0, n));
  const center = (text) => repeat(' ', Math.max(0, Math.floor((cpl - text.length) / 2))) + text;
  const right = (label, value) => {
    const content = `${label} ${value}`;
    if (content.length >= cpl) return content;
    return label + repeat(' ', cpl - label.length - value.length) + value;
  };
  const line = () => repeat('-', cpl) + '\n';

  const items = Array.isArray(order.items) ? order.items : [];

  let t = ESCPOS.INIT;

  // ── Header ────────────────────────────────────────────────
  t += ESCPOS.ALIGN_CENTER;
  t += ESCPOS.DOUBLE_ON;
  t += center(business.name || 'Rey de la Chelada') + '\n';
  t += ESCPOS.DOUBLE_OFF;
  if (business.slogan) t += business.slogan + '\n';
  if (business.address) t += business.address + '\n';
  if (business.nit) t += `NIT: ${business.nit}\n`;
  t += line();

  // ── Info pedido ───────────────────────────────────────────
  t += ESCPOS.ALIGN_LEFT;
  t += ESCPOS.BOLD_ON;
  t += `Mesa: ${order.table_number ?? '-'}      Pedido: ${String(order.id || '').slice(-8)}\n`;
  t += `Fecha: ${localDateTimeStr(order.created_at)}\n`;
  if (order.waiter_name) t += `Mesero: ${order.waiter_name}\n`;
  t += ESCPOS.BOLD_OFF;
  t += line();

  // ── Items ─────────────────────────────────────────────────
  for (const item of items) {
    const name = item.promo_label ? `${item.menu_item_name} (${item.promo_label})` : item.menu_item_name;
    t += `${item.quantity}x ${name}\n`;
    let modifiers;
    try {
      modifiers = JSON.parse(item.modifiers_json || '[]');
    } catch {
      modifiers = [];
    }
    for (const mod of modifiers) {
      t += ESCPOS.FONT_B;
      t += `   + ${mod.optionName}`;
      if (Number(mod.priceAdjustment || 0) > 0) {
        t += ` (${formatBs(mod.priceAdjustment)})`;
      }
      t += '\n';
      t += ESCPOS.FONT_A;
    }
    t += right('', formatBs(item.subtotal)) + '\n';
  }

  t += line();

  // ── Totales ───────────────────────────────────────────────
  t += right('Subtotal:', formatBs(order.subtotal)) + '\n';
  t += right(`IVA ${taxConfig.iva.percentage}%:`, formatBs(order.iva_amount)) + '\n';
  if (Number(order.discount || 0) > 0) {
    t += right('Descuento:', `-${formatBs(order.discount)}`) + '\n';
  }
  t += ESCPOS.DOUBLE_ON;
  t += right('TOTAL:', formatBs(order.total)) + '\n';
  t += ESCPOS.DOUBLE_OFF;
  t += line();

  // ── Pago ──────────────────────────────────────────────────
  if (payment && payment.method) {
    t += ESCPOS.ALIGN_CENTER;
    t += `Pagado con: ${payment.method}\n`;
    if (payment.reference) t += `Ref: ${payment.reference}\n`;
    t += ESCPOS.ALIGN_LEFT;
  }

  // ── QR SIN ────────────────────────────────────────────────
  if (payment && invoicing.enabled && business.nit) {
    t += '\n';
    t += ESCPOS.ALIGN_CENTER;
    t += ESCPOS.FONT_B;
    t += 'Código de verificación SIN:\n';
    t += ESCPOS.QR_CODE(`factura|${business.nit}|${order.total}|${payment.id}`);
    t += '\n';
    t += ESCPOS.FONT_A;
  }

  // ── Footer ────────────────────────────────────────────────
  t += ESCPOS.ALIGN_CENTER;
  t += '\n';
  t += center('¡Gracias por su visita!') + '\n';
  t += center('Rey de la Chelada') + '\n';
  t += center('Cochabamba, Bolivia') + '\n';
  t += '\n';
  t += center('Built with FORCH.i') + '\n';
  t += '\n';

  // Corte de papel
  t += ESCPOS.CUT;

  return new TextEncoder().encode(t);
}

/**
 * Ticket de prueba (para "Probar impresión" en Configuración).
 */
export function buildTestTicketEscp({ business = {}, paperSize = '80mm' } = {}) {
  const cpl = paperSize === '58mm' ? 32 : 42;
  const repeat = (ch, n) => ch.repeat(Math.max(0, n));
  const center = (text) => repeat(' ', Math.max(0, Math.floor((cpl - text.length) / 2))) + text;

  let t = ESCPOS.INIT;
  t += ESCPOS.ALIGN_CENTER;
  t += ESCPOS.DOUBLE_ON;
  t += center(business.name || 'Rey de la Chelada') + '\n';
  t += ESCPOS.DOUBLE_OFF;
  t += '\n';
  t += 'TEST DE IMPRESIÓN\n';
  t += '\n';
  t += 'Si ves esto, la impresora\n';
  t += 'funciona correctamente.\n';
  t += '\n';
  t += center('Built with FORCH.i') + '\n';
  t += '\n';
  t += ESCPOS.CUT;
  return new TextEncoder().encode(t);
}

export default { buildTicketEscp, buildTestTicketEscp, PAPER_SIZES };