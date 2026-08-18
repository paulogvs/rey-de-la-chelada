/**
 * Date utils — "hoy" en timezone local America/La_Paz (C1)
 *
 * BUG: `new Date().toISOString().split('T')[0]` corta a las 20:00 local
 * (UTC-4): a las 21:00 local ya es "mañana" en UTC → el corte de caja y
 * los reportes se corren de día.
 *
 * Regla: "hoy" = 00:00–00:00 hora local America/La_Paz (UTC-4, sin DST).
 * El helper devuelve la fecha local; para SQL usamos DATE(col, '-4 hours')
 * porque processed_at/created_at se guardan en UTC.
 */

import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import {
  localDateStr,
  localDateExpr,
  businessDayDateStr,
  businessDayExpr,
  BUSINESS_TIMEZONE,
  SQL_UTC_OFFSET_MODIFIER,
} from '../../server/utils/date-utils.js';

describe('localDateStr — "hoy" local America/La_Paz', () => {
  it('23:30 UTC = 19:30 local → mismo día (2026-08-06)', () => {
    expect(localDateStr(new Date('2026-08-06T23:30:00Z'))).toBe('2026-08-06');
  });

  it('01:30 UTC = 21:30 local del día anterior (2026-08-06)', () => {
    expect(localDateStr(new Date('2026-08-07T01:30:00Z'))).toBe('2026-08-06');
  });

  it('03:59 UTC = 23:59 local del mismo día; 04:00 UTC = 00:00 del siguiente', () => {
    // 23:59 local = 03:59 UTC del día siguiente → fecha local NO avanza
    expect(localDateStr(new Date('2026-08-06T03:59:00Z'))).toBe('2026-08-05');
    // 00:00 local = 04:00 UTC → fecha local avanza
    expect(localDateStr(new Date('2026-08-06T04:00:00Z'))).toBe('2026-08-06');
  });

  it('funciona sin argumento (ahora)', () => {
    const now = new Date();
    const expected = new Intl.DateTimeFormat('en-US', {
      timeZone: BUSINESS_TIMEZONE,
      year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(now);
    const get = t => expected.find(p => p.type === t)?.value;
    expect(localDateStr()).toBe(`${get('year')}-${get('month')}-${get('day')}`);
  });
});

describe('SQL modifier — UTC almacenado → fecha local', () => {
  it('DATE(ts, "-4 hours") convierte timestamps UTC a fecha local', () => {
    const db = new Database(':memory:');
    // Mismos ejemplos del helper JS: 23:30 UTC sigue siendo el 6; 01:30 UTC del 7 es el 6 local
    expect(db.prepare(`SELECT ${localDateExpr('?')} as d`).get('2026-08-06T23:30:00.000Z').d).toBe('2026-08-06');
    expect(db.prepare(`SELECT ${localDateExpr('?')} as d`).get('2026-08-07T01:30:00.000Z').d).toBe('2026-08-06');
    // datetime('now') (UTC, sin sufijo Z) también se desplaza
    expect(db.prepare(`SELECT ${localDateExpr('?')} as d`).get('2026-08-07 01:30:00').d).toBe('2026-08-06');
  });

  it('el modifier es el offset fijo -4 horas (UTC-4, sin DST)', () => {
    expect(BUSINESS_TIMEZONE).toBe('America/La_Paz');
    expect(SQL_UTC_OFFSET_MODIFIER).toBe('-4 hours');
  });
});

describe('businessDayDateStr / businessDayExpr — día laboral 15:00→06:00', () => {
  // "Hoy" del negocio (turno): local hora >= 15:00 → su fecha local;
  // local hora < 15:00 → fecha local del día ANTERIOR (termina 06:00 del día siguiente).
  // America/La_Paz = UTC-4 → local = UTC - 4h.

  it('local mié 19:00 (UTC 2026-08-19T23:00:00Z) → 2026-08-19', () => {
    expect(businessDayDateStr(new Date('2026-08-19T23:00:00Z'))).toBe('2026-08-19');
  });

  it('local jue 03:00 (UTC 2026-08-20T07:00:00Z) → 2026-08-19 (pertenece al turno del miércoles)', () => {
    expect(businessDayDateStr(new Date('2026-08-20T07:00:00Z'))).toBe('2026-08-19');
  });

  it('local jue 06:00 (UTC 2026-08-20T10:00:00Z) → 2026-08-19 (fin del turno)', () => {
    expect(businessDayDateStr(new Date('2026-08-20T10:00:00Z'))).toBe('2026-08-19');
  });

  it('local jue 15:00 (UTC 2026-08-20T19:00:00Z) → 2026-08-20 (inicio del turno)', () => {
    expect(businessDayDateStr(new Date('2026-08-20T19:00:00Z'))).toBe('2026-08-20');
  });

  it('local jue 14:59 (UTC 2026-08-20T18:59:00Z) → 2026-08-19 (1 min antes del inicio)', () => {
    expect(businessDayDateStr(new Date('2026-08-20T18:59:00Z'))).toBe('2026-08-19');
  });

  it('businessDayExpr("created_at") → DATE(created_at, \'-4 hours\', \'-15 hours\')', () => {
    expect(businessDayExpr('created_at')).toBe("DATE(created_at, '-4 hours', '-15 hours')");
  });

  it('SQL: DATE(ts, "-4 hours", "-15 hours") agrupa por día laboral', () => {
    const db = new Database(':memory:');
    // local jue 03:00 = UTC jue 07:00 → -19h = UTC mié 12:00 → miércoles
    expect(db.prepare(`SELECT ${businessDayExpr('?')} as d`).get('2026-08-20 07:00:00').d).toBe('2026-08-19');
    // local jue 15:00 = UTC jue 19:00 → -19h = UTC jue 00:00 → jueves
    expect(db.prepare(`SELECT ${businessDayExpr('?')} as d`).get('2026-08-20 19:00:00').d).toBe('2026-08-20');
  });
});
