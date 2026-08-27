/**
 * formatMoney / parseMoneyInput — moneda unificada "Bs 12,50" (FASE B).
 *
 * TDD: pin the comma-decimal format + teclado (coma/punto = decimal).
 */

import { describe, it, expect } from 'vitest';
import { formatMoney, parseMoneyInput, formatTableRef } from '../../src/pwa/_shared/utils/format';

describe('formatTableRef — mesa 0 es BARRA (2026-08-27)', () => {
  it('retorna BARRA para el número 0 (nunca "Mesa 0")', () => {
    expect(formatTableRef(0)).toBe('BARRA');
    expect(formatTableRef('0')).toBe('BARRA');
  });

  it('retorna "Mesa N" para números > 0', () => {
    expect(formatTableRef(1)).toBe('Mesa 1');
    expect(formatTableRef(12)).toBe('Mesa 12');
    expect(formatTableRef('3')).toBe('Mesa 3');
  });

  it('maneja null/undefined/NaN como BARRA (mesa de barra por defecto)', () => {
    expect(formatTableRef(null)).toBe('BARRA');
    expect(formatTableRef(undefined)).toBe('BARRA');
    expect(formatTableRef(Number.NaN)).toBe('BARRA');
  });
});

describe('formatMoney', () => {
  it('formatea con coma decimal y "Bs" sin punto', () => {
    expect(formatMoney(1250)).toBe('Bs 12,50');
  });

  it('formatea enteros con dos decimales', () => {
    expect(formatMoney(2500)).toBe('Bs 25,00');
  });

  it('formatea cero', () => {
    expect(formatMoney(0)).toBe('Bs 0,00');
  });

  it('defensa: valores no finitos → 0', () => {
    expect(formatMoney(Number.NaN)).toBe('Bs 0,00');
  });

  it('NO usa separador de miles', () => {
    expect(formatMoney(123450)).toBe('Bs 1234,50');
  });
});

describe('parseMoneyInput', () => {
  it('coma decimal → número en centavos', () => {
    expect(parseMoneyInput('12,50')).toBe(1250);
  });

  it('punto decimal → número en centavos', () => {
    expect(parseMoneyInput('12.50')).toBe(1250);
  });

  it('entero sin decimales → centavos', () => {
    expect(parseMoneyInput('45')).toBe(4500);
  });

  it('vacío → null', () => {
    expect(parseMoneyInput('')).toBeNull();
    expect(parseMoneyInput('   ')).toBeNull();
  });

  it('solo separador → null', () => {
    expect(parseMoneyInput(',')).toBeNull();
    expect(parseMoneyInput('.')).toBeNull();
  });

  it('varios puntos: el primero es decimal, el resto se elimina', () => {
    expect(parseMoneyInput('1.234.567,89')).toBe(123);
  });

  it('caracteres no numéricos se descartan', () => {
    expect(parseMoneyInput('Bs 12,50')).toBe(1250);
  });
});
