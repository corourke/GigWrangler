import { Filter, LayoutList, Search, TableProperties, X } from 'lucide-react';
import { Card } from '../../ui/card';
import { Button } from '../../ui/button';
import { Input } from '../../ui/input';
import { Label } from '../../ui/label';
import { Alert } from '../../ui/alert';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../ui/select';
import { DATE_PRESETS } from './purchaseFilters';
import type { PurchaseFilters } from './usePurchaseFilters';

const money = (n: number) => `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** The banner shown instead of the filters when a gig's money row opened one purchase. */
export function LinkedReceiptBanner({ onClear }: { onClear: () => void }) {
  return (
    <Alert className="bg-sky-50 border-sky-200 py-6 px-6 flex items-center justify-between gap-6 shadow-sm border-l-4 border-l-sky-500">
      <div className="flex items-center gap-4 text-sky-900">
        <div className="bg-sky-100 p-3 rounded-xl text-sky-600 shadow-inner">
          <Filter className="w-6 h-6" />
        </div>
        <div className="space-y-1">
          <h3 className="text-lg font-bold leading-none tracking-tight">Viewing Linked Receipt</h3>
          <p className="text-sm text-sky-700/90 font-medium">
            Showing specific record linked from <span className="font-bold underline decoration-sky-300 underline-offset-2">Gig Financials</span>.
          </p>
        </div>
      </div>
      <Button
        variant="outline"
        className="border-sky-300 text-sky-600 hover:bg-sky-100 hover:text-sky-700 bg-white shadow-sm px-6 h-11 text-sm font-semibold transition-all hover:scale-[1.02] active:scale-[0.98]"
        onClick={onClear}
      >
        <X className="w-4 h-4 mr-2" />
        Clear Filter & Show All
      </Button>
    </Alert>
  );
}

interface PurchaseFiltersBarProps {
  filters: PurchaseFilters;
  viewMode: 'detailed' | 'summary';
  onViewModeChange: (mode: 'detailed' | 'summary') => void;
}

/** Vendor, type and period filters, the view switch, and the filtered and all-time totals. */
export default function PurchaseFiltersBar({ filters, viewMode, onViewModeChange }: PurchaseFiltersBarProps) {
  const { totals, allTimeTotals, filtersAreDefault, datePreset } = filters;
  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-end gap-4">
        <div className="flex-1 min-w-[200px]">
          <Label htmlFor="vendor-filter" className="text-xs">Vendor</Label>
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-gray-400" />
            <Input
              id="vendor-filter"
              placeholder="Search vendor..."
              className="pl-9 h-9 text-sm"
              value={filters.vendorFilter}
              onChange={(e) => filters.setVendorFilter(e.target.value)}
            />
          </div>
        </div>

        <div className="w-40">
          <Label className="text-xs">Type</Label>
          <Select value={filters.typeFilter} onValueChange={(v: any) => filters.setTypeFilter(v)}>
            <SelectTrigger className="h-9 text-sm" aria-label="Type">
              <SelectValue placeholder="All Types" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types</SelectItem>
              <SelectItem value="expense">Expensed</SelectItem>
              <SelectItem value="depreciate">Depreciated</SelectItem>
              <SelectItem value="equipment">Equipment</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="w-36">
          <Label className="text-xs">From</Label>
          <Input
            type="date"
            className="h-9 text-sm"
            value={filters.startDate}
            onChange={(e) => filters.setStartDateByHand(e.target.value)}
          />
        </div>
        <div className="w-36">
          <Label className="text-xs">To</Label>
          <Input
            type="date"
            className="h-9 text-sm"
            value={filters.endDate}
            onChange={(e) => filters.setEndDateByHand(e.target.value)}
          />
        </div>

        <div className="flex items-end gap-1 border rounded-md p-0.5">
          <Button
            variant={viewMode === 'detailed' ? 'default' : 'ghost'}
            size="sm"
            className="h-8 w-8 p-0"
            onClick={() => onViewModeChange('detailed')}
            title="Detailed view"
          >
            <LayoutList className="w-4 h-4" />
          </Button>
          <Button
            variant={viewMode === 'summary' ? 'default' : 'ghost'}
            size="sm"
            className="h-8 w-8 p-0"
            onClick={() => onViewModeChange('summary')}
            title="Summary view"
          >
            <TableProperties className="w-4 h-4" />
          </Button>
        </div>

      </div>

      <div className="flex flex-wrap items-center gap-1.5 mt-3">
        {DATE_PRESETS.map(({ key, label }) => {
          const isActive = datePreset === key;
          return (
            <button
              key={key}
              type="button"
              aria-pressed={isActive}
              onClick={() => filters.applyDatePreset(key)}
              className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                isActive
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-white text-gray-600 border-gray-300 hover:border-gray-400 hover:text-gray-800'
              }`}
            >
              {label}
            </button>
          );
        })}
        {!filtersAreDefault && (
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-muted-foreground" onClick={filters.clearAllFilters}>
            <X className="w-3.5 h-3.5 mr-1" />
            Clear all filters
          </Button>
        )}
        <div className="ml-auto flex gap-3 px-3 py-1.5 bg-gray-50 rounded-lg border border-gray-100" data-testid="purchase-totals">
          <div className="text-center">
            <p className="text-[10px] uppercase text-gray-500 font-semibold">{filtersAreDefault ? 'Last 30 days' : 'Filtered'}</p>
            <p className="text-lg font-bold text-gray-900">{money(totals.totalCost)}</p>
          </div>
          <div className="w-px bg-gray-200" />
          <div className="text-center">
            <p className="text-[10px] uppercase text-gray-500 font-semibold">Depreciated</p>
            <p className="text-lg font-bold text-blue-600">{totals.depreciatedCount}</p>
          </div>
          <div className="w-px bg-gray-200" />
          <div className="text-center">
            <p className="text-[10px] uppercase text-gray-500 font-semibold">Expensed</p>
            <p className="text-lg font-bold text-orange-600">{totals.expensedCount}</p>
          </div>
          <div className="w-px bg-gray-200" />
          <div className="text-center" data-testid="purchase-totals-all-time">
            <p className="text-[10px] uppercase text-gray-500 font-semibold">All time</p>
            <p className="text-lg font-bold text-gray-500">{money(allTimeTotals.totalCost)}</p>
            <p className="text-[10px] text-gray-500">{allTimeTotals.depreciatedCount} depreciated · {allTimeTotals.expensedCount} expensed</p>
          </div>
        </div>
      </div>
    </Card>
  );
}
