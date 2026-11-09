import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Receipt, Upload, Plus } from 'lucide-react';
import { Card } from '../../ui/card';
import { Button } from '../../ui/button';
import { Organization, User, UserRole, DbPurchase } from '../../../utils/supabase/types';
import { toast } from 'sonner';
import PurchaseDetailPanel, { PanelState } from './PurchaseDetailPanel';
import ReviewScannedDataDialog from '../../ReviewScannedDataDialog';
import PurchaseSummaryView from './PurchaseSummaryView';
import PurchaseFiltersBar, { LinkedReceiptBanner } from './PurchaseFiltersBar';
import PurchaseCard from './PurchaseCard';
import type { PurchaseLineActions } from './PurchaseLineRow';
import {
  LedgerPromptDialog, ClearLedgerDialog, DeletePurchaseDialog,
  type LedgerPrompt, type ClearLedgerConfirm, type DeleteConfirm,
} from './PurchaseConfirmDialogs';
import { usePurchaseFilters } from './usePurchaseFilters';
import { usePurchasesReport, usePurchasesMutations, useGigNames, useLinkedGigExpenses } from './usePurchasesData';
import { ATTACHMENT_FILE_ACCEPT } from '../../../utils/fileAccept';

interface PurchasesTabProps {
  organization: Organization;
  user: User;
  userRole?: UserRole;
  highlightPurchaseId?: string | null;
  returnGigId?: string | null;
  onNavigateToGigDetail?: (gigId: string) => void;
  onNavigateToAssetDetail?: (assetId: string) => void;
  onEditAsset?: (assetId: string) => void;
  /** Open the Add purchase / Scan invoices screens (offered from the empty state). */
  onAddManually?: () => void;
  onScanInvoices?: () => void;
}

/**
 * Financials › Purchases report. Reads and writes go through usePurchasesData (A10): the
 * report is cached per organization and read again on each visit and after each write.
 */
