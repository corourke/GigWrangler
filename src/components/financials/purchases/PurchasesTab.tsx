import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  Receipt,
  Search,
  Filter,
  ChevronDown,
  ChevronRight,
  FileText,
  X,
  RefreshCw,
  Upload,
  Loader2,
  Music,
  Package,
  Plus,
  Pencil,
  Trash2,
  LayoutList,
  TableProperties,
} from 'lucide-react';
import { Card } from '../../ui/card';
import { Button } from '../../ui/button';
import { Input } from '../../ui/input';
import { Label } from '../../ui/label';
import { Badge } from '../../ui/badge';
import { Alert } from '../../ui/alert';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../ui/select';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '../../ui/alert-dialog';
import { Organization, User, UserRole, DbPurchase } from '../../../utils/supabase/types';
import { lineTaxTreatment } from '../../../utils/taxTreatment';
import {
  getPurchases,
  trackPurchaseLineAsEquipment,
  deletePurchase,
  getLinkedGigExpenses,
  updatePurchase,
  reconcileLedgerForLineGigChange,
  createLedgerEntryForPurchaseLine,
  removeLedgerEntriesForPurchaseLine,
  purchaseLineLedgerAmount,
} from '../../../services/purchase.service';
import { getEntityAttachments, uploadAttachment, linkAttachmentToEntity } from '../../../services/attachment.service';
import { getGigOptionsForOrganization, getGigFinancialsByPurchaseId, getPurchaseIdsWithLedgerEntry } from '../../../services/gig.service';
import { toast } from 'sonner';
import { isSyntheticHeader } from './reconciliation';
import PurchaseDetailPanel, { PanelState } from './PurchaseDetailPanel';
import ReviewScannedDataDialog from '../../ReviewScannedDataDialog';
import PurchaseSummaryView from './PurchaseSummaryView';
import GigCombobox from './GigCombobox';
import {
  DATE_PRESETS,
  DEFAULT_DATE_PRESET,
  groupPurchases,
  presetRange,
  purchaseTotals,
  type DatePreset,
  type PurchaseTypeFilter,
} from './purchaseFilters';
import { ATTACHMENT_FILE_ACCEPT } from '../../../utils/fileAccept';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** A purchase date (YYYY-MM-DD) split for the date block on each purchase card. */
function dateBlock(date: string | null | undefined): { mon: string; day: string; year: string } {
  const [y, m, d] = (date ?? '').split('-');
  return { mon: MONTHS[Number(m) - 1] ?? '', day: d ? String(Number(d)) : '', year: y ?? '' };
}

