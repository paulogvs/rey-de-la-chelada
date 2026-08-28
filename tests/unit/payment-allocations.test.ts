import { describe, expect, it } from 'vitest';
import {
  buildMixedPaymentPayload,
  previewAllocations,
  resolveChangeSplit,
  resolveChangeFromCash,
  resolveChangeFromQr,
  shouldClearChangePhotos,
  shouldClearProofPhotos,
} from '../../src/pwa/_shared/utils/paymentAllocations';

describe('payment allocation editor contract', () => {
  it('previews cash, QR, balance and cash change using cents', () => {
    expect(previewAllocations(10000, [
      { method: 'cash', amount: 4000, received: 5000 },
      { method: 'qr', amount: 6000 },
    ])).toEqual({ total: 10000, cash: 4000, qr: 6000, remaining: 0, change: 1000, valid: true });
  });

  it('rejects fractional, zero, over-allocation and invalid cash received', () => {
    expect(previewAllocations(10000, [{ method: 'cash', amount: 10001 }]).valid).toBe(false);
    expect(previewAllocations(10000, [{ method: 'cash', amount: 1000, received: 900 }]).valid).toBe(false);
    expect(previewAllocations(10000, [{ method: 'qr', amount: 100.5 }]).valid).toBe(false);
  });

  it('builds the server payload without sending UI-only empty fields', () => {
    expect(buildMixedPaymentPayload('o1', [
      { method: 'cash', amount: 4000, received: 5000 },
      { method: 'qr', amount: 6000, reference: '' },
    ], 'op-1')).toEqual({
      order_id: 'o1', idempotency_key: 'op-1',
      allocations: [
        { method: 'cash', amount: 4000, received: 5000 },
        { method: 'qr', amount: 6000 },
      ],
    });
  });
});

describe('resolveChangeSplit — reparto del cambio (regresión 2026-08-27)', () => {
  it('QR=0: el cambio es SOLO en efectivo (no se puede devolver por QR lo que no se cobró por QR)', () => {
    // Cash 15000, QR 0, pedido 12500 → cambio 2500. Solo efectivo.
    const s = resolveChangeSplit(2500, 15000, 0);
    expect(s.changeCash).toBe(2500);
    expect(s.changeQr).toBe(0);
    expect(s.valid).toBe(true);
    expect(s.maxChangeCash).toBe(2500);
    expect(s.minChangeCash).toBe(2500);
  });

  it('bloquea el caso del bug: el usuario NO puede forzar 20/5 con QR=0 (clamp a 25/0)', () => {
    // Simula intentar changeCash=20 con QR=0 (tendría que dar changeQr=5, imposible).
    const s = resolveChangeSplit(2500, 15000, 0);
    expect(s.valid).toBe(true);
    // El clamp de changeCash a 20 al rango [2500, 2500] → vuelve a 2500.
    const clamped = Math.min(s.maxChangeCash, Math.max(s.minChangeCash, 2000));
    expect(clamped).toBe(2500);
    expect(s.changeQr).toBe(0);
  });

  it('con QR cubriendo el exceso, el cambio si puede ser por QR', () => {
    // Cash 15000, QR 5000, pedido 12500 → cambio 7500. max efectivo=15000, min=7500-5000=2500.
    // Default = max efectivo (7500), resto QR = 0.
    const s = resolveChangeSplit(7500, 15000, 5000);
    expect(s.changeCash).toBe(7500);
    expect(s.changeQr).toBe(0);
    expect(s.minChangeCash).toBe(2500);
    expect(s.maxChangeCash).toBe(7500);
    expect(s.valid).toBe(true);
  });
});

