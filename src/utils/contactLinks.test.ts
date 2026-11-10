import { describe, it, expect } from 'vitest';
import { telHref, smsHref, mapsHref, addressLines } from './contactLinks';

describe('contact links (day-of-show sheet)', () => {
  it('dials only the characters a phone number can hold', () => {
    expect(telHref('(555) 010-0100')).toBe('tel:5550100100');
    expect(telHref('+1 555.010.0100 ext 2')).toBe('tel:+15550100100,2');
    expect(telHref('')).toBeNull();
    expect(telHref(null)).toBeNull();
    expect(telHref('call the office')).toBeNull();
  });

  it('texts the same number', () => {
    expect(smsHref('+1 (555) 010-0100')).toBe('sms:+15550100100');
    expect(smsHref(undefined)).toBeNull();
  });

  const venue = { name: 'Test Hall', address_line1: '1 Main St', city: 'Town', state: 'CA', postal_code: '90000' };

  it('writes the address as lines', () => {
    expect(addressLines(venue)).toEqual(['1 Main St', 'Town, CA 90000']);
    expect(addressLines({ name: 'X' })).toEqual([]);
  });

  it('links Apple Maps on an iPhone and Google Maps elsewhere', () => {
    const iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)';
    const android = 'Mozilla/5.0 (Linux; Android 15; Pixel 9)';
    expect(mapsHref(venue, iphone)).toBe('https://maps.apple.com/?q=Test%20Hall%2C%201%20Main%20St%2C%20Town%2C%20CA%2090000');
    expect(mapsHref(venue, android)).toBe('https://www.google.com/maps/search/?api=1&query=Test%20Hall%2C%201%20Main%20St%2C%20Town%2C%20CA%2090000');
  });

  it('has no directions without a street or city', () => {
    expect(mapsHref({ name: 'Test Hall' }, 'iPhone')).toBeNull();
    expect(mapsHref(null, 'iPhone')).toBeNull();
  });
});
