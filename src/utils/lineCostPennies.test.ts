import { describe, it, expect } from 'vitest';
import { reconcileLineCosts } from './lineCostPennies';

describe('reconcileLineCosts (B8)', () => {
  it('rounds to cents and gives the rounding pennies to the last line', () => {
    expect(reconcileLineCosts([3.3333, 3.3333, 3.3333], 10)).toEqual([3.33, 3.33, 3.34]);
    expect(reconcileLineCosts([6.6667, 6.6667, 6.6667], 20)).toEqual([6.67, 6.67, 6.66]);
  });
  it('leaves lines that already add up, a real difference, and a $0 total alone (in cents)', () => {
    expect(reconcileLineCosts([12.5, 7.5], 20)).toEqual([12.5, 7.5]);
    expect(reconcileLineCosts([10, 10], 25)).toEqual([10, 10]);
    expect(reconcileLineCosts([3.3333], 0)).toEqual([3.33]);
  });
});
