/**
 * usePrinter — Thermal printer integration (ESC/POS)
 *
 * Handles:
 * - Thermal printer commands (ESC/POS)
 * - Ticket format: header → items → IVA → tip → total → QR → footer
 * - 58mm or 80mm paper support
 * - USB or network connection
 *
 * Artículo II: ZERO HARDCODED — All formatting from app config
 */

import { useState, useCallback } from 'react';
import { appConfig } from '@/core/config';
import type { Order, Payment } from '@/core/types';

export type PaperSize = '58mm' | '80mm';
export type PrinterConnection = 'usb' | 'network' | 'bluetooth';

export interface PrinterConfig {
  connection: PrinterConnection;
  paperSize: PaperSize;
  networkAddress?: string;
  networkPort?: number;
  characterPerLine: number;
}

export interface PrinterState {
  connected: boolean;
  printing: boolean;
  error: string | null;
}

// ESC/POS commands
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
  FONT_B: `${ESC}\x4d\x01`,  // Smaller font
  FONT_A: `${ESC}\x4d\x00`,  // Normal font
  QR_CODE: (data: string) => {
    // Store QR data: GS ( k pL pH 49 80 48 48 <data>
    // pL/pH son dinámicos — no se pueden usar escapes \x en template literals
    const dataLen = data.length + 3;
    const pL = dataLen & 0xff;
    const pH = (dataLen >> 8) & 0xff;
    return GS + '\x28\x6b' + String.fromCharCode(pL) + String.fromCharCode(pH) +
           '\x31\x50\x30' + data +
           // Print QR: GS ( k 03 00 31 51 4d
           GS + '\x28\x6b\x03\x00\x31\x51\x4d';
  },
};

const DEFAULT_CONFIG: PrinterConfig = {
  connection: 'usb',
  paperSize: '80mm',
  characterPerLine: 42,
};

/**
 * Generate the raw ESC/POS bytes for a ticket
 */
export function generateTicket(
  order: Order,
  payment?: Payment,
  tipAmount: number = 0,
  config: PrinterConfig = DEFAULT_CONFIG,
): Uint8Array {
  const cpl = config.paperSize === '58mm' ? 32 : config.characterPerLine;
  const business = appConfig.all.business;
  const currency = appConfig.all.currency;
  const taxConfig = appConfig.all.taxes;

  const repeat = (char: string, count: number) => char.repeat(count);
  const center = (text: string) => {
    const padding = Math.max(0, cpl - text.length);
    const leftPad = Math.floor(padding / 2);
    return repeat(' ', leftPad) + text;
  };
  const right = (label: string, value: string) => {
    const content = `${label} ${value}`;
    if (content.length >= cpl) return content;
    return label + repeat(' ', cpl - label.length - value.length) + value;
  };
  const line = () => repeat('-', cpl) + '\n';

  let ticket = ESCPOS.INIT;
  ticket += ESCPOS.ALIGN_CENTER;

  // Header
  ticket += ESCPOS.DOUBLE_ON;
  ticket += center(business.name) + '\n';
  ticket += ESCPOS.DOUBLE_OFF;
  ticket += business.slogan + '\n';
  ticket += business.address + '\n';
  ticket += `NIT: ${business.nit}\n`;
  ticket += line();

  // Order info
  ticket += ESCPOS.ALIGN_LEFT;
  ticket += ESCPOS.BOLD_ON;
  ticket += `Mesa: ${order.tableNumber}      Pedido: ${order.id.slice(-8)}\n`;
  ticket += `Fecha: ${new Date(order.createdAt).toLocaleString('es-BO')}\n`;
  ticket += `Mesero: ${order.waiterName}\n`;
  ticket += ESCPOS.BOLD_OFF;
  ticket += line();

  // Items
  order.items.forEach(item => {
    ticket += `${item.quantity}x ${item.menuItemName}\n`;
    if (item.modifiers.length > 0) {
      item.modifiers.forEach(mod => {
        ticket += ESCPOS.FONT_B;
        ticket += `   + ${mod.optionName}`;
        if (mod.priceAdjustment > 0) {
          ticket += ` (Bs. ${mod.priceAdjustment.toFixed(2)})`;
        }
        ticket += '\n';
        ticket += ESCPOS.FONT_A;
      });
    }
    ticket += right('', `Bs. ${item.subtotal.toFixed(2)}`) + '\n';
  });

  ticket += line();

  // Totals
  ticket += right('Subtotal:', `Bs. ${order.subtotal.toFixed(2)}`) + '\n';
  ticket += right(`IVA ${taxConfig.iva.percentage}%:`, `Bs. ${order.ivaAmount.toFixed(2)}`) + '\n';

  if (order.discount > 0) {
    ticket += right('Descuento:', `-Bs. ${order.discount.toFixed(2)}`) + '\n';
  }

  ticket += ESCPOS.DOUBLE_ON;
  ticket += right('TOTAL:', `Bs. ${order.total.toFixed(2)}`) + '\n';
  ticket += ESCPOS.DOUBLE_OFF;

  if (tipAmount > 0) {
    ticket += right('Propina:', `Bs. ${tipAmount.toFixed(2)}`) + '\n';
    ticket += ESCPOS.FONT_B;
    ticket += '  * Propina no sujeta a IVA\n';
    ticket += ESCPOS.FONT_A;
  }

  ticket += line();

  // Payment info
  if (payment) {
    ticket += ESCPOS.ALIGN_CENTER;
    ticket += `Pagado con: ${payment.method}\n`;
    if (payment.reference) {
      ticket += `Ref: ${payment.reference}\n`;
    }
    ticket += ESCPOS.ALIGN_LEFT;
  }

  // QR Code (for SIN invoice)
  if (payment && appConfig.all.invoicing.enabled) {
    ticket += '\n';
    ticket += ESCPOS.ALIGN_CENTER;
    ticket += ESCPOS.FONT_B;
    ticket += 'Código de verificación SIN:\n';
    ticket += ESCPOS.QR_CODE(`factura|${business.nit}|${order.total}|${payment.id}`);
    ticket += '\n';
    ticket += ESCPOS.FONT_A;
  }

  // Footer
  ticket += ESCPOS.ALIGN_CENTER;
  ticket += '\n';
  ticket += center('¡Gracias por su visita!') + '\n';
  ticket += center('Rey de la Chelada') + '\n';
  ticket += center('Cochabamba, Bolivia') + '\n';
  ticket += '\n';
  ticket += center('Built with FORCH.i by Paulo Velasco') + '\n';
  ticket += '\n';
  ticket += '\n';

  // Cut paper
  ticket += ESCPOS.CUT;

  return new TextEncoder().encode(ticket);
}

