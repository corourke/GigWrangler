import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Buttons whose only content is one icon element and that have no accessible name (no aria-label
 * or aria-labelledby). A screen reader announces such a button as just "button" (A19).
 * A static scan of the JSX source: it reads `<Button …>` / `<button …>` elements whose children
 * are a single self-closing element, which is how icon-only buttons are written in this codebase.
 */
export function unlabeledIconButtons(source: string): { line: number; snippet: string }[] {
  const found: { line: number; snippet: string }[] = [];
  const open = /<(Button|button)\b/g;
  let m: RegExpExecArray | null;
  while ((m = open.exec(source))) {
    const tag = m[1];
    // The opening tag ends at the first '>' outside braces and quotes.
    let i = m.index + m[0].length;
    let depth = 0;
    let quote: string | null = null;
    for (; i < source.length; i++) {
      const ch = source[i];
      if (quote) { if (ch === quote) quote = null; continue; }
      if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
      if (ch === '{') depth++;
      else if (ch === '}') depth--;
      else if (ch === '>' && depth === 0) break;
    }
    const attrs = source.slice(m.index, i + 1);
    if (attrs.endsWith('/>')) continue;
    const close = source.indexOf(`</${tag}>`, i);
    if (close < 0) continue;
    const children = source.slice(i + 1, close).trim();
    // Exactly one self-closing element, e.g. <X className="w-4 h-4" />
    if (!/^<[A-Z][\w.]*\b[^<>]*\/>$/.test(children)) continue;
    // title also gives a name (the accessible-name fallback), though aria-label is preferred.
    if (/\b(aria-label(ledby)?|title)=/.test(attrs)) continue;
    found.push({ line: source.slice(0, m.index).split('\n').length, snippet: children });
  }
  return found;
}

export function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return name.endsWith('.tsx') && !/\.(test|spec)\.tsx$/.test(name) ? [path] : [];
  });
}

export const readSource = (path: string) => readFileSync(path, 'utf8');
