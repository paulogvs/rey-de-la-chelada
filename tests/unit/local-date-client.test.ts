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
import {
  localDateStr as coreLocalDateStr,
  localDateTimeStr,
  localTimeStr,
  businessDayDateStr as coreBusinessDayDateStr,
  BUSINESS_DAY_START_HOUR,
} from '../../src/core/config/local-date';
import { businessDayDateStr as clientBusinessDayDateStr } from '../../src/pwa/_shared/utils/localDate';

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

describe('localDateTimeStr / localTimeStr (core) — P1-1: fecha-hora y hora local America/La_Paz', () => {
  it('localDateTimeStr: 2026-08-09T20:30:00Z → 09/08/2026 16:30 (La Paz = UTC-4)', () => {
    expect(localDateTimeStr(new Date('2026-08-09T20:30:00Z'))).toBe('09/08/2026 16:30');
  });

  it('localDateTimeStr: cruce de día — 2026-08-10T00:30:00Z → 09/08/2026 20:30', () => {
    expect(localDateTimeStr(new Date('2026-08-10T00:30:00Z'))).toBe('09/08/2026 20:30');
  });

  it('localDateTimeStr: medianoche local — 2026-08-09T04:05:00Z → 09/08/2026 00:05', () => {
    expect(localDateTimeStr(new Date('2026-08-09T04:05:00Z'))).toBe('09/08/2026 00:05');
  });

  it('localTimeStr: 2026-08-09T20:30:00Z → 16:30', () => {
    expect(localTimeStr(new Date('2026-08-09T20:30:00Z'))).toBe('16:30');
  });

  it('localTimeStr: 2026-08-09T16:05:00Z → 12:05', () => {
    expect(localTimeStr(new Date('2026-08-09T16:05:00Z'))).toBe('12:05');
  });

  it('localDateTimeStr sin argumento = ahora local (consistencia con localDateStr)', () => {
    const now = new Date();
    const expected = new Intl.DateTimeFormat('en-US', {
      timeZone: CLIENT_TZ,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(now);
    const get = (t: string) => expected.find(p => p.type === t)?.value;
    expect(localDateTimeStr()).toBe(`${get('day')}/${get('month')}/${get('year')} ${get('hour')}:${get('minute')}`);
  });
});

describe('businessDayDateStr (cliente) — día laboral 15:00→06:00', () => {
  // MISMO contrato que el server (server/utils/date-utils.js businessDayDateStr):
  // America/La_Paz = UTC-4; hora local >= 15:00 → fecha local; < 15:00 → día anterior.

  it('local mié 19:00 (UTC 2026-08-19T23:00:00Z) → 2026-08-19', () => {
    expect(clientBusinessDayDateStr(new Date('2026-08-19T23:00:00Z'))).toBe('2026-08-19');
  });

  it('local jue 03:00 (UTC 2026-08-20T07:00:00Z) → 2026-08-19 (turno del miércoles)', () => {
    expect(clientBusinessDayDateStr(new Date('2026-08-20T07:00:00Z'))).toBe('2026-08-19');
  });

  it('local jue 06:00 (UTC 2026-08-20T10:00:00Z) → 2026-08-19 (fin del turno)', () => {
    expect(clientBusinessDayDateStr(new Date('2026-08-20T10:00:00Z'))).toBe('2026-08-19');
  });

  it('local jue 15:00 (UTC 2026-08-20T19:00:00Z) → 2026-08-20 (inicio del turno)', () => {
    expect(clientBusinessDayDateStr(new Date('2026-08-20T19:00:00Z'))).toBe('2026-08-20');
  });

  it('local jue 14:59 (UTC 2026-08-20T18:59:00Z) → 2026-08-19 (1 min antes del inicio)', () => {
    expect(clientBusinessDayDateStr(new Date('2026-08-20T18:59:00Z'))).toBe('2026-08-19');
  });

  it('BUSINESS_DAY_START_HOUR = 15 (sync manual con server)', () => {
    expect(BUSINESS_DAY_START_HOUR).toBe(15);
  });

  it('core businessDayDateStr tiene el mismo comportamiento que el del cliente', () => {
    expect(coreBusinessDayDateStr(new Date('2026-08-20T07:00:00Z'))).toBe('2026-08-19');
    expect(coreBusinessDayDateStr(new Date('2026-08-20T19:00:00Z'))).toBe('2026-08-20');
  });
});
