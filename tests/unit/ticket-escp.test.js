/**
 * ticket-escp.js — Generador ESC/POS server-side (v14 2026-08-28).
 *
 * Valida: comandos ESC/POS presentes, NIT en header, ancho 58/80mm,
 * QR SIN solo con invoicing+nit, centavos → "Bs. X,XX", corte de papel.
 */

import { describe, it, expect } from 'vitest';
import { buildTicketEscp, buildTestTicketEscp, buildInvoiceEscp } from '../../server/services/ticket-escp.js';

const BASE = {
  business: { name: 'Rey de la Chelada', slogan: 'Slogan', address: 'Av. X', nit: '123456789' },
  taxConfig: { iva: { percentage: 13 } },
  invoicing: { enabled: true },
  paperSize: '80mm',
};

const ORDER = {
  id: 'ord-abc123',
  table_number: 3,
  created_at: '2026-08-28T12:00:00',
  waiter_name: 'Paulo',
  subtotal: 8700,
  iva_amount: 1300,
  discount: 0,
  total: 10000,
  payment_method: 'efectivo',
  items: [
    {
      menu_item_name: 'Cerveza Artesanal',
      quantity: 2,
      unit_price: 4000,
      subtotal: 8000,
      modifiers_json: JSON.stringify([{ groupName: 'Tamaño', optionName: 'Grande', priceAdjustment: 700 }]),
      promo_label: null,
    },
  ],
};

const PAYMENT = { id: 'pay-1', method: 'efectivo', reference: '' };

function toText(bytes) {
  return new TextDecoder().decode(bytes);
}

describe('buildTicketEscp', () => {
  it('inicia con INIT ESC/POS y termina con corte de papel', () => {
    const bytes = buildTicketEscp({ ...BASE, order: ORDER, payment: PAYMENT });
    const text = toText(bytes);
    expect(text.startsWith('\x1b@')).toBe(true);
    expect(text.endsWith('\x1dVB\x00')).toBe(true);
  });

  it('incluye NIT, mesa, pedido, total y pago en centavos formateados', () => {
    const text = toText(buildTicketEscp({ ...BASE, order: ORDER, payment: PAYMENT }));
    expect(text).toContain('NIT: 123456789');
    expect(text).toContain('Mesa: 3');
    expect(text).toContain('Pedido: d-abc123');
    expect(text).toContain('TOTAL:');
    expect(text).toContain('Bs. 100,00');
    expect(text).toContain('Pagado con: efectivo');
    expect(text).toContain('2x Cerveza Artesanal');
    expect(text).toContain('+ Grande (Bs. 7,00)');
  });

  it('genera QR SIN solo cuando invoicing.enabled y hay NIT', () => {
    const withQr = toText(buildTicketEscp({ ...BASE, order: ORDER, payment: PAYMENT }));
    expect(withQr).toContain('Código de verificación SIN:');
    expect(withQr).toContain('\x1d(k'); // comando QR

    const noQr = toText(buildTicketEscp({ ...BASE, invoicing: { enabled: false }, order: ORDER, payment: PAYMENT }));
    expect(noQr).not.toContain('Código de verificación SIN:');

    const noNit = toText(buildTicketEscp({ ...BASE, business: { ...BASE.business, nit: '' }, order: ORDER, payment: PAYMENT }));
    expect(noNit).not.toContain('\x1d(k');
  });

  it('80mm usa 42 chars por línea; 58mm usa 32', () => {
    const dashes80 = toText(buildTicketEscp({ ...BASE, order: ORDER })).split('\n').find(l => l.startsWith('---'));
    const dashes58 = toText(buildTicketEscp({ ...BASE, paperSize: '58mm', order: ORDER })).split('\n').find(l => l.startsWith('---'));
    expect(dashes80.replace(/-/g, '').length).toBe(0); // solo guiones
    expect(dashes80.length).toBe(42);
    expect(dashes58.length).toBe(32);
  });

  it('tolerante a items sin modifiers_json', () => {
    const orderNoMods = {
      ...ORDER,
      items: [{ menu_item_name: 'Jarra', quantity: 1, unit_price: 3000, subtotal: 3000, modifiers_json: null, promo_label: null }],
    };
    const text = toText(buildTicketEscp({ ...BASE, order: orderNoMods }));
    expect(text).toContain('1x Jarra');
    expect(text).toContain('Bs. 30,00');
  });
});

describe('buildTestTicketEscp', () => {
  it('genera ticket de prueba con corte', () => {
    const text = toText(buildTestTicketEscp({ business: BASE.business, paperSize: '80mm' }));
    expect(text).toContain('TEST DE IMPRESIÓN');
    expect(text).toContain('Rey de la Chelada');
    expect(text.endsWith('\x1dVB\x00')).toBe(true);
  });
});

describe('buildInvoiceEscp — FACTURA (v14 2026-08-28)', () => {
  const INVOICE_ORDER = {
    id: 'ord-factura-12345678',
    table_number: 3,
    created_at: '2026-08-28T12:00:00',
    waiter_name: 'Paulo',
    subtotal: 8700,
    iva_amount: 1300,
    discount: 0,
    total: 10000,
    items: [
      { menu_item_name: 'Cerveza Artesanal', quantity: 2, unit_price: 4000, subtotal: 8000, modifiers_json: null, promo_label: null },
      { menu_item_name: 'Michelada Signature', quantity: 1, unit_price: 2000, subtotal: 2000, modifiers_json: '[]', promo_label: 'Promo' },
    ],
  };

  it('incluye FACTURA, NIT del negocio, NIT/Razón del cliente y total', () => {
    const text = toText(buildInvoiceEscp({
      business: BASE.business,
      customer: { nit: '1098765432', name: 'Cliente SRL' },
      order: INVOICE_ORDER,
      paperSize: '80mm',
    }));
    expect(text).toContain('FACTURA');
    expect(text).toContain('NIT: 123456789');       // negocio
    expect(text).toContain('NIT/CI: 1098765432');   // cliente
    expect(text).toContain('Razón Social: Cliente SRL');
    expect(text).toContain('Nº Pedido: 12345678'); // slice(-8) de 'ord-factura-12345678'
    expect(text).toContain('TOTAL:');
    expect(text).toContain('100,00');               // total formateado (sin BS. en factura)
    expect(text).toContain('2x Cerveza Artesanal');
    expect(text).toContain('Michelada Signature (Promo)');
    expect(text.endsWith('\x1dVB\x00')).toBe(true); // corte
  });

  it('termina con corte de papel y tolerante sin cliente', () => {
    const text = toText(buildInvoiceEscp({ business: BASE.business, customer: {}, order: INVOICE_ORDER }));
    expect(text).toContain('NIT/CI: —');
    expect(text).toContain('Razón Social: —');
    expect(text.endsWith('\x1dVB\x00')).toBe(true);
  });
});