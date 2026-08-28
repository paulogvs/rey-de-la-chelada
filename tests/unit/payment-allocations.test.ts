import { describe, expect, it } from 'vitest';
import {
  buildMixedPaymentPayload,
  previewAllocations,
  resolveChangeSplit,
  resolveChangeFromCash,
  resolveChangeFromQr,
  shouldClearChangePhotos,
  shouldClearProofPhotos,
  validateChangeRule,
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
  it('QR=0: el cambio es SOLO en efectivo (default) si no hay exceso que repartir por QR', () => {
    // Cash 15000, QR 0, pedido 12500 → cambio 2500. Default = max efectivo = 2500, QR 0.
    const s = resolveChangeSplit(2500, 15000, 0);
    expect(s.changeCash).toBe(2500);
    expect(s.changeQr).toBe(0);
    expect(s.valid).toBe(true);
    expect(s.maxChangeCash).toBe(2500);
    expect(s.minChangeCash).toBe(0);
  });

  it('el usuario PUEDE mover el vuelto a QR aunque no haya pagado por QR (retiro del local)', () => {
    // El vuelto por QR es un retiro del local → no está limitado a qrGiven.
    // Si el mesero elige efectivo=20, el QR toma los 5 restantes.
    const r = resolveChangeFromQr(2500, 500, 15000, 0);
    expect(r.changeCash).toBe(2000);
    expect(r.changeQr).toBe(500);
  });

  it('con QR cubriendo, default es todo en efectivo; min=0 (QR puede tomar todo)', () => {
    // Cash 15000, QR 5000, pedido 12500 → cambio 7500. Default = max efectivo (7500), QR 0.
    const s = resolveChangeSplit(7500, 15000, 5000);
    expect(s.changeCash).toBe(7500);
    expect(s.changeQr).toBe(0);
    expect(s.minChangeCash).toBe(0);
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

  it('Siempre suma el cambio total disponible (invariante), incluso con contexto cash real', () => {
    // Cash 15000, cambio 7500. min efectivo=0, max=7500.
    const cases = [2000, 2500, 5000, 7500, 9000];
    for (const cash of cases) {
      const c = resolveChangeFromCash(7500, cash, 15000, 5000);
      expect(c.changeCash + c.changeQr).toBe(7500);
      expect(c.changeQr).toBeGreaterThanOrEqual(0);
      expect(c.changeCash).toBeGreaterThanOrEqual(0);
      expect(c.changeCash).toBeLessThanOrEqual(7500);
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

  it('retiro QR sin pago QR previo: es válido (el local transfiere el vuelto)', () => {
    // cashGiven=15000, qrGiven=0, cambio 2500. El mesero puede elegir QR=2500 (retiro) o efectivo.
    const r = resolveChangeFromQr(2500, 2500, 15000, 0);
    expect(r.changeCash).toBe(0);
    expect(r.changeQr).toBe(2500);
  });
});

describe('REGLA SIMPLE DE COBRO (SSOT 2026-08-28): (cash+qr) − (cambioCash+cambioQr) = pedido', () => {
  it('E1: pago QR 100, pedido 60, cambio efectivo 40 (vuelto en efectivo de pago QR)', () => {
    // QR paga de más y el vuelto se da en efectivo: cashGiven=0, qrGiven=100, changeCash=40.
    // applied = (0+100) − (40+0) = 60 ✓; pero changeCash(40) > cashGiven(0) → NO válido (no hay efectivo recibido).
    const r = validateChangeRule(60, 0, 100, 40, 0);
    expect(r.ok).toBe(false); // el server no puede dar vuelto efectivo sin efectivo recibido
  });

  it('E1b: pago efectivo 100 + QR cubre, pedido 60, vuelto efectivo 40 (normal, SIN pago QR de más)', () => {
    const r = validateChangeRule(60, 100, 0, 40, 0);
    expect(r.ok).toBe(true);
    expect(r.applied).toBe(60);
  });

  it('E2: efectivo 100, pedido 60, vuelto QR 40 (retiro QR — el local transfiere el vuelto)', () => {
    const r = validateChangeRule(60, 100, 0, 0, 40);
    expect(r.ok).toBe(true);
    expect(r.applied).toBe(60);
  });

  it('E3: mixto QR 50 + efectivo 50, pedido 60, vuelto QR 20 + efectivo 20', () => {
    const r = validateChangeRule(60, 50, 50, 20, 20);
    expect(r.ok).toBe(true);
    expect(r.applied).toBe(60);
  });

  it('E4: mixto QR 80 + efectivo 50, pedido 100, vuelto QR 10 + efectivo 20', () => {
    const r = validateChangeRule(100, 50, 80, 20, 10);
    expect(r.ok).toBe(true);
    expect(r.applied).toBe(100);
  });

  it('rechaza si no cuadra con el pedido', () => {
    expect(validateChangeRule(60, 100, 0, 20, 0).ok).toBe(false); // applied 80 ≠ 60
    expect(validateChangeRule(60, 100, 0, 40, 10).ok).toBe(false); // applied 50 ≠ 60
  });

  it('rechaza si el cambio en efectivo supera lo entregado en efectivo', () => {
    expect(validateChangeRule(60, 0, 100, 40, 0).ok).toBe(false); // changeCash > cashGiven
  });

  it('cambio total = exceso de pago (cash+qr − pedido)', () => {
    const r = validateChangeRule(60, 100, 50, 40, 50);
    // cambioCash+cambioQr = 90 = (100+50)−60 ✓
    expect(r.ok).toBe(true);
    expect(r.applied).toBe(60);
  });
});