export default function PurchasesTab({
  organization,
  userRole,
  highlightPurchaseId: initialHighlightId,
  onNavigateToGigDetail,
  onNavigateToAssetDetail,
  onEditAsset,
  onAddManually,
  onScanInvoices,
}: PurchasesTabProps) {
  const { report, isLoading } = usePurchasesReport(organization.id);
  const { purchases, linesWithLedger, headerAttachments } = report;
  const mutations = usePurchasesMutations(organization.id);
  const gigNames = useGigNames(organization.id);

  const [expandedItemId, setExpandedItemId] = useState<string | null>(null);
  const [trackingItemId, setTrackingItemId] = useState<string | null>(null);
  const [assigningGigItemId, setAssigningGigItemId] = useState<string | null>(null);
  const [ledgerPrompt, setLedgerPrompt] = useState<LedgerPrompt | null>(null);
  const [creatingLedger, setCreatingLedger] = useState(false);
  // Confirm dialog shown when clearing a line's gig would strand its ledger entry.
  const [clearLedgerConfirm, setClearLedgerConfirm] = useState<ClearLedgerConfirm | null>(null);
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

  const filters = usePurchaseFilters(purchases, highlightPurchaseId, showOnlyHighlighted);
  const { groupedPurchases, highlightedGroupId, datePreset } = filters;

  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [activeUploadHeaderId, setActiveUploadHeaderId] = useState<string | null>(null);
  const [panelState, setPanelState] = useState<PanelState>({ mode: 'closed' });
  const [reviewDialogOpen, setReviewDialogOpen] = useState(false);
  const [editPurchaseId, setEditPurchaseId] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<DeleteConfirm | null>(null);
  // The gig expenses the delete removes with it (B2), for the confirm.
  const deleteLinked = useLinkedGigExpenses(organization.id, deleteConfirm?.purchaseIds ?? null);
  const [viewMode, setViewMode] = useState<'detailed' | 'summary'>('detailed');

  const toggleGroup = useCallback((groupId: string) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  }, []);

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
      await mutations.attachDocument.mutateAsync({ headerId, file });
      toast.success('File attached successfully');
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
      await mutations.trackAsEquipment.mutateAsync(itemId);
      toast.success('Now tracked as equipment');
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
      const linked = await mutations.ledgerRowsForLine(item.id);
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
      // One call (B21): the line and its gig expenses change together, or nothing does.
      const res = await mutations.setLineGig.mutateAsync({ item, gigId });

      if (gigId) {
        if (res.action === 'needs-entry') {
          toast.success(`Assigned to ${gigTitle || 'gig'}`);
          setLedgerPrompt({ item, gigId, gigTitle });
        } else if (res.action === 'moved') {
          toast.success(`Moved to ${gigTitle || 'gig'} — its ledger entry moved too`);
        } else {
          toast.success(`Assigned to ${gigTitle || 'gig'} — already in the ledger`);
        }
      } else {
        toast.success('Gig association removed');
      }
    } catch (err: any) {
      toast.error(err.message || 'Failed to assign gig');
      await mutations.refresh();
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
      const { created } = await mutations.createLedgerEntry.mutateAsync({ item, gigId: item.gig_id });
      toast.success(created ? 'Added to the gig ledger' : 'This line is already in the gig ledger');
    } catch (err: any) {
      toast.error(err.message || 'Failed to add to gig ledger');
    } finally {
      setAssigningGigItemId(null);
    }
  };

  const handleConfirmClearLedger = async () => {
    if (!clearLedgerConfirm) return;
    const { item, fromGigId } = clearLedgerConfirm;
    setClearingLedger(true);
    try {
      // One call (B21): unlink the line and remove its gig expenses together, or neither.
      await mutations.setLineGig.mutateAsync({ item, gigId: null, removeEntries: true, ledgerGigId: fromGigId });
      toast.success('Gig association and its ledger entry removed');
      setClearLedgerConfirm(null);
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
      const { created } = await mutations.createLedgerEntry.mutateAsync({ item, gigId });
      toast.success(created ? 'Gig expense ledger entry created' : 'This line is already in the gig ledger');
      setLedgerPrompt(null);
    } catch (err: any) {
      toast.error(err.message || 'Failed to create ledger entry');
    } finally {
      setCreatingLedger(false);
    }
  };

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

  // Saved in the editor: the report is read again.
  const handlePurchaseCreated = async (_purchaseId: string) => {
    await mutations.refresh();
  };

  const handleDeleteConfirmed = async () => {
    if (!deleteConfirm) return;
    try {
      await mutations.removePurchase.mutateAsync(deleteConfirm.purchase.id);
      toast.success(deleteConfirm.type === 'header' ? 'Purchase deleted' : 'Line item deleted');
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

  const lineActions: PurchaseLineActions = {
    organizationId: organization.id,
    userRole,
    isAdmin,
    linesWithLedger,
    assigningGigItemId,
    trackingItemId,
    onDeleteItem: (item) => setDeleteConfirm({ type: 'item', purchase: item, purchaseIds: [item.id] }),
    onOpenAsset: handleOpenAssetPanel,
    onOpenGig: handleOpenGigPanel,
    onAssignGig: handleAssignGig,
    onAddToLedger: handleAddLineToLedger,
    onTrackAsEquipment: handleTrackAsEquipment,
  };

  return (
    <div className="space-y-6">
      {showOnlyHighlighted && highlightPurchaseId ? (
        <LinkedReceiptBanner
          onClear={() => {
            setShowOnlyHighlighted(false);
            setHighlightPurchaseId(null);
          }}
        />
      ) : (
        <PurchaseFiltersBar filters={filters} viewMode={viewMode} onViewModeChange={setViewMode} />
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
                  <button type="button" className="text-sky-700 hover:underline" onClick={() => filters.applyDatePreset('all')}>Show all time</button>
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
            {groupedPurchases.map((group) => (
              <PurchaseCard
                key={group.header.id}
                group={group}
                highlighted={highlightedGroupId === group.header.id}
                highlightRef={highlightedGroupId === group.header.id ? highlightRef : undefined}
                attachment={headerAttachments.get(group.header.id)}
                uploading={isUploadingAttachment === group.header.id}
                collapsed={collapsedGroups.has(group.header.id)}
                expandedItemId={expandedItemId}
                onToggleCollapsed={() => toggleGroup(group.header.id)}
                onToggleItem={(itemId) => setExpandedItemId(expandedItemId === itemId ? null : itemId)}
                onViewDoc={() => handleViewDoc(group.header.id)}
                onAttachDoc={() => triggerFileUpload(group.header.id)}
                onEdit={() => {
                  setEditPurchaseId(group.header.id);
                  setReviewDialogOpen(true);
                }}
                onDelete={() => setDeleteConfirm({ type: 'header', purchase: group.header, childCount: group.children.length, purchaseIds: [group.header.id, ...group.children.map((c) => c.id)] })}
                lineActions={lineActions}
              />
            ))}
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
      <LedgerPromptDialog prompt={ledgerPrompt} busy={creatingLedger} onClose={() => setLedgerPrompt(null)} onCreate={handleCreateLedgerEntry} />
      <ClearLedgerDialog confirm={clearLedgerConfirm} busy={clearingLedger} onClose={() => setClearLedgerConfirm(null)} onConfirm={handleConfirmClearLedger} />
      <DeletePurchaseDialog confirm={deleteConfirm} linked={deleteLinked} onClose={() => setDeleteConfirm(null)} onConfirm={handleDeleteConfirmed} />

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
