/**
 * A stored link, for an href, src or window.open: the address when it's a full http(s) URL of
 * 2,048 characters or fewer, else undefined. Parsed as the browser would, so tabs, newlines and
 * capitals in the scheme are seen through.
 */
export const MAX_URL_LENGTH = 2048;

export function safeHref(url: string | null | undefined): string | undefined {
  const value = url?.trim();
  if (!value || value.length > MAX_URL_LENGTH) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return undefined;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return undefined;
  if (!parsed.hostname) return undefined;
  return parsed.href;
}
