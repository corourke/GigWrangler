/** Links for the day-of-show sheet (§3e): call, text and directions. */

type Address = {
  name?: string | null;
  address_line1?: string | null;
  address_line2?: string | null;
  city?: string | null;
  state?: string | null;
  postal_code?: string | null;
};

/** The number as a phone dials it: digits, a leading +, and an extension after a pause (","). */
function dialable(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const [main, ext] = phone.split(/\s*(?:ext\.?|x|#)\s*/i);
  const digits = main.replace(/[^\d+]/g, '').replace(/(?!^)\+/g, '');
  if (digits.replace('+', '').length < 3) return null;
  const extDigits = (ext ?? '').replace(/\D/g, '');
  return extDigits ? `${digits},${extDigits}` : digits;
}

export const telHref = (phone: string | null | undefined): string | null => {
  const n = dialable(phone);
  return n ? `tel:${n}` : null;
};

export const smsHref = (phone: string | null | undefined): string | null => {
  const n = dialable(phone)?.split(',')[0];
  return n ? `sms:${n}` : null;
};

/** The street lines, then "City, ST 12345". */
export function addressLines(a: Address | null | undefined): string[] {
  if (!a) return [];
  const cityLine = [a.city, [a.state, a.postal_code].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  return [a.address_line1, a.address_line2, cityLine].filter((l): l is string => !!l);
}

const isApple = (ua: string) => /iPhone|iPad|iPod|Macintosh/i.test(ua);

/** A maps search for the place: Apple Maps on Apple devices, Google Maps elsewhere. Null with no address. */
export function mapsHref(a: Address | null | undefined, userAgent: string = typeof navigator !== 'undefined' ? navigator.userAgent : ''): string | null {
  if (!a || !(a.address_line1 || a.city)) return null;
  const q = encodeURIComponent([a.name, ...addressLines(a)].filter(Boolean).join(', '));
  return isApple(userAgent) ? `https://maps.apple.com/?q=${q}` : `https://www.google.com/maps/search/?api=1&query=${q}`;
}
