import { describe, it, expect } from 'vitest';
import { suggestedAsEquipment } from './scanSuggestion';

// How a scanned line's suggestion becomes the "track as equipment" switch (B18).
describe('suggestedAsEquipment', () => {
  it("is on for the scan's equipment suggestion", () => {
    expect(suggestedAsEquipment({ suggested_type: 'Asset', is_durable: true })).toBe(true);
  });
  it('is off for an expense suggestion, even for a durable item', () => {
    expect(suggestedAsEquipment({ suggested_type: 'Expense', is_durable: true })).toBe(false);
  });
  it('is off with no suggestion', () => {
    expect(suggestedAsEquipment({})).toBe(false);
  });
  it('keeps a choice already made on the line', () => {
    expect(suggestedAsEquipment({ is_asset: true, suggested_type: 'Expense' })).toBe(true);
    expect(suggestedAsEquipment({ is_asset: false, suggested_type: 'Asset' })).toBe(false);
  });
});