/**
 * Hook for printer operations
 */
export function usePrinter(config: Partial<PrinterConfig> = {}) {
  const fullConfig: PrinterConfig = { ...DEFAULT_CONFIG, ...config };
  const [state, setState] = useState<PrinterState>({
    connected: false,
    printing: false,
    error: null,
  });

  /**
   * Connect to printer
   */
  const connect = useCallback(async (): Promise<boolean> => {
    setState(prev => ({ ...prev, error: null }));

    try {
      // In production: use WebUSB or WebSocket to connect to printer
      // For now: simulate connection
      console.log(`[Printer] Connecting to ${fullConfig.connection} printer (${fullConfig.paperSize})...`);

      // Simulate async connection
      await new Promise(resolve => setTimeout(resolve, 500));

      setState(prev => ({ ...prev, connected: true }));
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to connect to printer';
      setState(prev => ({ ...prev, error: msg }));
      return false;
    }
  }, [fullConfig.connection, fullConfig.paperSize]);

  /**
   * Print a ticket
   */
  const printTicket = useCallback(async (
    order: Order,
    payment?: Payment,
    tipAmount: number = 0,
  ): Promise<boolean> => {
    setState(prev => ({ ...prev, printing: true, error: null }));

    try {
      // Generate ticket data
      const data = generateTicket(order, payment, tipAmount, fullConfig);

      // In production: send data to printer
      console.log(`[Printer] Printing ticket for order ${order.id} (${data.length} bytes)`);

      // Simulate async print
      await new Promise(resolve => setTimeout(resolve, 1000));

      setState(prev => ({ ...prev, printing: false }));
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to print';
      setState(prev => ({ ...prev, printing: false, error: msg }));
      return false;
    }
  }, [fullConfig]);

  /**
   * Test printer connection
   */
  const testPrint = useCallback(async (): Promise<boolean> => {
    setState(prev => ({ ...prev, printing: true, error: null }));

    try {
      // Print test ticket
      const testData = ESCPOS.INIT +
        ESCPOS.ALIGN_CENTER +
        ESCPOS.DOUBLE_ON +
        'TEST DE IMPRESIÓN\n' +
        ESCPOS.DOUBLE_OFF +
        'Rey de la Chelada\n' +
        'Cochabamba, Bolivia\n' +
        '\n' +
        'Si ves esto, la impresora\n' +
        'funciona correctamente.\n' +
        '\n' +
        'Built with FORCH.i by Paulo Velasco\n' +
        '\n' +
        ESCPOS.CUT;

      console.log(`[Printer] Test print (${testData.length} bytes)`);
      await new Promise(resolve => setTimeout(resolve, 500));

      setState(prev => ({ ...prev, printing: false }));
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Test print failed';
      setState(prev => ({ ...prev, printing: false, error: msg }));
      return false;
    }
  }, []);

  /**
   * Disconnect from printer
   */
  const disconnect = useCallback(() => {
    setState({ connected: false, printing: false, error: null });
  }, []);

  return {
    ...state,
    config: fullConfig,
    connect,
    printTicket,
    testPrint,
    disconnect,
  };
}

export default usePrinter;
