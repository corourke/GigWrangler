import { describe, it, expect } from 'vitest';
import { queryKeys, financialsInvalidation } from './queryKeys';

// A10: the Financials block of the key hierarchy, and its invalidation map.
describe('Financials query keys (A10)', () => {
  it('scopes lists by organization and details by entity, under the existing roots', () => {
    expect(queryKeys.purchasesReport('o1')).toEqual(['purchases', 'o1', 'report']);
    expect(queryKeys.purchasesReport('o1').slice(0, 2)).toEqual(queryKeys.purchases('o1'));
    expect(queryKeys.purchaseForEdit('p1')).toEqual(['purchase', 'p1', 'edit']);
    expect(queryKeys.lockedTaxYears('o1').slice(0, 2)).toEqual(queryKeys.taxYears('o1'));
    expect(queryKeys.gigPickerOptions('o1', '2026-01-02', 'g1').slice(0, 2)).toEqual(queryKeys.gigOptions('o1'));
    expect(queryKeys.purchasePanelAsset('a1').slice(0, 2)).toEqual(queryKeys.asset('a1'));
    expect(queryKeys.purchasePanelGig('g1', 'o1').slice(0, 2)).toEqual(queryKeys.gig('g1'));
  });

  it('the gig picker and the gig names never share a cache entry (their data differ)', () => {
    expect(queryKeys.gigPickerOptions('o1')).not.toEqual(queryKeys.gigOptions('o1'));
  });

  it('a purchase written from the report refreshes the report, the purchase, the tax report, Gig Accounting and the gigs it touched', () => {
    expect(financialsInvalidation.purchaseWritten('o1', { purchaseId: 'p1', gigIds: ['g1', null, 'g1', 'g2'] })).toEqual([
      ['purchases', 'o1'], ['purchase', 'p1'], ['taxReport', 'o1'], ['gigAccounting', 'o1'],
      ['financials', 'g1'], ['gigFinancialsSummary', 'g1'], ['financials', 'g2'], ['gigFinancialsSummary', 'g2'],
    ]);
  });

  it('when the gigs are not known, every gig\'s money is refreshed', () => {
    expect(financialsInvalidation.purchaseWritten('o1', { allGigs: true })).toEqual([
      ['purchases', 'o1'], ['taxReport', 'o1'], ['gigAccounting', 'o1'], ['financials'], ['gigFinancialsSummary'],
    ]);
  });

  it('a save in the editor leaves the report to its screen', () => {
    const keys = financialsInvalidation.purchaseSaved('o1', { purchaseId: 'p1', gigIds: ['g1'] });
    expect(keys).toEqual([['purchase', 'p1'], ['gigAccounting', 'o1'], ['financials', 'g1'], ['gigFinancialsSummary', 'g1']]);
    expect(keys).not.toContainEqual(['purchases', 'o1']);
  });

  it('a tax year or its figures saved refreshes the years (filed ones too) and the figures', () => {
    expect(financialsInvalidation.taxYearWritten('o1')).toEqual([['taxYears', 'o1'], ['taxYearDepreciation', 'o1']]);
  });
});
