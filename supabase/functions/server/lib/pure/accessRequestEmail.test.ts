import { describe, it, expect } from 'vitest';
import { escapeHtml, accessRequestOutcomeEmail } from './accessRequestEmail';

describe('escapeHtml', () => {
  it('escapes the characters that make markup', () => {
    expect(escapeHtml(`<b class="x">Tom & 'Jerry'</b>`)).toBe('&lt;b class=&quot;x&quot;&gt;Tom &amp; &#39;Jerry&#39;&lt;/b&gt;');
  });
  it('treats a missing value as empty', () => {
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
  });
});

describe('accessRequestOutcomeEmail', () => {
  const base = { firstName: 'Pat', orgName: 'Demo Sound', requestedRole: 'Viewer', decision: 'approved' as const, responseMessage: null };

  it('words a request to join', () => {
    const email = accessRequestOutcomeEmail(base);
    expect(email.subject).toBe('Your request to join Demo Sound was approved');
    expect(email.html).toContain('Your request to join <strong>Demo Sound</strong> as <strong>Viewer</strong> was <strong>approved</strong>.');
  });

  it('words a request for a higher role', () => {
    const email = accessRequestOutcomeEmail({ ...base, requestedRole: 'Manager', decision: 'rejected' });
    expect(email.subject).toBe('Your Manager request for Demo Sound was rejected');
    expect(email.html).toContain('Your request for <strong>Manager</strong> access on <strong>Demo Sound</strong> was <strong>rejected</strong>.');
  });

  it('escapes the name, the organization and the reply, which people type', () => {
    const email = accessRequestOutcomeEmail({
      ...base,
      firstName: '<img src=x>',
      orgName: 'A & <B>',
      responseMessage: 'See <a href="https://example.com">this</a>',
    });
    expect(email.html).not.toMatch(/<img|<a |<B>/);
    expect(email.html).toContain('Hi &lt;img src=x&gt;,');
    expect(email.html).toContain('<strong>A &amp; &lt;B&gt;</strong>');
    expect(email.html).toContain('<p>See &lt;a href=&quot;https://example.com&quot;&gt;this&lt;/a&gt;</p>');
  });

  it('keeps the subject on one line', () => {
    expect(accessRequestOutcomeEmail({ ...base, orgName: 'Evil\r\nBcc: x@example.com' }).subject).not.toMatch(/[\r\n]/);
  });
});
