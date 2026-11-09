import { useMemo, useState } from 'react';
import type { DbPurchase } from '../../../utils/supabase/types';
import {
  DEFAULT_DATE_PRESET,
  groupPurchases,
  presetRange,
  purchaseTotals,
  type DatePreset,
  type PurchaseTypeFilter,
} from './purchaseFilters';

/**
 * The Purchases report's filters (vendor, type, period) and what they leave on screen.
 * The report opens on the last 30 days so the list stays short; a preset fills in
 * From/To, and typing a date by hand clears the preset.
 */
export function usePurchaseFilters(purchases: DbPurchase[], highlightPurchaseId: string | null, showOnlyHighlighted: boolean) {
  const [vendorFilter, setVendorFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState<PurchaseTypeFilter>('all');
  const [datePreset, setDatePreset] = useState<DatePreset | null>(DEFAULT_DATE_PRESET);
  const [startDate, setStartDate] = useState(() => presetRange(DEFAULT_DATE_PRESET).from);
  const [endDate, setEndDate] = useState(() => presetRange(DEFAULT_DATE_PRESET).to);

  // A highlighted id (from a gig's money row) is a purchase or one of its lines.
  const highlightedHeaderId = useMemo(() => {
    if (!highlightPurchaseId) return null;
    const p = purchases.find(x => x.id === highlightPurchaseId);
    return p?.parent_id ?? highlightPurchaseId;
  }, [purchases, highlightPurchaseId]);

  const filteredPurchases = useMemo(() => {
    return purchases.filter(p => {
      if (showOnlyHighlighted && highlightPurchaseId) {
        // The highlighted id is a purchase or one of its lines: show the whole purchase.
        return p.id === highlightedHeaderId || p.parent_id === highlightedHeaderId;
      }

      if (vendorFilter && !p.vendor?.toLowerCase().includes(vendorFilter.toLowerCase())) {
        return false;
      }

      if (startDate && p.purchase_date && p.purchase_date < startDate) return false;
      if (endDate && p.purchase_date && p.purchase_date > endDate) return false;

      return true;
    });
  }, [purchases, vendorFilter, startDate, endDate, showOnlyHighlighted, highlightPurchaseId, highlightedHeaderId]);

  const groupedPurchases = useMemo(() => groupPurchases(filteredPurchases, typeFilter), [filteredPurchases, typeFilter]);

  const totals = useMemo(() => purchaseTotals(groupedPurchases), [groupedPurchases]);
  const allTimeTotals = useMemo(() => purchaseTotals(groupPurchases(purchases, 'all')), [purchases]);

  const applyDatePreset = (preset: DatePreset) => {
    const { from, to } = presetRange(preset);
    setDatePreset(preset);
    setStartDate(from);
    setEndDate(to);
  };
  const filtersAreDefault = !vendorFilter && typeFilter === 'all' && datePreset === DEFAULT_DATE_PRESET;
  const clearAllFilters = () => {
    setVendorFilter('');
    setTypeFilter('all');
    applyDatePreset(DEFAULT_DATE_PRESET);
  };

  const highlightedGroupId = useMemo(() => {
    if (!highlightPurchaseId) return null;
    const asHeader = groupedPurchases.find(g => g.header.id === highlightPurchaseId);
    if (asHeader) return asHeader.header.id;
    const asChild = groupedPurchases.find(g => g.children.some(c => c.id === highlightPurchaseId));
    if (asChild) return asChild.header.id;
    return null;
  }, [highlightPurchaseId, groupedPurchases]);

  return {
    vendorFilter, setVendorFilter,
    typeFilter, setTypeFilter,
    datePreset,
    startDate, endDate,
    /** A date typed by hand clears the preset. */
    setStartDateByHand: (d: string) => { setStartDate(d); setDatePreset(null); },
    setEndDateByHand: (d: string) => { setEndDate(d); setDatePreset(null); },
    applyDatePreset,
    filtersAreDefault,
    clearAllFilters,
    groupedPurchases,
    totals,
    allTimeTotals,
    highlightedGroupId,
  };
}

export type PurchaseFilters = ReturnType<typeof usePurchaseFilters>;
