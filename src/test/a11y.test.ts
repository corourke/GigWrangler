import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { unlabeledIconButtons, sourceFiles, readSource } from './iconButtonLabels';

// A19: zoom is allowed, phone inputs don't trigger iOS focus-zoom, icon-only buttons have names.
const root = join(__dirname, '..', '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');

describe('viewport (A19)', () => {
  const viewport = read('index.html').match(/<meta name="viewport" content="([^"]+)"/)?.[1] ?? '';

  it('lets people zoom', () => {
    expect(viewport).not.toMatch(/user-scalable\s*=\s*no/);
    expect(viewport).not.toMatch(/maximum-scale/);
  });

  it('keeps the width and safe-area settings', () => {
    expect(viewport).toContain('width=device-width');
    expect(viewport).toContain('viewport-fit=cover');
  });
});

describe('phone inputs are 16px (A19)', () => {
  // iOS zooms into a focused field whose text is under 16px. With zoom allowed, small-text fields
  // get 16px on phone-width screens instead.
  const css = read('src/styles/globals.css');

  it('globals.css sets small-text fields to 16px on narrow screens, outside any layer', () => {
    const block = css.match(/@media \(max-width: 767px\) \{\s*input\.text-sm,[\s\S]*?\}\s*\}/)?.[0] ?? '';
    for (const sel of ['input.text-sm', 'input.text-xs', 'textarea.text-sm', 'textarea.text-xs', 'select.text-sm', 'select.text-xs']) {
      expect(block, sel).toContain(sel);
    }
    expect(block).toMatch(/font-size:\s*16px/);
  });

  it('no field sets a smaller font size inline (it would beat the rule)', () => {
    const offenders = sourceFiles(join(root, 'src')).filter((f) =>
      /<(input|textarea|select)\b[^>]*style=\{\{[^}]*fontSize:\s*'1[0-5]px'/s.test(readSource(f)),
    );
    expect(offenders.map((f) => relative(root, f))).toEqual([]);
  });
});

describe('unlabeledIconButtons', () => {
  it('finds an icon-only button without a name', () => {
    const src = `<div>\n<Button size="icon" onClick={close}>\n  <X className="w-4 h-4" />\n</Button>\n</div>`;
    expect(unlabeledIconButtons(src)).toEqual([{ line: 2, snippet: '<X className="w-4 h-4" />' }]);
  });

  it('accepts aria-label, aria-labelledby or title', () => {
    expect(unlabeledIconButtons(`<Button aria-label="Close" onClick={() => a > b}><X /></Button>`)).toEqual([]);
    expect(unlabeledIconButtons(`<button aria-labelledby="t"><X /></button>`)).toEqual([]);
    expect(unlabeledIconButtons(`<button title="Close"><X /></button>`)).toEqual([]);
  });

  it('ignores buttons with text', () => {
    expect(unlabeledIconButtons(`<Button><X /> Close</Button>`)).toEqual([]);
    expect(unlabeledIconButtons(`<Button>{label}</Button>`)).toEqual([]);
  });
});

describe('icon-only buttons have a name (A19)', () => {
  it('every one in src', () => {
    const missing = sourceFiles(join(root, 'src')).flatMap((f) =>
      unlabeledIconButtons(readSource(f)).map((h) => `${relative(root, f)}:${h.line} ${h.snippet}`),
    );
    expect(missing).toEqual([]);
  });
});