const money = (n: number) => `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

interface PurchasesTabProps {
  organization: Organization;
  user: User;
  userRole?: UserRole;
  highlightPurchaseId?: string | null;
  returnGigId?: string | null;
  onNavigateToGigDetail?: (gigId: string) => void;
  onNavigateToAssetDetail?: (assetId: string) => void;
  onEditAsset?: (assetId: string) => void;
  /** Bumped by PurchasesSection after a purchase was added on another tab; reloads the list. */
  reloadToken?: number;
  /** Open the Add purchase / Scan invoices screens (offered from the empty state). */
  onAddManually?: () => void;
  onScanInvoices?: () => void;
}

export default function PurchasesTab({
  organization,
  user,
  userRole,
  highlightPurchaseId: initialHighlightId,
  returnGigId,
  onNavigateToGigDetail,
  onNavigateToAssetDetail,
  onEditAsset,
  reloadToken = 0,
  onAddManually,
  onScanInvoices,
}: PurchasesTabProps) {
  const [purchases, setPurchases] = useState<DbPurchase[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [expandedItemId, setExpandedItemId] = useState<string | null>(null);
  const [trackingItemId, setTrackingItemId] = useState<string | null>(null);
  const [assigningGigItemId, setAssigningGigItemId] = useState<string | null>(null);
  const [ledgerPrompt, setLedgerPrompt] = useState<{ item: DbPurchase; gigId: string; gigTitle?: string } | null>(null);
  const [creatingLedger, setCreatingLedger] = useState(false);
  // Confirm dialog shown when clearing a line's gig would strand its ledger entry.
  const [clearLedgerConfirm, setClearLedgerConfirm] = useState<
    { item: DbPurchase; financialIds: string[]; fromGigId: string; amount: number } | null
  >(null);
  const [clearingLedger, setClearingLedger] = useState(false);
  const [isUploadingAttachment, setIsUploadingAttachment] = useState<string | null>(null);
  const [highlightPurchaseId, setHighlightPurchaseId] = useState<string | null>(initialHighlightId || null);
  const [showOnlyHighlighted, setShowOnlyHighlighted] = useState(!!initialHighlightId);

  useEffect(() => {
    if (initialHighlightId) {
      setHighlightPurchaseId(initialHighlightId);
      setShowOnlyHighlighted(true);
    }
  }, [initialHighlightId]);

  // Filters
  const [vendorFilter, setVendorFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState<PurchaseTypeFilter>('all');
  // The report opens on the last 30 days so the list stays short; a preset fills
  // in From/To, and typing a date by hand clears the preset.
  const [datePreset, setDatePreset] = useState<DatePreset | null>(DEFAULT_DATE_PRESET);
  const [startDate, setStartDate] = useState(() => presetRange(DEFAULT_DATE_PRESET).from);
  const [endDate, setEndDate] = useState(() => presetRange(DEFAULT_DATE_PRESET).to);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [activeUploadHeaderId, setActiveUploadHeaderId] = useState<string | null>(null);
  const [panelState, setPanelState] = useState<PanelState>({ mode: 'closed' });
  const [reviewDialogOpen, setReviewDialogOpen] = useState(false);
  const [editPurchaseId, setEditPurchaseId] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<{ type: 'header' | 'item'; purchase: DbPurchase; childCount?: number; purchaseIds: string[] } | null>(null);
  // The gig expenses the delete removes with it (B2), for the confirm.
  const [deleteLinked, setDeleteLinked] = useState<{ entries: number; gigs: number; amount: number } | null>(null);
  useEffect(() => {
    setDeleteLinked(null);
    if (!deleteConfirm) return;
    let cancelled = false;
    getLinkedGigExpenses(deleteConfirm.purchaseIds)
      .then((linked) => { if (!cancelled) setDeleteLinked(linked); })
      .catch((err) => console.error('Could not read the linked gig expenses:', err));
    return () => { cancelled = true; };
  }, [deleteConfirm]);
  const [viewMode, setViewMode] = useState<'detailed' | 'summary'>('detailed');
  const [gigNames, setGigNames] = useState<Map<string, string>>(new Map());

  const toggleGroup = useCallback((groupId: string) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  }, []);

  useEffect(() => {
    loadPurchases();
  }, [organization.id, reloadToken]);

  useEffect(() => {
    getGigOptionsForOrganization(organization.id)
      .then((gigs) => {
        const map = new Map<string, string>();
        gigs.forEach(g => map.set(g.id, g.title));
        setGigNames(map);
      })
      .catch(() => {});
  }, [organization.id]);

  const [headerAttachments, setHeaderAttachments] = useState<Map<string, { filePath: string; fileName: string }>>(new Map());
  // Expense-line ids that are linked to a gig but have no ledger entry yet — drives
  // the persistent "Add to gig ledger" affordance in the line detail.
  const [linesWithLedger, setLinesWithLedger] = useState<Set<string>>(new Set());

  async function loadPurchases() {
    setIsLoading(true);
    try {
      const data = await getPurchases(organization.id);
      setPurchases(data);

      const gigLinkedItemIds = data
        .filter((p: DbPurchase) => lineTaxTreatment(p) === 'expense' && p.gig_id)
        .map((p: DbPurchase) => p.id);
      setLinesWithLedger(await getPurchaseIdsWithLedgerEntry(gigLinkedItemIds));

      const headers = data.filter((p: DbPurchase) => p.row_type === 'header');
      const attMap = new Map<string, { filePath: string; fileName: string }>();
      await Promise.all(headers.map(async (h: DbPurchase) => {
        try {
          const atts = await getEntityAttachments('purchase', h.id);
          if (atts && atts.length > 0) {
            attMap.set(h.id, { filePath: atts[0].file_path, fileName: atts[0].file_name });
          }
        } catch (_) { /* ignore */ }
      }));
      setHeaderAttachments(attMap);
    } catch (error) {
      console.error('Error loading purchases:', error);
      toast.error('Failed to load purchases');
    } finally {
      setIsLoading(false);
    }
  }

  const handleViewDoc = (headerId: string) => {
    setPanelState({ mode: 'document', headerId });
  };

  const triggerFileUpload = (headerId: string) => {
    setActiveUploadHeaderId(headerId);
    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  };

  const handleAttachFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const headerId = activeUploadHeaderId;

    if (!file || !headerId) return;

    setIsUploadingAttachment(headerId);
    try {
      const attachment = await uploadAttachment(organization.id, file);
      await linkAttachmentToEntity(attachment.id, 'purchase', headerId);

      toast.success('File attached successfully');

      setHeaderAttachments(prev => {
        const next = new Map(prev);
        next.set(headerId, { filePath: attachment.file_path, fileName: attachment.file_name });
        return next;
      });
    } catch (err: any) {
      console.error('Error attaching file:', err);
      toast.error(err.message || 'Failed to attach file');
    } finally {
      setIsUploadingAttachment(null);
      setActiveUploadHeaderId(null);
      if (e.target) e.target.value = '';
    }
  };

  // Start tracking a line as equipment (#133). Its tax treatment doesn't change.
  const handleTrackAsEquipment = async (itemId: string) => {
    setTrackingItemId(itemId);
    try {
      await trackPurchaseLineAsEquipment(itemId);
      toast.success('Now tracked as equipment');
      loadPurchases();
    } catch (err: any) {
      toast.error(err.message || 'Failed to track the item as equipment');
    } finally {
      setTrackingItemId(null);
    }
  };

  const handleAssignGig = async (item: DbPurchase, gigId: string | null, gigTitle?: string) => {
    const previousGigId = item.gig_id || null;
    if (gigId === previousGigId) return;

    // Clearing a line's gig: if a ledger entry was auto-created for it, deleting
    // it is destructive, so confirm first and only touch the purchase row once
    // the user has decided. Aborting the confirm leaves both in place.
    if (!gigId) {
      const linked = await getGigFinancialsByPurchaseId(item.id);
      if (linked.length > 0) {
        setClearLedgerConfirm({
          item,
          financialIds: linked.map((f) => f.id),
          fromGigId: linked[0].gig_id,
          amount: linked.reduce((sum, f) => sum + (Number(f.amount) || 0), 0),
        });
        return;
      }
    }

    setAssigningGigItemId(item.id);
    try {
      await updatePurchase(item.id, { gig_id: gigId });

      if (gigId) {
        const res = await reconcileLedgerForLineGigChange({
          item,
          previousGigId,
          newGigId: gigId,
          organizationId: organization.id,
        });
        if (res.action === 'needs-entry') {
          toast.success(`Assigned to ${gigTitle || 'gig'}`);
          setLedgerPrompt({ item, gigId, gigTitle });
        } else if (res.action === 'moved') {
          window.dispatchEvent(new CustomEvent('gig-financials-updated', {}));
          toast.success(`Moved to ${gigTitle || 'gig'} — its ledger entry moved too`);
        } else {
          toast.success(`Assigned to ${gigTitle || 'gig'} — already in the ledger`);
        }
      } else {
        toast.success('Gig association removed');
      }

      await loadPurchases();
    } catch (err: any) {
      toast.error(err.message || 'Failed to assign gig');
      await loadPurchases();
    } finally {
      setAssigningGigItemId(null);
    }
  };

  // Persistent affordance: create the ledger entry for a line that is linked to a
  // gig but has none (e.g. the user skipped the prompt, or it came from import).
  const handleAddLineToLedger = async (item: DbPurchase) => {
    if (!item.gig_id) return;
    setAssigningGigItemId(item.id);
    try {
      const { created } = await createLedgerEntryForPurchaseLine(item, item.gig_id, organization.id);
      window.dispatchEvent(new CustomEvent('gig-financials-updated', { detail: { gigId: item.gig_id } }));
      toast.success(created ? 'Added to the gig ledger' : 'This line is already in the gig ledger');
      await loadPurchases();
    } catch (err: any) {
      toast.error(err.message || 'Failed to add to gig ledger');
    } finally {
      setAssigningGigItemId(null);
    }
  };

  const handleConfirmClearLedger = async () => {
    if (!clearLedgerConfirm) return;
    const { item, financialIds, fromGigId } = clearLedgerConfirm;
    setClearingLedger(true);
    try {
      await updatePurchase(item.id, { gig_id: null });
      await removeLedgerEntriesForPurchaseLine(financialIds);
      window.dispatchEvent(new CustomEvent('gig-financials-updated', { detail: { gigId: fromGigId } }));
      toast.success('Gig association and its ledger entry removed');
      setClearLedgerConfirm(null);
      await loadPurchases();
    } catch (err: any) {
      toast.error(err.message || 'Failed to remove gig association');
    } finally {
      setClearingLedger(false);
    }
  };

  const handleCreateLedgerEntry = async () => {
    if (!ledgerPrompt) return;
    const { item, gigId } = ledgerPrompt;
    setCreatingLedger(true);
    try {
      const { created } = await createLedgerEntryForPurchaseLine(item, gigId, organization.id);
      window.dispatchEvent(new CustomEvent('gig-financials-updated', { detail: { gigId } }));
      toast.success(created ? 'Gig expense ledger entry created' : 'This line is already in the gig ledger');
      setLedgerPrompt(null);
      await loadPurchases();
    } catch (err: any) {
      toast.error(err.message || 'Failed to create ledger entry');
    } finally {
      setCreatingLedger(false);
    }
  };

  // Filter and group purchases
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

  const getSiblingItemIds = useCallback((headerId: string) => {
    const group = groupedPurchases.find(g => g.header.id === headerId);
    if (!group) return [];
    // Only line items that have something to show in the panel (a linked asset
    // or gig) participate in Prev/Next stepping. Pure expense lines have no
    // panel view, so they're skipped rather than stalling the stepper.
    return group.children.filter(c => c.asset_id || c.gig_id).map(c => c.id);
  }, [groupedPurchases]);

  const getAssetIdForItem = useCallback((itemId: string) => {
    const item = purchases.find(p => p.id === itemId);
    return item?.asset_id || null;
  }, [purchases]);

  const getGigIdForItem = useCallback((itemId: string) => {
    const item = purchases.find(p => p.id === itemId);
    return item?.gig_id || null;
  }, [purchases]);

  const handleOpenAssetPanel = (item: DbPurchase) => {
    if (!item.asset_id) return;
    const parentId = item.parent_id || '';
    setPanelState({
      mode: 'asset',
      assetId: item.asset_id,
      itemId: item.id,
      siblingItemIds: getSiblingItemIds(parentId),
    });
  };

  const handleOpenGigPanel = (gigId: string, item?: DbPurchase) => {
    if (item) {
      const parentId = item.parent_id || '';
      setPanelState({
        mode: 'gig',
        gigId,
        itemId: item.id,
        siblingItemIds: getSiblingItemIds(parentId),
      });
    } else {
      setPanelState({ mode: 'gig', gigId });
    }
  };

  const isAdmin = userRole === 'Admin' || userRole === 'Manager';

  const handlePurchaseCreated = async (_purchaseId: string) => {
    await loadPurchases();
  };

  const handleEditHeader = (group: { header: DbPurchase; children: DbPurchase[] }) => {
    setEditPurchaseId(group.header.id);
    setReviewDialogOpen(true);
  };

  const handleDeleteConfirmed = async () => {
    if (!deleteConfirm) return;
    try {
      await deletePurchase(deleteConfirm.purchase.id);
      toast.success(deleteConfirm.type === 'header' ? 'Purchase deleted' : 'Line item deleted');
      await loadPurchases();
      setExpandedItemId(null);
    } catch (err: any) {
      toast.error(err.message || 'Failed to delete');
    } finally {
      setDeleteConfirm(null);
    }
  };

  const highlightRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (highlightedGroupId) {
      setCollapsedGroups(prev => {
        const next = new Set(prev);
        next.delete(highlightedGroupId);
        return next;
      });
      setTimeout(() => {
        highlightRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 100);
    }
  }, [highlightedGroupId]);

  return (
    <div className="space-y-6">
      {showOnlyHighlighted && highlightPurchaseId ? (
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
            onClick={() => {
              setShowOnlyHighlighted(false);
              setHighlightPurchaseId(null);
            }}
          >
            <X className="w-4 h-4 mr-2" />
            Clear Filter & Show All
          </Button>
        </Alert>
      ) : (
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
                  value={vendorFilter}
                  onChange={(e) => setVendorFilter(e.target.value)}
                />
              </div>
            </div>

            <div className="w-40">
              <Label className="text-xs">Type</Label>
              <Select value={typeFilter} onValueChange={(v: any) => setTypeFilter(v)}>
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
                value={startDate}
                onChange={(e) => { setStartDate(e.target.value); setDatePreset(null); }}
              />
            </div>
            <div className="w-36">
              <Label className="text-xs">To</Label>
              <Input
                type="date"
                className="h-9 text-sm"
                value={endDate}
                onChange={(e) => { setEndDate(e.target.value); setDatePreset(null); }}
              />
            </div>

            <div className="flex items-end gap-1 border rounded-md p-0.5">
              <Button
                variant={viewMode === 'detailed' ? 'default' : 'ghost'}
                size="sm"
                className="h-8 w-8 p-0"
                onClick={() => setViewMode('detailed')}
                title="Detailed view"
              >
                <LayoutList className="w-4 h-4" />
              </Button>
              <Button
                variant={viewMode === 'summary' ? 'default' : 'ghost'}
                size="sm"
                className="h-8 w-8 p-0"
                onClick={() => setViewMode('summary')}
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
                  onClick={() => applyDatePreset(key)}
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
              <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-muted-foreground" onClick={clearAllFilters}>
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
      )}

      {/* Purchases Table/List */}
      <div className="space-y-4">
        {isLoading ? (
          <div className="py-20 text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
            <p className="mt-2 text-gray-500">Loading purchases...</p>
          </div>
        ) : groupedPurchases.length === 0 ? (
          <Card className="p-12 text-center text-gray-500">
            <Receipt className="w-12 h-12 mx-auto text-gray-300 mb-4" />
            <p className="text-lg font-medium">No purchases found</p>
            {purchases.length > 0 ? (
              <p className="text-sm mb-4">
                Nothing matches these filters.{' '}
                {datePreset !== 'all' && (
                  <button type="button" className="text-sky-700 hover:underline" onClick={() => applyDatePreset('all')}>Show all time</button>
                )}
              </p>
            ) : (
              <p className="text-sm mb-4">Add a purchase or scan an invoice to get started.</p>
            )}
            {(onAddManually || onScanInvoices) && (
              <div className="flex justify-center gap-3">
                {onAddManually && (
                  <Button size="sm" variant="outline" onClick={onAddManually}>
                    <Plus className="w-4 h-4 mr-1.5" />
                    Add purchase
                  </Button>
                )}
                {onScanInvoices && (
                  <Button size="sm" className="bg-sky-700 hover:bg-sky-800 text-white" onClick={onScanInvoices}>
                    <Upload className="w-4 h-4 mr-1.5" />
                    Scan invoices
                  </Button>
                )}
              </div>
            )}
          </Card>
        ) : viewMode === 'summary' ? (
          <PurchaseSummaryView
            groups={groupedPurchases}
            headerAttachments={headerAttachments}
            gigNames={gigNames}
            onSelectGroup={(headerId) => {
              setViewMode('detailed');
              setCollapsedGroups(prev => {
                const next = new Set(prev);
                next.delete(headerId);
                return next;
              });
            }}
            onViewDoc={handleViewDoc}
          />
        ) : (
          <div className="space-y-5">
            {groupedPurchases.map((group) => {
              const { mon, day, year } = dateBlock(group.header.purchase_date);
              return (
              <div key={group.header.id} ref={highlightedGroupId === group.header.id ? highlightRef : undefined}>
              <Card
                className={`overflow-hidden gap-0 border-slate-300 shadow-md${highlightedGroupId === group.header.id ? ' ring-2 ring-sky-400 ring-offset-2' : ''}`}
              >
                {/* Design A (10-06): a tinted band with a date block, so each purchase's top is easy to find. */}
                <div className="bg-sky-50 px-4 py-2.5 border-b border-sky-200 flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="flex flex-col items-center justify-center w-12 h-12 rounded-lg bg-sky-700 text-white shrink-0" aria-label={group.header.purchase_date ?? undefined} title={group.header.purchase_date ?? undefined}>
                      <span className="text-[10px] font-semibold uppercase tracking-wider leading-none">{mon}</span>
                      <span className="text-lg font-bold leading-tight">{day}</span>
                    </div>
                    <div className="min-w-0">
                      <div className="text-base font-bold text-sky-900 truncate" title={group.header.vendor ?? undefined}>{group.header.vendor}</div>
                      <div className="text-xs text-slate-600 truncate" title={group.header.description ?? undefined}>
                        {[group.header.description, year].filter(Boolean).join(' · ')}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    {!isSyntheticHeader(group.header.id) && (
                      headerAttachments.has(group.header.id) ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-sky-600 hover:bg-sky-50"
                          onClick={() => handleViewDoc(group.header.id)}
                          title={`View ${headerAttachments.get(group.header.id)?.fileName || 'document'}`}
                        >
                          <FileText className="w-3.5 h-3.5 mr-1" />
                          <span className="text-[10px]">View Doc</span>
                        </Button>
                      ) : (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-gray-500 hover:text-sky-600 hover:bg-sky-50"
                          onClick={() => triggerFileUpload(group.header.id)}
                          disabled={isUploadingAttachment === group.header.id}
                          title="Attach a receipt or invoice PDF"
                        >
                          {isUploadingAttachment === group.header.id ? (
                            <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />
                          ) : (
                            <Upload className="w-3.5 h-3.5 mr-1" />
                          )}
                          <span className="text-[10px]">{isUploadingAttachment === group.header.id ? 'Attaching...' : 'Attach Doc'}</span>
                        </Button>
                      )
                    )}
                    <div className="text-right min-w-[96px]">
                      <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Invoice total</div>
                      <div className="text-base font-bold tabular-nums">${group.header.total_inv_amount?.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                    </div>
                    {isAdmin && !isSyntheticHeader(group.header.id) && (
                      <>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0 text-gray-400 hover:text-sky-600"
                          onClick={(e) => { e.stopPropagation(); handleEditHeader(group); }}
                          title="Edit purchase"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0 text-gray-400 hover:text-red-600"
                          onClick={(e) => { e.stopPropagation(); setDeleteConfirm({ type: 'header', purchase: group.header, childCount: group.children.length, purchaseIds: [group.header.id, ...group.children.map((c) => c.id)] }); }}
                          title="Delete purchase"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </>
                    )}
                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => toggleGroup(group.header.id)}>
                      {collapsedGroups.has(group.header.id) ? <ChevronRight className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    </Button>
                  </div>
                </div>

                {!collapsedGroups.has(group.header.id) && (
                <Table className="table-fixed">
                  <TableHeader className="bg-white">
                    <TableRow className="h-8 hover:bg-transparent">
                      <TableHead className="text-[10px] uppercase font-bold py-1 px-4 w-[112px]">Type</TableHead>
                      <TableHead className="text-[10px] uppercase font-bold py-1">Description / Model</TableHead>
                      <TableHead className="text-[10px] uppercase font-bold py-1 text-center w-[92px]">Equipment</TableHead>
                      <TableHead className="text-[10px] uppercase font-bold py-1 w-[200px]">Category</TableHead>
                      <TableHead className="text-[10px] uppercase font-bold py-1 text-center w-[56px]">Qty</TableHead>
                      <TableHead className="text-[10px] uppercase font-bold py-1 text-right w-[96px]">Price</TableHead>
                      <TableHead className="text-[10px] uppercase font-bold py-1 text-right w-[104px]">Cost</TableHead>
                      <TableHead className="text-[10px] uppercase font-bold py-1 w-8" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {group.children.map((item) => (
                      <React.Fragment key={item.id}>
                      <TableRow
                        className="h-9 hover:bg-sky-50 transition-colors cursor-pointer"
                        onClick={() => setExpandedItemId(expandedItemId === item.id ? null : item.id)}
                      >
                        <TableCell className="py-1 px-4">
                          {lineTaxTreatment(item) === 'depreciate' ? (
                            <Badge className="bg-blue-100 text-blue-700 hover:bg-blue-100 border-none text-[10px] h-5 px-1.5 uppercase font-bold">Depreciate</Badge>
                          ) : (
                            <Badge className="bg-orange-100 text-orange-700 hover:bg-orange-100 border-none text-[10px] h-5 px-1.5 uppercase font-bold">Expense</Badge>
                          )}
                        </TableCell>
                        <TableCell className="py-1 font-medium text-sm text-gray-800 truncate" title={item.description || undefined}>
                          {item.description || '-'}
                        </TableCell>
                        <TableCell className="py-1 text-center">
                          {item.asset_id && (
                            <Package role="img" aria-label="Tracked as equipment" className="w-4 h-4 text-sky-700 inline" />
                          )}
                        </TableCell>
                        <TableCell className="py-1 text-sm text-gray-600 truncate" title={item.category || undefined}>
                          {item.category || '-'}
                        </TableCell>
                        <TableCell className="py-1 text-sm text-center font-mono">
                          {item.quantity || '1'}
                        </TableCell>
                        <TableCell className="py-1 text-sm text-right font-mono text-gray-500">
                          {item.item_price ? `$${item.item_price.toFixed(2)}` : '-'}
                        </TableCell>
                        <TableCell className="py-1 text-sm text-right font-bold font-mono">
                          {item.line_cost ? `$${item.line_cost.toFixed(2)}` : '-'}
                        </TableCell>
                        <TableCell className="py-1 text-center">
                          {expandedItemId === item.id ? <ChevronDown className="w-3.5 h-3.5 text-gray-400 inline" /> : <ChevronRight className="w-3.5 h-3.5 text-gray-400 inline" />}
                        </TableCell>
                      </TableRow>
                      {expandedItemId === item.id && (
                        <TableRow className="bg-gray-50">
                          <TableCell colSpan={8} className="py-2 px-6 whitespace-normal">
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-1 text-xs">
                              <div><span className="text-gray-500 font-medium">Item Price:</span> {item.item_price != null ? `$${item.item_price.toFixed(2)}` : '-'}</div>
                              <div><span className="text-gray-500 font-medium">Item Cost:</span> {item.item_cost != null ? `$${item.item_cost.toFixed(2)}` : '-'}</div>
                              <div><span className="text-gray-500 font-medium">Line Amt:</span> {item.line_amount != null ? `$${item.line_amount.toFixed(2)}` : '-'}</div>
                              <div><span className="text-gray-500 font-medium">Line Cost:</span> {item.line_cost != null ? `$${item.line_cost.toFixed(2)}` : '-'}</div>
                              <div><span className="text-gray-500 font-medium">Category:</span> {item.category || '-'}</div>
                              <div><span className="text-gray-500 font-medium">Tax:</span> {lineTaxTreatment(item) === 'depreciate' ? 'Depreciate' : 'Expense'}</div>
                              <div><span className="text-gray-500 font-medium">Equipment:</span> {item.asset_id ? 'Yes' : 'No'}</div>
                              <div><span className="text-gray-500 font-medium">ID:</span> <span className="font-mono text-[10px]">{item.id}</span></div>
                              {item.asset_id && <div className="col-span-2"><span className="text-gray-500 font-medium">Asset ID:</span> <span className="font-mono text-[10px]">{item.asset_id}</span></div>}
                            </div>
                            <div className="mt-2 flex gap-2 flex-wrap">
                              {isAdmin && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="h-7 px-3 text-xs text-red-600 border-red-200 hover:bg-red-50"
                                  onClick={(e) => { e.stopPropagation(); setDeleteConfirm({ type: 'item', purchase: item, purchaseIds: [item.id] }); }}
                                >
                                  <Trash2 className="w-3 h-3 mr-1.5" />
                                  Delete Item
                                </Button>
                              )}
                              {item.asset_id && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="h-7 px-3 text-xs text-blue-600 border-blue-200 hover:bg-blue-50"
                                  onClick={(e) => { e.stopPropagation(); handleOpenAssetPanel(item); }}
                                >
                                  <Package className="w-3 h-3 mr-1.5" />
                                  Asset Details
                                </Button>
                              )}
                              {item.gig_id && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="h-7 px-3 text-xs text-purple-600 border-purple-200 hover:bg-purple-50"
                                  onClick={(e) => { e.stopPropagation(); handleOpenGigPanel(item.gig_id!, item); }}
                                >
                                  <Music className="w-3 h-3 mr-1.5" />
                                  Gig Details
                                </Button>
                              )}
                            </div>
                            {isAdmin && lineTaxTreatment(item) === 'depreciate' && (
                              <p className="mt-3 pt-3 border-t border-gray-200 text-xs text-gray-500">
                                Depreciated items aren't gig expenses, so this line can't be assigned to a gig.
                              </p>
                            )}
                            {isAdmin && lineTaxTreatment(item) === 'expense' && (
                              <div className="mt-3 pt-3 border-t border-gray-200 flex items-center gap-2 flex-wrap" onClick={(e) => e.stopPropagation()}>
                                <span className="text-xs text-gray-500 font-medium whitespace-nowrap">Assign Gig:</span>
                                <div className="w-[360px] max-w-full">
                                  <GigCombobox
                                    organizationId={organization.id}
                                    value={item.gig_id || null}
                                    aroundDate={item.purchase_date}
                                    onChange={(gigId, gigTitle) => handleAssignGig(item, gigId, gigTitle)}
                                    disabled={assigningGigItemId === item.id}
                                  />
                                </div>
                                {item.gig_id && !linesWithLedger.has(item.id) && (
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className="h-8 px-3 text-xs text-emerald-700 border-emerald-200 hover:bg-emerald-50"
                                    onClick={() => handleAddLineToLedger(item)}
                                    disabled={assigningGigItemId === item.id}
                                    title="This line is linked to a gig but has no expense entry in that gig's ledger"
                                  >
                                    {assigningGigItemId === item.id
                                      ? <RefreshCw className="w-3 h-3 mr-1.5 animate-spin" />
                                      : <Plus className="w-3 h-3 mr-1.5" />}
                                    Add to gig ledger
                                  </Button>
                                )}
                              </div>
                            )}
                            {!item.asset_id && (userRole === 'Admin' || userRole === 'Manager') && (
                              <div className="mt-3 pt-3 border-t border-gray-200" onClick={(e) => e.stopPropagation()}>
                                <AlertDialog>
                                  <AlertDialogTrigger asChild>
                                    <Button variant="outline" size="sm" className="h-7 px-3 text-xs text-blue-600 border-blue-200 hover:bg-blue-50 hover:text-blue-700">
                                      <Package className="w-3 h-3 mr-1.5" />
                                      Track as equipment
                                    </Button>
                                  </AlertDialogTrigger>
                                  <AlertDialogContent>
                                    <AlertDialogHeader>
                                      <AlertDialogTitle>Track as equipment?</AlertDialogTitle>
                                      <AlertDialogDescription>
                                        Creates an equipment record for this item, so you can tag it and put it in kits. Its tax treatment stays {lineTaxTreatment(item) === 'depreciate' ? 'Depreciate' : 'Expense'}, and a gig it's linked to keeps it as an expense.
                                      </AlertDialogDescription>
                                    </AlertDialogHeader>
                                    <AlertDialogFooter>
                                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                                      <AlertDialogAction
                                        onClick={() => handleTrackAsEquipment(item.id)}
                                        disabled={trackingItemId === item.id}
                                      >
                                        {trackingItemId === item.id && <RefreshCw className="w-3.5 h-3.5 mr-1.5 animate-spin" />}
                                        Track it
                                      </AlertDialogAction>
                                    </AlertDialogFooter>
                                  </AlertDialogContent>
                                </AlertDialog>
                              </div>
                            )}
                          </TableCell>
                        </TableRow>
                      )}
                      </React.Fragment>
                    ))}
                  </TableBody>
                </Table>
                )}
              </Card>
              </div>
              );
            })}
          </div>
        )}
      </div>
      <PurchaseDetailPanel
        panelState={panelState}
        onPanelChange={setPanelState}
        organizationId={organization.id}
        onViewAsset={onNavigateToAssetDetail}
        onEditAsset={onEditAsset}
        onNavigateToGigDetail={onNavigateToGigDetail}
        getAssetIdForItem={getAssetIdForItem}
        getGigIdForItem={getGigIdForItem}
      />
      <AlertDialog open={!!ledgerPrompt} onOpenChange={(open) => { if (!open) setLedgerPrompt(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Create gig expense record?</AlertDialogTitle>
            <AlertDialogDescription>
              This expense line is now linked to {ledgerPrompt?.gigTitle ? `"${ledgerPrompt.gigTitle}"` : 'a gig'}. Would you
              like to record it as a paid expense in that gig's financials
              {ledgerPrompt && (
                <> for ${purchaseLineLedgerAmount(ledgerPrompt.item).toFixed(2)}</>
              )}? You can skip this and the line will still be linked to the gig.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={creatingLedger}>Skip</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => { e.preventDefault(); handleCreateLedgerEntry(); }} disabled={creatingLedger}>
              {creatingLedger && <RefreshCw className="w-3.5 h-3.5 mr-1.5 animate-spin" />}
              Create record
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!clearLedgerConfirm} onOpenChange={(open) => { if (!open && !clearingLedger) setClearLedgerConfirm(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove gig association and its ledger entry?</AlertDialogTitle>
            <AlertDialogDescription>
              This line has a linked expense entry
              {clearLedgerConfirm && <> for ${clearLedgerConfirm.amount.toFixed(2)}</>} in the gig's
              financials. Unlinking the line will also delete that ledger entry so the gig's costs stay
              correct. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={clearingLedger}>Keep linked</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => { e.preventDefault(); handleConfirmClearLedger(); }} disabled={clearingLedger}>
              {clearingLedger && <RefreshCw className="w-3.5 h-3.5 mr-1.5 animate-spin" />}
              Unlink and delete entry
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!deleteConfirm} onOpenChange={(open) => { if (!open) setDeleteConfirm(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {deleteConfirm?.type === 'header' ? 'Delete Purchase?' : 'Delete Line Item?'}
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              {deleteConfirm?.type === 'header' ? (
                <>
                  <p>This will delete the purchase header and all {deleteConfirm.childCount} line item(s).</p>
                </>
              ) : (
                <>
                  <p>This will permanently remove this line item.</p>
                  {deleteConfirm?.purchase.asset_id && (
                    <p className="text-amber-600">This item is linked to an asset. Deleting it will unlink the asset (the asset will not be deleted).</p>
                  )}
                </>
              )}
              {deleteLinked && deleteLinked.entries > 0 && (
                <p className="text-amber-600">
                  This also removes ${deleteLinked.amount.toFixed(2)} of expenses from {deleteLinked.gigs} {deleteLinked.gigs === 1 ? 'gig' : 'gigs'}.
                </p>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteConfirmed} className="bg-red-600 hover:bg-red-700">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <ReviewScannedDataDialog
        open={reviewDialogOpen}
        onOpenChange={(o) => { setReviewDialogOpen(o); if (!o) setEditPurchaseId(null); }}
        organizationId={organization.id}
        scannedData={null}
        file={null}
        editPurchaseId={editPurchaseId || undefined}
        onSuccess={handlePurchaseCreated}
        onUpdated={handlePurchaseCreated}
      />
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleAttachFile}
        className="hidden"
        accept={ATTACHMENT_FILE_ACCEPT}
      />
    </div>
  );
}
