import { describe, it, expect } from 'vitest';
import { splitEqual, splitCustom, splitPercentage, splitShares, computeShares } from '../splits.js';
import { parseAmountToPaise, formatPaise, sumPaise } from '../money.js';

const sum = (shares) => Object.values(shares).reduce((a, b) => a + b, 0);

describe('money parsing/formatting', () => {
  it('parses rupee strings to paise', () => {
    expect(parseAmountToPaise('1200')).toBe(120000);
    expect(parseAmountToPaise('0.01')).toBe(1);
    expect(parseAmountToPaise('1,234.5')).toBe(123450);
    expect(parseAmountToPaise('12.345')).toBeNull();
    expect(parseAmountToPaise('-5')).toBeNull();
    expect(parseAmountToPaise('abc')).toBeNull();
    expect(parseAmountToPaise('')).toBeNull();
  });
  it('formats paise for display', () => {
    expect(formatPaise(120000)).toBe('₹1,200.00');
    expect(formatPaise(1)).toBe('₹0.01');
    expect(formatPaise(-123450)).toBe('-₹1,234.50');
  });
  it('sums safely and rejects non-integers', () => {
    expect(sumPaise([1, 2, 3])).toBe(6);
    expect(() => sumPaise([1.5])).toThrow();
  });
});

describe('equal split', () => {
  it('splits evenly when divisible', () => {
    const s = splitEqual(120000, ['a', 'b', 'c']);
    expect(s).toEqual({ a: 40000, b: 40000, c: 40000 });
  });
  it('distributes remainder paise deterministically and exactly', () => {
    const s = splitEqual(100, ['c', 'a', 'b']); // ₹1.00 across 3
    expect(sum(s)).toBe(100);
    // sorted order: a, b get the extra paisa
    expect(s).toEqual({ a: 34, b: 33, c: 33 });
  });
  it('is order-independent (deterministic)', () => {
    const s1 = splitEqual(1001, ['x', 'y', 'z']);
    const s2 = splitEqual(1001, ['z', 'x', 'y']);
    expect(s1).toEqual(s2);
    expect(sum(s1)).toBe(1001);
  });
  it('rejects duplicates, empty lists, bad totals', () => {
    expect(() => splitEqual(100, [])).toThrow();
    expect(() => splitEqual(100, ['a', 'a'])).toThrow();
    expect(() => splitEqual(-5, ['a'])).toThrow();
    expect(() => splitEqual(100.5, ['a'])).toThrow();
  });
});

describe('custom split', () => {
  it('accepts exact sums', () => {
    expect(splitCustom(1000, { a: 600, b: 400 })).toEqual({ a: 600, b: 400 });
  });
  it('rejects sums that do not match the total', () => {
    expect(() => splitCustom(1000, { a: 600, b: 300 })).toThrow(/add up/);
  });
  it('rejects negative or fractional amounts', () => {
    expect(() => splitCustom(1000, { a: -100, b: 1100 })).toThrow();
    expect(() => splitCustom(1000, { a: 500.5, b: 499.5 })).toThrow();
  });
});

describe('percentage split', () => {
  it('splits by percentage exactly', () => {
    const s = splitPercentage(10000, { a: 50, b: 30, c: 20 });
    expect(s).toEqual({ a: 5000, b: 3000, c: 2000 });
  });
  it('requires percentages to total 100', () => {
    expect(() => splitPercentage(10000, { a: 50, b: 30 })).toThrow(/100/);
  });
  it('handles fractional percentages with exact allocation', () => {
    const s = splitPercentage(10001, { a: 33.33, b: 33.33, c: 33.34 });
    expect(sum(s)).toBe(10001);
  });
  it('never loses a paisa on awkward totals', () => {
    for (const total of [1, 97, 999, 10001, 123457]) {
      const s = splitPercentage(total, { a: 12.5, b: 37.5, c: 50 });
      expect(sum(s)).toBe(total);
    }
  });
});

describe('shares split', () => {
  it('splits 2:1 shares', () => {
    const s = splitShares(30000, { a: 2, b: 1 });
    expect(s).toEqual({ a: 20000, b: 10000 });
  });
  it('rejects zero/negative/fractional shares', () => {
    expect(() => splitShares(100, { a: 0, b: 1 })).toThrow();
    expect(() => splitShares(100, { a: -1, b: 2 })).toThrow();
    expect(() => splitShares(100, { a: 1.5, b: 1 })).toThrow();
  });
  it('allocates remainders exactly for awkward weights', () => {
    for (const total of [100, 1001, 99999]) {
      const s = splitShares(total, { a: 3, b: 5, c: 7 });
      expect(sum(s)).toBe(total);
    }
  });
});

describe('computeShares dispatch', () => {
  it('routes to the right method', () => {
    expect(computeShares('equal', 300, ['a', 'b', 'c'])).toEqual({ a: 100, b: 100, c: 100 });
    expect(computeShares('shares', 300, null, { a: 2, b: 1 })).toEqual({ a: 200, b: 100 });
    expect(() => computeShares('nope', 300, ['a'])).toThrow(/Unknown/);
  });
});