describe('resolveChangeFromCash / resolveChangeFromQr — cambio editable (2026-08-27)', () => {
  it('resolveChangeFromCash: dado el cambio total y el efectivo deseado, deriva el QR', () => {
    // changeAvailable=2500, efectivo deseado=2000 → QR = 2500-2000 = 500.
    expect(resolveChangeFromCash(2500, 2000)).toEqual({ changeCash: 2000, changeQr: 500 });
  });

  it('Clamp: si quiero efectivo=3000 pero hay 2500 → efectivo=2500, QR=0 (sin exceder)', () => {
    expect(resolveChangeFromCash(2500, 3000)).toEqual({ changeCash: 2500, changeQr: 0 });
  });

  it('Clamp: no permite efectivo negativo (deriva QR=changeAvailable)', () => {
    expect(resolveChangeFromCash(2500, -200)).toEqual({ changeCash: 0, changeQr: 2500 });
  });

  it('resolveChangeFromQr: dado el cambio total y el QR deseado, deriva el efectivo', () => {
    // changeAvailable=2500, QR deseado=500 → efectivo = 2500-500 = 2000.
    expect(resolveChangeFromQr(2500, 500)).toEqual({ changeCash: 2000, changeQr: 500 });
  });

  it('Qr deseado > cambio total → clamp a QR=2500, efectivo=0', () => {
    expect(resolveChangeFromQr(2500, 4000)).toEqual({ changeCash: 0, changeQr: 2500 });
  });

  it('Regla de negocio: cambio QR no puede superar lo pagado por QR (qrGiven=0 → QR=0)', () => {
    // Escenario 150/0/125 (en centavos): cashGiven=15000, qrGiven=0, changeAvailable=2500.
    // El usuario intenta QR=500, pero como NO pagó nada por QR, el max cambio QR es 0
    // → clamp a changeCash=2500 (QR queda 0). El efectivo absorbe TODO el cambio.
    expect(resolveChangeFromQr(2500, 500, 15000, 0)).toEqual({ changeCash: 2500, changeQr: 0 });
  });

  it('Siempre suma el cambio total disponible (invariante), incluso con contexto cash/qr real', () => {
    // Cash 15000, QR 5000, pedido 12500 → changeAvailable 7500. min efectivo=2500.
    const cases = [2000, 2500, 5000, 7500, 9000];
    for (const cash of cases) {
      const c = resolveChangeFromCash(7500, cash, 15000, 5000);
      expect(c.changeCash + c.changeQr).toBe(7500);
      expect(c.changeQr).toBeGreaterThanOrEqual(0);
      expect(c.changeCash).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('shouldClearChangePhotos / shouldClearProofPhotos — auto-limpiar fotos (2026-08-27)', () => {
  it('shouldClearChangePhotos: true solo si no hay cambio por QR', () => {
    expect(shouldClearChangePhotos(0)).toBe(true);
    expect(shouldClearChangePhotos(-5)).toBe(true);  // defensivo: negativo = no aplica
    expect(shouldClearChangePhotos(1)).toBe(false);
    expect(shouldClearChangePhotos(500)).toBe(false);
  });

  it('shouldClearProofPhotos: true solo si no hay monto QR aplicado al pedido', () => {
    expect(shouldClearProofPhotos(0)).toBe(true);
    expect(shouldClearProofPhotos(-5)).toBe(true);   // defensivo
    expect(shouldClearProofPhotos(100)).toBe(false);
  });
});

describe('INVARIANTE del cambio (regresión 2026-08-28 — bug "cambio QR > disponible")', () => {
  // La captura del usuario: efectivo 100, QR 200, pedido 140 → cambio 160.
  // El cambio QR NUNCA puede superar `changeAvailable`, y cash+qr SIEMPRE = changeAvailable.
  it('el reparto desde QR deseado respeta el techo: qr desborda → clamp a changeAvailable y cash=0', () => {
    // Pedido 14000, efectivo 10000, QR 20000 → changeAvailable = 16000.
    // Usuario pide QR=198 (too high) → clamp QR a 16000 (disponible), cash=0.
    const r = resolveChangeFromQr(16000, 19800, 10000, 20000);
    expect(r.changeCash + r.changeQr).toBe(16000);
    expect(r.changeQr).toBeLessThanOrEqual(16000);
    expect(r.changeQr).toBe(16000);
    expect(r.changeCash).toBe(0);
  });

  it('el reparto desde efectivo siempre suma changeAvailable y respeta cashGiven', () => {
    const r = resolveChangeFromCash(16000, 5000, 10000, 20000);
    expect(r.changeCash + r.changeQr).toBe(16000);
    expect(r.changeCash).toBeLessThanOrEqual(10000);
    expect(r.changeQr).toBeGreaterThanOrEqual(0);
  });

  it('si no se pagó por QR (qrGiven=0), el cambio es SOLO efectivo (regla del server)', () => {
    const r = resolveChangeFromQr(2500, 2500, 15000, 0);
    expect(r.changeQr).toBe(0);
    expect(r.changeCash).toBe(2500);
  });
});
