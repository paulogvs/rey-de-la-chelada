/**
 * Unit — tableAlerts (FASE 4.5: alertas de salón por módulo)
 *
 * tableAlertState(activeOrder) → { served, modules }
 *  - served  → todo entregado → "💰 Por cobrar"
 *  - modules → 🍳/🍺 verde (ready) / amarillo (preparing)
 */

import { describe, it, expect } from 'vitest';
import { tableAlertState } from '../../src/pwa/meseros/tableAlerts';

describe('tableAlertState — alertas de salón por módulo', () => {
  it('sin pedido activo → sin alertas', () => {
    expect(tableAlertState(null)).toEqual({ served: false, modules: [] });
    expect(tableAlertState(undefined)).toEqual({ served: false, modules: [] });
  });

  it('pedido recién creado → ambos módulos preparing (amarillo)', () => {
    const state = tableAlertState({ id: 'o1', status: 'confirmed', modules: { bar: 'preparing', cocina: 'preparing' } });
    expect(state.served).toBe(false);
    expect(state.modules).toEqual([
      { module: 'bar', state: 'preparing' },
      { module: 'cocina', state: 'preparing' },
    ]);
  });

  it('cocina lista → cocina ready (verde), bar preparing (amarillo)', () => {
    const state = tableAlertState({ id: 'o1', status: 'preparing', modules: { bar: 'preparing', cocina: 'ready' } });
    expect(state.modules).toContainEqual({ module: 'cocina', state: 'ready' });
    expect(state.modules).toContainEqual({ module: 'bar', state: 'preparing' });
    expect(state.served).toBe(false);
  });

  it('served → served=true y sin módulos (mostrar "Por cobrar")', () => {
    const state = tableAlertState({ id: 'o1', status: 'served', modules: {} });
    expect(state.served).toBe(true);
    expect(state.modules).toEqual([]);
  });

  it('paid → no es served (la mesa se libera y activeOrder desaparece)', () => {
    const state = tableAlertState({ id: 'o1', status: 'paid', modules: {} });
    expect(state.served).toBe(false);
  });
});
