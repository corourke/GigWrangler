import { describe, it, expect } from 'vitest';
import { plural } from './plural';

describe('plural', () => {
  it('says "1 kit", "0 kits", "2 kits"', () => {
    expect(plural(1, 'kit')).toBe('1 kit');
    expect(plural(0, 'kit')).toBe('0 kits');
    expect(plural(2, 'kit')).toBe('2 kits');
  });

  it('takes an irregular plural', () => {
    expect(plural(1, 'person', 'people')).toBe('1 person');
    expect(plural(3, 'person', 'people')).toBe('3 people');
  });
});
