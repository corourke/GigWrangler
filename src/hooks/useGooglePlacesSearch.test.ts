import { describe, it, expect } from 'vitest';
import { placeToOrganizationFields, type GooglePlace } from './useGooglePlacesSearch';

const place = (website?: string): GooglePlace => ({ place_id: 'p1', name: 'Example Hall', formatted_address: '1 Main St', website } as GooglePlace);

describe('placeToOrganizationFields: website', () => {
  it('keeps an http(s) website', () => {
    expect(placeToOrganizationFields(place('https://example.com/')).url).toBe('https://example.com/');
  });

  it('leaves the website blank when it is missing or not http(s)', () => {
    expect(placeToOrganizationFields(place()).url).toBe('');
    expect(placeToOrganizationFields(place('javascript:alert(1)')).url).toBe('');
    expect(placeToOrganizationFields(place('example.com')).url).toBe('');
  });
});
