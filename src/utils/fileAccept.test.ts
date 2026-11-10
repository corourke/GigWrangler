import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { SCAN_FILE_ACCEPT, ATTACHMENT_FILE_ACCEPT, RECEIPT_FILE_ACCEPT } from './fileAccept';
import { ALLOWED_MEDIA_TYPES } from '../../supabase/functions/ai-scan/scanQueue';
import { attachmentContentType } from '../services/attachment.service';

const exts = (accept: string) => accept.split(',').map(e => e.trim());
const typeOf: Record<string, string> = { '.pdf': 'application/pdf', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif' };

// The file pickers offer only what will be accepted (no SVG or TIFF to be refused afterwards).
describe('file picker accept lists', () => {
  it('scan pickers offer exactly what the scanner reads', () => {
    expect(exts(SCAN_FILE_ACCEPT).every(e => e.startsWith('.'))).toBe(true);
    expect(new Set(exts(SCAN_FILE_ACCEPT).map(e => typeOf[e]))).toEqual(ALLOWED_MEDIA_TYPES);
  });

  it('the phone receipt picker offers exactly what the scanner reads, as media types', () => {
    expect(new Set(exts(RECEIPT_FILE_ACCEPT))).toEqual(ALLOWED_MEDIA_TYPES);
  });

  it('attachment pickers offer exactly what the bucket takes', () => {
    for (const e of exts(ATTACHMENT_FILE_ACCEPT)) {
      expect(attachmentContentType(new File(['x'], `f${e}`)), e).not.toBeNull();
    }
    expect(exts(ATTACHMENT_FILE_ACCEPT)).not.toContain('.svg');
    expect(exts(ATTACHMENT_FILE_ACCEPT)).not.toContain('.tif');
  });

  it('no picker in the app offers every image type', () => {
    const files: string[] = [];
    const walk = (d: string) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (p.endsWith('.tsx') && !p.endsWith('.test.tsx')) files.push(p); } };
    walk(resolve(__dirname, '..'));
    const offenders = files.filter(f => readFileSync(f, 'utf8').includes('image/*'));
    expect(offenders).toEqual([]);
  });
});
