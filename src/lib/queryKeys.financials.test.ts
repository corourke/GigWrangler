import { describe, it, expect, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import {
  queryKeys,
  invalidateAfterPurchaseChange,
  invalidateAfterPurchaseEditorSave,
  invalidateAfterPurchaseDocumentChange,
  invalidateAfterTaxYearChange,
} from './queryKeys';

const invalidated = async (run: (qc: QueryClient) => Promise<unknown>) => {
  const qc = new QueryClient();
  const spy = vi.spyOn(qc, 'invalidateQueries');
  await run(qc);
  return spy.mock.calls.map((c) => c[0]?.queryKey);
};

// A10: the Financials block of keys, and its after-change helpers.
describe('Financials query keys (A10)', () => {
  it('keeps each organization\'s purchases under one root, and details under the entity', () => {
    for (const key of [
      queryKeys.purchasesReport('o1'), queryKeys.purchaseLinkedGigExpenses('o1', ['p1']),
      queryKeys.expenseCategories('o1'), queryKeys.equipmentCategories('o1'),
      queryKeys.equipmentCategoryPeriods('o1'), queryKeys.purchaseItemOptions('o1'),
    ]) expect(key.slice(0, 2)).toEqual(queryKeys.purchases('o1'));
    expect(queryKeys.purchaseForEdit('p1', 'o1').slice(0, 2)).toEqual(['purchase', 'p1']);
    expect(queryKeys.purchaseDocuments('p1').slice(0, 2)).toEqual(['purchase', 'p1']);
    expect(queryKeys.lockedTaxYears('o1').slice(0, 2)).toEqual(queryKeys.taxYears('o1'));
    expect(queryKeys.taxYearDepreciation('o1').slice(0, 2)).toEqual(queryKeys.taxYears('o1'));
    expect(queryKeys.gigAccounting('o1').slice(0, 2)).toEqual(queryKeys.gigs('o1'));
    expect(queryKeys.gigPickerOptions('o1', '2026-01-02', 'g1').slice(0, 2)).toEqual(queryKeys.gigs('o1'));
    expect(queryKeys.purchasePanelAsset('a1').slice(0, 2)).toEqual(queryKeys.asset('a1'));
    expect(queryKeys.purchasePanelGig('g1', 'o1').slice(0, 2)).toEqual(queryKeys.gig('g1'));
  });

  it('the gig picker and the gig names never share a cache entry (their data differ)', () => {
    expect(queryKeys.gigPickerOptions('o1')).not.toEqual(queryKeys.gigOptions('o1'));
  });

  it('a purchase written from the report refreshes the purchases, the purchase, the tax report, Gig Accounting, equipment, the dashboard and the gigs it touched', async () => {
    expect(await invalidated((qc) => invalidateAfterPurchaseChange(qc, { organizationId: 'o1', purchaseId: 'p1', gigIds: ['g1', null, 'g1', 'g2'] }))).toEqual([
      ['purchases', 'o1'], ['purchase', 'p1'], ['taxReport', 'o1'], ['gigs', 'o1', 'accounting'], ['assets', 'o1'], ['dashboard', 'o1'],
      ['financials', 'g1'], ['gigFinancialsSummary', 'g1'], ['financials', 'g2'], ['gigFinancialsSummary', 'g2'],
    ]);
  });

  it('when the gigs are not known, every gig\'s money is refreshed', async () => {
    const keys = await invalidated((qc) => invalidateAfterPurchaseChange(qc, { organizationId: 'o1', allGigs: true }));
    expect(keys).toContainEqual(['financials']);
    expect(keys).toContainEqual(['gigFinancialsSummary']);
  });

  it('a save in the editor leaves the purchases report to its screen', async () => {
    const keys = await invalidated((qc) => invalidateAfterPurchaseEditorSave(qc, { organizationId: 'o1', purchaseId: 'p1', gigIds: ['g1'] }));
    expect(keys).toEqual([
      ['purchase', 'p1'], ['taxReport', 'o1'], ['gigs', 'o1', 'accounting'], ['assets', 'o1'], ['dashboard', 'o1'],
      ['financials', 'g1'], ['gigFinancialsSummary', 'g1'],
    ]);
    expect(keys).not.toContainEqual(['purchases', 'o1']);
  });

  it('a tax year or its figures saved refreshes the years, filed years and figures (one root)', async () => {
    expect(await invalidated((qc) => invalidateAfterTaxYearChange(qc, 'o1'))).toEqual([['taxYears', 'o1']]);
  });

  it('a document attached refreshes that purchase\'s documents', async () => {
    expect(await invalidated((qc) => invalidateAfterPurchaseDocumentChange(qc, 'h1'))).toEqual([['purchase', 'h1', 'documents']]);
  });
});
