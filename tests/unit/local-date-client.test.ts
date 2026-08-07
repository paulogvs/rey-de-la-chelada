/**
 * Local date helper (client-side) — "hoy" en timezone America/La_Paz (2.1)
 *
 * BUG corregido (mismo C1 pero en UI/scripts): `new Date().toISOString()
 * .split('T')[0]` devuelve la fecha UTC — a las 20:00 local (UTC-4) ya es
 * "mañana" en UTC. El dashboard de admin y el "hoy" del corte de caja se
 * corrían de día.
 *
 * El helper cliente (src/pwa/_shared/utils/localDate.ts) y el de core
 * (src/core/config/local-date.ts) deben devolver la fecha local del negocio
 * (America/La_Paz, UTC-4 sin DST) — MISMO comportamiento que el helper del
 * server (server/utils/date-utils.js).
 */

import { describe, it, expect } from 'vitest';
import { localDateStr as clientLocalDateStr, BUSINESS_TIMEZONE as CLIENT_TZ } from '../../src/pwa/_shared/utils/localDate';
import { localDateStr as coreLocalDateStr } from '../../src/core/config/local-date';

describe('localDateStr (cliente) — "hoy" local America/La_Paz', () => {
  it('23:30 UTC = 19:30 local → mismo día (2026-08-06)', () => {
    expect(clientLocalDateStr(new Date('2026-08-06T23:30:00Z'))).toBe('2026-08-06');
  });

  it('01:30 UTC = 21:30 local del día anterior (2026-08-06)', () => {
    expect(clientLocalDateStr(new Date('2026-08-07T01:30:00Z'))).toBe('2026-08-06');
  });

  it('03:59 UTC = 23:59 local del mismo día; 04:00 UTC = 00:00 del siguiente', () => {
    expect(clientLocalDateStr(new Date('2026-08-06T03:59:00Z'))).toBe('2026-08-05');
    expect(clientLocalDateStr(new Date('2026-08-06T04:00:00Z'))).toBe('2026-08-06');
  });

  it('funciona sin argumento (ahora)', () => {
    const now = new Date();
    const expected = new Intl.DateTimeFormat('en-US', {
      timeZone: CLIENT_TZ,
      year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(now);
    const get = (t: string) => expected.find(p => p.type === t)?.value;
    expect(clientLocalDateStr()).toBe(`${get('year')}-${get('month')}-${get('day')}`);
  });

  it('zona horaria = America/La_Paz (UTC-4 sin DST)', () => {
    expect(CLIENT_TZ).toBe('America/La_Paz');
  });
});

describe('localDateStr (core) — helper compartido del engine', () => {
  it('mismo comportamiento que el helper del cliente', () => {
    expect(coreLocalDateStr(new Date('2026-08-06T23:30:00Z'))).toBe('2026-08-06');
    expect(coreLocalDateStr(new Date('2026-08-07T01:30:00Z'))).toBe('2026-08-06');
  });
});
