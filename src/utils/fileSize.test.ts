import { describe, it, expect } from 'vitest';
import { formatFileSize } from './fileSize';

describe('formatFileSize (saved documents on the Today sheet)', () => {
  it('shows KB below 1 MB', () => {
    expect(formatFileSize(240 * 1024)).toBe('240 KB');
    expect(formatFileSize(1023 * 1024)).toBe('1023 KB');
  });

  it('never shows 0 for a small file', () => {
    expect(formatFileSize(300)).toBe('1 KB');
    expect(formatFileSize(0)).toBe('0 KB');
  });

  it('shows MB from 1 MB, to one decimal', () => {
    expect(formatFileSize(1024 * 1024)).toBe('1.0 MB');
    expect(formatFileSize(2.5 * 1024 * 1024)).toBe('2.5 MB');
  });
});
