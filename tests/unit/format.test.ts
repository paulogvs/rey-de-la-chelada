/**
 * formatMoney / parseMoneyInput — moneda unificada "Bs 12,50" (FASE B).
 *
 * TDD: pin the comma-decimal format + teclado (coma/punto = decimal).
 */

import { describe, it, expect } from 'vitest';
import { formatMoney, parseMoneyInput } from '../../src/pwa/_shared/utils/format';

describe('formatMoney', () => {
  it('formatea con coma decimal y "Bs" sin punto', () => {
    expect(formatMoney(12.5)).toBe('Bs 12,50');
  });

  it('formatea enteros con dos decimales', () => {
    expect(formatMoney(25)).toBe('Bs 25,00');
  });

  it('formatea cero', () => {
    expect(formatMoney(0)).toBe('Bs 0,00');
  });

  it('defensa: valores no finitos → 0', () => {
    expect(formatMoney(Number.NaN)).toBe('Bs 0,00');
  });

  it('NO usa separador de miles', () => {
    expect(formatMoney(1234.5)).toBe('Bs 1234,50');
  });
});

describe('parseMoneyInput', () => {
  it('coma decimal → número', () => {
    expect(parseMoneyInput('12,50')).toBe(12.5);
  });

  it('punto decimal → número', () => {
    expect(parseMoneyInput('12.50')).toBe(12.5);
  });

  it('entero sin decimales', () => {
    expect(parseMoneyInput('45')).toBe(45);
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
    expect(parseMoneyInput('1.234.567,89')).toBe(1.23456789);
  });

  it('caracteres no numéricos se descartan', () => {
    expect(parseMoneyInput('Bs 12,50')).toBe(12.5);
  });
});
