/**
 * An organization's website as sent to the API: a full http(s) link of 2,048 characters or fewer,
 * trimmed, or blank (cleared). The database holds the same rule as a check constraint.
 */
export const MAX_WEBSITE_URL_LENGTH = 2048;

export type WebsiteUrlResult = { ok: true; value: string | null } | { ok: false; error: string };

export function normalizeWebsiteUrl(input: unknown): WebsiteUrlResult {
  if (input === null || input === undefined) return { ok: true, value: null };
  if (typeof input !== 'string') return { ok: false, error: 'Website must be a link starting with http:// or https://' };
  const value = input.trim();
  if (value === '') return { ok: true, value: null };
  if (value.length > MAX_WEBSITE_URL_LENGTH) return { ok: false, error: 'Website link is too long (2,048 characters at most)' };
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return { ok: false, error: 'Website must be a link starting with http:// or https://' };
  }
  if (!/^https?:\/\//i.test(value) || (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || !parsed.hostname) {
    return { ok: false, error: 'Website must be a link starting with http:// or https://' };
  }
  return { ok: true, value };
}
