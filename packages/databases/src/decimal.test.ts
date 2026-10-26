import { describe, expect, it } from 'vitest';
import {
  addDecimal,
  compareDecimal,
  divideDecimal,
  fitsNumberLimits,
  formatDecimal,
  multiplyDecimal,
  normalizeDecimal,
  numberToDecimal,
  roundDecimal,
  shiftDecimal,
  subtractDecimal,
} from './decimal';

describe('decimal', () => {
  it.each([
    ['+001.500', '1.5'],
    ['.5', '0.5'],
    ['12.', '12'],
    ['-0.0', '0'],
    ['1e3', '1000'],
    ['1.5e-3', '0.0015'],
    ['-12', '-12'],
  ])('normalizes %s', (input, out) => {
    expect(normalizeDecimal(input)).toBe(out);
  });
  it.each(['abc', '', '.', '1,000', '$12', '1 2'])('refuses %s', (input) => {
    expect(normalizeDecimal(input)).toBeNull();
  });
  it('checks the Number limits', () => {
    expect(fitsNumberLimits('123456789012345')).toBe(true);
    expect(fitsNumberLimits('1234567890123456')).toBe(false);
    expect(fitsNumberLimits('0.1234567891')).toBe(true);
    expect(fitsNumberLimits('0.12345678901')).toBe(false);
  });
  it('rounds half away from zero', () => {
    expect(roundDecimal('1.25', 1)).toBe('1.3');
    expect(roundDecimal('-1.25', 1)).toBe('-1.3');
    expect(roundDecimal('0.04', 1)).toBe('0');
    expect(roundDecimal('9.99', 1)).toBe('10');
  });
  it('does exact arithmetic', () => {
    expect(addDecimal('0.1', '0.2')).toBe('0.3');
    expect(subtractDecimal('1', '1.5')).toBe('-0.5');
    expect(multiplyDecimal('1.5', '2')).toBe('3');
    expect(divideDecimal('1', '3')).toBe('0.3333333333');
    expect(divideDecimal('2', '3')).toBe('0.6666666667');
    expect(divideDecimal('1', '0')).toBeNull();
    expect(addDecimal('999999999999999.9999999999', '0.0000000001')).toBe('1000000000000000');
    expect(compareDecimal('-1', '0.5')).toBe(-1);
    expect(compareDecimal('10', '9.99')).toBe(1);
    expect(compareDecimal('2.50', '2.5')).toBe(0);
  });
  it('shifts the point', () => {
    expect(shiftDecimal('45', -2)).toBe('0.45');
    expect(shiftDecimal('0.45', 2)).toBe('45');
    expect(shiftDecimal('1.5', -3)).toBe('0.0015');
    expect(shiftDecimal('-12.345', 1)).toBe('-123.45');
  });
  it('converts from numbers', () => {
    expect(numberToDecimal(0.1 + 0.2)).toBe('0.3');
    expect(numberToDecimal(1e21)).toBe('1000000000000000000000');
    expect(numberToDecimal(Number.NaN)).toBeNull();
  });
  it('formats as shown', () => {
    expect(formatDecimal('1234.5', { format: 'number', decimals: 'auto' })).toBe('1234.5');
    expect(formatDecimal('1234.5', { format: 'number_commas', decimals: 'auto' })).toBe('1,234.5');
    expect(formatDecimal('0.45', { format: 'percent', decimals: 'auto' })).toBe('45%');
    expect(formatDecimal('1234.5', { format: 'currency', decimals: 'auto' })).toBe('$1,234.50');
    expect(formatDecimal('1.005', { format: 'number', decimals: 2 })).toBe('1.01');
    expect(formatDecimal('-12', { format: 'currency', decimals: 0, currency: 'EUR' })).toBe('-€12');
    expect(
      formatDecimal('123456789012345.1234567891', { format: 'number_commas', decimals: 'auto' }),
    ).toBe('123,456,789,012,345.1234567891');
  });
});
