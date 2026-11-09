import { useState, useEffect } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Loader2, Plus, Trash2, AlertCircle, X as CloseIcon } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { purchaseLedgerEntry, type PurchaseEditPlan } from '../services/purchase.service';
import { isTaxYearLocked, type TaxTreatment } from '../utils/taxTreatment';
import { linkAttachmentToEntity, uploadAttachment } from '../services/attachment.service';
import EquipmentDetailsDialog, { type EquipmentDetails } from './purchases/EquipmentDetailsDialog';
import { draftCategory } from './equipment/form/itemDraft';
import { equipmentCategoryOf } from '../utils/purchaseCategories';
import { reconcileLineCosts } from '../utils/lineCostPennies';
import { isReconciled } from './financials/purchases/reconciliation';
import NumericInput from './purchases/review/NumericInput';
import type { LineDecision, ScannedData, ScannedItem, UpdatePlan } from './purchases/review/types';
import { formFromScan, formFromStored, lineAmount, lineCost, moneyKey, recalculateBurdenedCosts } from './purchases/review/money';
import { retargetCategories } from '../utils/purchaseCategories';
import { makeLineEquipment } from './purchases/review/lineEquipment';
import { buildUpdatePlan } from './purchases/review/buildUpdatePlan';
import { DocumentPreviewOverlays, DocumentPreviewPane } from './purchases/review/DocumentPreview';
import { useDocumentPreview } from './purchases/review/useDocumentPreview';
import { EquipmentPill, ExpenseCategorySelect, TaxChoice } from './purchases/review/LineItemControls';
import { LinkedUpdatesDialog, TotalsMismatchDialog } from './purchases/review/ReviewConfirmDialogs';
import { ReviewStatusMessages } from './purchases/review/ReviewStatusMessages';
import {
  usePurchaseForEdit, useReviewMutations, useReviewReferenceData, type ExistingDoc,
} from './purchases/review/useReviewScannedData';

export type { ScannedData, ScannedItem } from './purchases/review/types';

interface ReviewScannedDataDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
  scannedData: ScannedData | null;
  file: File | null;
  gigId?: string;
  onSuccess: (purchaseId: string) => void;
  /** When set, the dialog edits this existing purchase instead of creating one. */
  editPurchaseId?: string;
  /** Called after a successful edit save. */
  onUpdated?: (purchaseId: string) => void;
  /**
   * 'dialog' (default) opens full screen over the page; 'page' renders in place,
   * as the Add purchase and Scan invoices screens do. `onOpenChange(false)` is then Cancel.
   */
  layout?: 'dialog' | 'page';
  /** The label of the button that calls onOpenChange(false). */
  cancelLabel?: string;
  /** The file is already uploaded (a queued invoice): link this attachment instead of uploading `file` again. */
  attachmentId?: string;
}

/**
 * The purchase form: a scanned invoice to review, a purchase typed in, or a saved purchase to
 * edit. Reads and saves go through useReviewScannedData (A10); the money rules and the update
 * plan are in purchases/review.
 */
export default function ReviewScannedDataDialog({
  open,
  onOpenChange,
  organizationId,
  scannedData,
  file,
  gigId,
  onSuccess,
  editPurchaseId,
  onUpdated,
  layout = 'dialog',
  cancelLabel = 'Cancel',
  attachmentId,
}: ReviewScannedDataDialogProps) {
  const isPage = layout === 'page';
  const isEditMode = !!editPurchaseId;
  const [formData, setFormData] = useState<ScannedData | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [assetsById, setAssetsById] = useState<Record<string, any>>({});
  const [ledgerByPurchaseId, setLedgerByPurchaseId] = useState<Record<string, any>>({});
  const [originalItemIds, setOriginalItemIds] = useState<string[]>([]);
  // The organization's lists (A10): filed years (#133), categories, periods (#125) and items (#183).
  const { lockedYears, expenseCats, equipmentCats: listedEquipmentCats, categoryPeriods, itemOptions } =
    useReviewReferenceData(organizationId, open);
  /** Equipment categories added in the pop-up while this form is open. */
  const [addedEquipmentCats, setAddedEquipmentCats] = useState<string[]>([]);
  const equipmentCats = addedEquipmentCats.length
    ? [...listedEquipmentCats, ...addedEquipmentCats.filter(c => !listedEquipmentCats.includes(c))]
    : listedEquipmentCats;
  const { createPurchase, saveEdit } = useReviewMutations(organizationId);
  /** Per saved line whose quantity changed: update its equipment (and which units go), or leave it (#183). */
  const [lineDecisions, setLineDecisions] = useState<Record<string, LineDecision>>({});
  /** The line whose Equipment details pop-up is open. */
  const [detailsIndex, setDetailsIndex] = useState<number | null>(null);
  const [originalDate, setOriginalDate] = useState<string | null>(null);
  // Judged on the saved date, so editing the date can't step around the lock.
  const purchaseLocked = isEditMode && isTaxYearLocked(originalDate, lockedYears);
  const [existingDoc, setExistingDoc] = useState<ExistingDoc | null>(null);
  const [pendingPlan, setPendingPlan] = useState<UpdatePlan | null>(null);
  // Saving when the lines don't add up to the invoice total asks first (11-08).
  const [confirmMismatch, setConfirmMismatch] = useState(false);
  // Edit mode: the money as loaded, so an edit that doesn't touch it saves without asking.
  const [loadedMoney, setLoadedMoney] = useState<string | null>(null);
  const preview = useDocumentPreview(file);

  useEffect(() => {
    if (scannedData) {
      setFormData(formFromScan(scannedData));
    } else if (open && !editPurchaseId) {
      setFormData({
        vendor: '',
        purchase_date: format(new Date(), 'yyyy-MM-dd'),
        total_inv_amount: 0,
        description: '',
        items: []
      });
    }
  }, [scannedData, open, editPurchaseId]);

  // Edit mode: the existing purchase, its linked equipment, gig ledger rows and document (A10).
  // Each open starts again and reads the purchase fresh; the form is filled once per load (on the
  // query's dataUpdatedAt, #402), from the purchase as read then.
  const { fresh, dataUpdatedAt } = usePurchaseForEdit(editPurchaseId, organizationId, open);
  const editKey = open && editPurchaseId ? `${organizationId}:${editPurchaseId}` : null;
  const [filledFor, setFilledFor] = useState<string | null>(null);
  useEffect(() => {
    setFilledFor(null);
    if (!editKey) return;
    setExistingDoc(null);
    setPendingPlan(null);
  }, [editKey]);
  useEffect(() => {
    const load = `${editKey}@${dataUpdatedAt}`;
    if (!editKey || filledFor === load || !fresh) return;
    const stored = formFromStored(fresh.details);
    setAssetsById(stored.assetsById);
    setOriginalItemIds(stored.originalItemIds);
    setOriginalDate(stored.originalDate);
    setLoadedMoney(null);
    setFormData(stored.form);
    setLedgerByPurchaseId(fresh.ledgerByPurchaseId);
    setExistingDoc(fresh.existingDoc);
    setFilledFor(load);
  }, [editKey, dataUpdatedAt, filledFor, fresh]);

  // The money as loaded, once the edit form is filled.
  useEffect(() => {
    if (isEditMode && formData && loadedMoney === null) setLoadedMoney(moneyKey(formData));
  }, [isEditMode, formData, loadedMoney]);

  if (!open || !formData) return null;

  // ---- A line's equipment (#183) and recovery period (#125) ----
  const equipment = makeLineEquipment(organizationId, categoryPeriods, formData.category);
  const { periodOf, unitProblemOf, newUnitsOf, equipmentOf, unitRowsOf } = equipment;

  const handleHeaderChange = (field: keyof ScannedData, value: string | number) => {
    setFormData(prev => {
      if (!prev) return null;
      const next = { ...prev, [field]: value };
      return field === 'total_inv_amount' ? recalculateBurdenedCosts(next) : next;
    });
  };

  // "Use $X" on the $0 total message: the total becomes the lines' own cost sum,
  // so the line costs stay as they are (re-burdening would re-spread them by price).
  const useLinesTotal = () => {
    setFormData(prev => {
      if (!prev) return null;
      const sum = prev.items.reduce((acc, item) => acc + lineCost(item), 0);
      return { ...prev, total_inv_amount: Number(sum.toFixed(2)) };
    });
  };

  const handleItemChange = (index: number, field: keyof ScannedItem, value: string | number | boolean) => {
    setFormData(prev => {
      if (!prev) return null;
      const newItems = [...prev.items];
      const before = newItems[index];
      newItems[index] = { ...before, [field]: value };
      if (field === 'tax_treatment') {
        newItems[index] = retargetCategories(newItems[index], before.tax_treatment, value as TaxTreatment);
        newItems[index]._taxChosen = true;
        if (value === 'depreciate') newItems[index].is_asset = true;
      }
      const next = { ...prev, items: newItems };
      return (field === 'quantity' || field === 'item_price') ? recalculateBurdenedCosts(next) : next;
    });
  };

  const handleLineAmtChange = (index: number, lineAmt: number) => {
    setFormData(prev => {
      if (!prev) return null;
      const newItems = [...prev.items];
      const qty = newItems[index].quantity || 1;
      newItems[index] = { ...newItems[index], item_price: Number((lineAmt / qty).toFixed(4)) };
      return recalculateBurdenedCosts({ ...prev, items: newItems });
    });
  };

  const handleAddItem = () => {
    setFormData(prev => {
      if (!prev) return null;
      return recalculateBurdenedCosts({
        ...prev,
        items: [...prev.items, { description: '', quantity: 1, item_price: 0, item_cost: 0, is_asset: false }]
      });
    });
  };

  const handleRemoveItem = (index: number) => {
    setFormData(prev => {
      if (!prev) return null;
      const newItems = [...prev.items];
      newItems.splice(index, 1);
      return recalculateBurdenedCosts({ ...prev, items: newItems });
    });
  };

  const handleSubmit = async () => {
    if (!formData) return;
    setIsSubmitting(true);
    try {
      const header = {
        organization_id: organizationId,
        purchase_date: formData.purchase_date,
        vendor: formData.vendor,
        total_inv_amount: formData.total_inv_amount,
        payment_method: formData.payment_method,
        description: formData.description,
        category: formData.category,
        row_type: 'header' as const,
      };
      // In cents, adding up to the total: the last line takes the rounding pennies (B8).
      const lineCosts = reconcileLineCosts(formData.items.map(item => item.item_cost * item.quantity), formData.total_inv_amount);
      const items = formData.items.map((item, i) => ({
        organization_id: organizationId,
        purchase_date: formData.purchase_date,
        vendor: formData.vendor,
        description: item.description,
        quantity: item.quantity,
        item_price: item.item_price,
        item_cost: item.item_cost,
        line_amount: item.item_price * item.quantity,
        line_cost: lineCosts[i],
        category: item.category || formData.category,
        // One line type (10-07); the tax treatment is its own choice, and a tracked
        // line's equipment is in `units`.
        row_type: 'line' as const,
        tax_treatment: item.tax_treatment ?? undefined,
      }));

      // One record per unit, or one lot, for each tracked line (#183).
      const units = formData.items.flatMap((item, i) => (item.is_asset ? newUnitsOf(item, i) : []));
      // Scanned on a gig: each expensed line is a cost of the gig, with its own money-out row.
      // The purchase itself, and depreciated equipment, are not (#130, #133). Saved in the same
      // call as the purchase, so it is never left half-linked (B6).
      const gigLink = gigId ? {
        gigId,
        ledger: items.flatMap((line, i) => ((line.tax_treatment ?? 'expense') === 'expense'
          ? [purchaseLedgerEntry({ ...line, id: '', row_type: 'line' } as any, i, gigId, organizationId)]
          : [])),
      } : undefined;
      const result = await createPurchase.mutateAsync({ header, items, units, gigLink });

      if (attachmentId) {
        try {
          await linkAttachmentToEntity(attachmentId, 'purchase', result.id);
        } catch (linkErr) {
          console.error('Error linking receipt attachment:', linkErr);
          toast.error('Purchase created, but failed to attach the invoice');
        }
      } else if (file) {
        try {
          const attachment = await uploadAttachment(organizationId, file);
          if (attachment) {
            await linkAttachmentToEntity(attachment.id, 'purchase', result.id);
          }
        } catch (uploadErr) {
          console.error('Error uploading receipt attachment:', uploadErr);
          toast.error('Purchase created, but failed to upload receipt attachment');
        }
      }
      toast.success('Purchase created successfully');
      onSuccess(result.id);
      // In a page, onOpenChange(false) means Cancel (Discard on Scan invoices), not "done".
      if (!isPage) onOpenChange(false);
    } catch (err: any) {
      console.error('Error creating purchase:', err);
      toast.error(err.message || 'Failed to create purchase');
    } finally {
      setIsSubmitting(false);
    }
  };

  const commitUpdate = async (plan: UpdatePlan) => {
    if (!editPurchaseId) return;
    setIsSubmitting(true);
    try {
      // The whole save is one call, all or nothing (B6), in this order: the equipment decisions
      // for quantities that no longer match (#183), the header, units for lines starting to be
      // tracked, line changes, new lines, more units, removed lines, recovery periods (#125),
      // equipment fields and the gig money the lines feed.
      const equipment: PurchaseEditPlan['equipment'] = [];
      for (const m of plan.mismatches) {
        const d = lineDecisions[m.lineId];
        if (!d || d.mode === 'leave') continue;
        if (m.kind === 'lot') { equipment.push({ op: 'lot_quantity', asset_id: m.records[0].id, quantity: m.quantity }); continue; }
        // A depreciated line must keep an equipment record: point it at a unit that stays first.
        if (m.markerId && d.remove.includes(m.markerId)) {
          const kept = m.records.find(r => !d.remove.includes(r.id));
          if (kept) equipment.push({ op: 'repoint', line_id: m.lineId, asset_id: kept.id });
        }
        for (const id of d.remove) equipment.push({ op: 'remove_unit', asset_id: id, how: d.how === 'inactive' ? 'inactive' : 'delete' });
      }
      const removed = new Set(plan.mismatches.flatMap(m => lineDecisions[m.lineId]?.mode === 'update' ? lineDecisions[m.lineId].remove : []));
      await saveEdit.mutateAsync({ purchaseId: editPurchaseId, plan: {
        equipment,
        header: plan.headerData,
        track_lines: plan.trackLines.map(t => ({ line_id: t.id, units: t.units, period: t.period })),
        updated_items: plan.updatedItems,
        new_items: plan.newItems.map(({ _track, _units, _period, ...data }) => ({ data, track: !!_track, units: _units ?? [], period: _period ?? null })),
        add_units: plan.addUnits.map(a => ({ line_id: a.lineId, units: a.units })),
        removed_item_ids: plan.removedItemIds,
        asset_changes: plan.assetChanges.filter(a => !removed.has(a.assetId)).map(a => ({ asset_id: a.assetId, data: a.data })),
        gig_changes: plan.gigChanges.map(g => ({ fin_id: g.finId, amount: g.to, settle: !!g.settle })),
      } });

      if (file) {
        try {
          const attachment = await uploadAttachment(organizationId, file);
          if (attachment) await linkAttachmentToEntity(attachment.id, 'purchase', editPurchaseId);
        } catch (uploadErr) {
          console.error('Error uploading attachment:', uploadErr);
          toast.error('Purchase updated, but failed to upload the new document');
        }
      }

      toast.success('Purchase updated successfully');
      onUpdated?.(editPurchaseId);
      if (!isPage) onOpenChange(false);
    } catch (err: any) {
      console.error('Error updating purchase:', err);
      toast.error(err.message || 'Failed to update purchase');
    } finally {
      setIsSubmitting(false);
      setPendingPlan(null);
    }
  };

  const handleUpdate = () => {
    if (!formData) return;
    const plan = buildUpdatePlan(formData, {
      purchaseLocked, organizationId, editPurchaseId, originalItemIds, assetsById, ledgerByPurchaseId, equipment,
    });
    if (plan.assetChanges.length > 0 || plan.gigChanges.length > 0 || plan.mismatches.length > 0) {
      // A line left as it is on an earlier save starts at Leave, so one click can't remove units.
      setLineDecisions(Object.fromEntries(plan.mismatches.filter(m => m.leftBefore).map(m => [m.lineId, { mode: 'leave' as const, remove: [] }])));
      setPendingPlan(plan); // show confirmation first
    } else {
      commitUpdate(plan);
    }
  };

  const calculatedTotalCost = formData.items.reduce((sum, item) => sum + lineCost(item), 0);
  const diff = Math.abs(calculatedTotalCost - formData.total_inv_amount);
  // Within a cent, as on the Purchases tab and in the reports (reconciliation.isReconciled).
  const hasMismatch = !isReconciled(formData.total_inv_amount, formData.items.map(item => ({ line_cost: lineCost(item) })));
  // Ask before saving a mismatch, unless nothing money-related would be saved: a filed year
  // (only descriptions go), or an edit that didn't touch the total or any line's cost.
  const moneyChanged = !isEditMode || loadedMoney === null || moneyKey(formData) !== loadedMoney;
  const askBeforeSave = hasMismatch && !purchaseLocked && moneyChanged;
  const save = () => (isEditMode ? handleUpdate() : handleSubmit());
  const onSaveClick = () => (askBeforeSave ? setConfirmMismatch(true) : save());
  // A $0 or empty invoice total over lines that cost something is a missed field (#226).
  // Not in a filed year: the total is locked there and only descriptions are saved.
  const missingTotal = !purchaseLocked && !(formData.total_inv_amount > 0) && calculatedTotalCost > 0.005;
  const undecided = formData.items.filter(item => !item.tax_treatment).length;
  // A line tracked as equipment and expensed needs an expense category too (#226 item 6).
  // Not in a filed year: the tax fields are locked there. Untracked lines may stay uncategorised.
  const needsExpenseCategory = (item: ScannedItem) =>
    !purchaseLocked && item.is_asset && item.tax_treatment === 'expense' && !item.category?.trim();
  const noExpenseCategory = formData.items.filter(needsExpenseCategory).length;
  // New equipment records need a category (lines already tracked have one).
  const noEquipCategory = formData.items
    .filter(item => item.is_asset && !(isEditMode && item._assetId) && !equipmentCategoryOf(item).trim()).length;
  // Depreciated lines need a recovery period: their category's default, or one chosen (#125).
  const noPeriod = formData.items.filter(item => item.tax_treatment === 'depreciate' && !periodOf(item)).length;
  // Units need a serial or a tag each (#183).
  const noUnits = formData.items.filter(item => unitProblemOf(item)).length;
  const canSave = !isSubmitting && formData.items.length > 0 && !!formData.vendor && undecided === 0 && noExpenseCategory === 0 && noEquipCategory === 0 && noPeriod === 0 && noUnits === 0 && !missingTotal;

  const detailsItem = detailsIndex !== null ? formData.items[detailsIndex] : null;
  const saveDetails = (d: EquipmentDetails) => {
    if (detailsIndex === null || !detailsItem) return;
    const field: keyof ScannedItem = detailsItem.tax_treatment === 'depreciate' ? 'category' : 'asset_category';
    const category = draftCategory(d.item);
    setFormData(prev => {
      if (!prev) return prev;
      const items = [...prev.items];
      items[detailsIndex] = { ...items[detailsIndex], ...(category ? { [field]: category } : {}), equipment: d };
      return { ...prev, items };
    });
    if (category && !equipmentCats.includes(category)) setAddedEquipmentCats(c => [...c, category]);
  };

  const panel = (
    <div
      className={isPage ? "bg-white rounded-lg overflow-hidden flex flex-col border" : "bg-white rounded-lg shadow-2xl overflow-hidden flex flex-col border"}
      style={isPage ? { width: '100%', height: 'calc(100vh - 240px)', minHeight: 560 } : { width: '96vw', height: '94vh' }}
    >
      <div style={{ padding: '6px 16px', borderBottom: '1px solid #e5e7eb', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
        <div>
          <h2 style={{ fontSize: 15, fontWeight: 600 }}>{isEditMode ? 'Edit Purchase' : scannedData ? 'Review Scanned Purchase' : 'Create Purchase Entry'}</h2>
          <p style={{ fontSize: 11, color: '#6b7280' }}>
            {isEditMode ? 'Update line items below. Changes to a linked asset or gig ledger are confirmed before saving.' : scannedData ? 'Verify the extracted data below.' : 'Enter details manually using the document preview as reference.'}
          </p>
        </div>
        {!isPage && (
          <DialogPrimitive.Close className="rounded-sm opacity-70 hover:opacity-100 p-1">
            <CloseIcon className="h-4 w-4" />
          </DialogPrimitive.Close>
        )}
      </div>

      <div style={{ display: 'flex', flex: '1 1 0', overflow: 'hidden', minHeight: 0, height: 0 }}>
        {/* Preview Panel */}
        <DocumentPreviewPane preview={preview} existingDoc={existingDoc} isEditMode={isEditMode} />

        {/* Form Panel */}
        <div style={{ width: '55%', height: '100%', display: 'flex', flexDirection: 'column', background: 'white' }}>
          <style>{`.review-form-scroll::-webkit-scrollbar{width:8px}.review-form-scroll::-webkit-scrollbar-track{background:#f1f5f9}.review-form-scroll::-webkit-scrollbar-thumb{background:#cbd5e1;border-radius:4px}.review-form-scroll::-webkit-scrollbar-thumb:hover{background:#94a3b8}`}</style>
          <div style={{ position: 'relative', flex: '1 1 0', minHeight: 0 }}>
          <div className="review-form-scroll" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, overflowY: 'scroll', WebkitOverflowScrolling: 'touch', padding: '12px 16px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {purchaseLocked && (
                <div role="note" style={{ padding: 6, borderRadius: 4, display: 'flex', alignItems: 'flex-start', gap: 6, fontSize: 11, border: '1px solid #bae6fd', background: '#f0f9ff', color: '#075985' }}>
                  <AlertCircle style={{ width: 14, height: 14, flexShrink: 0, marginTop: 1 }} />
                  <span>The {originalDate?.slice(0, 4)} tax year is filed, so this purchase's costs, dates, categories and tax treatment can't change. You can still edit descriptions and track items as equipment.</span>
                </div>
              )}
              {/* Purchase Summary */}
              <div>
                <h4 style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#9ca3af', borderBottom: '1px solid #e5e7eb', paddingBottom: 3, marginBottom: 6 }}>Purchase Summary</h4>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  <div style={{ flex: '2 1 300px' }}>
                    <span style={{ fontSize: 8, fontWeight: 600, textTransform: 'uppercase', color: '#6b7280', display: 'block', marginBottom: 1 }}>Vendor</span>
                    <Input
                      value={formData.vendor}
                      onChange={e => handleHeaderChange('vendor', e.target.value)}
                      placeholder="e.g. Sweetwater, B&H, Amazon"
                      className="h-7 text-xs font-semibold border-gray-300"
                    />
                  </div>
                  <div style={{ flex: '1 1 120px' }}>
                    <span style={{ fontSize: 8, fontWeight: 600, textTransform: 'uppercase', color: '#6b7280', display: 'block', marginBottom: 1 }}>Date</span>
                    <Input
                      type="date"
                      value={formData.purchase_date}
                      disabled={purchaseLocked}
                      onChange={e => handleHeaderChange('purchase_date', e.target.value)}
                      className="h-7 text-xs border-gray-300"
                    />
                  </div>
                  <div style={{ width: '100%', display: 'flex', gap: 6 }}>
                    <div style={{ flex: '2 1 0' }}>
                      <span style={{ fontSize: 8, fontWeight: 600, textTransform: 'uppercase', color: '#6b7280', display: 'block', marginBottom: 1 }}>Description / Notes</span>
                      <Input
                        value={formData.description || ''}
                        onChange={e => handleHeaderChange('description', e.target.value)}
                        placeholder="Purchase notes"
                        className="h-7 text-xs border-gray-300"
                      />
                    </div>
                    <div style={{ flex: '0 0 100px' }}>
                      <span style={{ fontSize: 8, fontWeight: 600, textTransform: 'uppercase', color: '#6b7280', display: 'block', marginBottom: 1 }}>Invoice Total</span>
                      <div style={{ position: 'relative' }}>
                        <span style={{ position: 'absolute', left: 4, top: '50%', transform: 'translateY(-50%)', color: '#9ca3af', fontSize: 10 }}>$</span>
                        <NumericInput
                          value={formData.total_inv_amount}
                          disabled={purchaseLocked}
                          onChange={v => handleHeaderChange('total_inv_amount', v)}
                          className="pl-4 h-7 text-xs font-bold text-sky-700 border-gray-300"
                        />
                      </div>
                    </div>
                    <div style={{ flex: '1 1 0', display: 'flex', alignItems: 'center', paddingTop: 10 }}>
                      <p style={{ fontSize: 7, color: '#9ca3af', fontStyle: 'italic', lineHeight: 1, margin: 0 }}>Distributed as burdened cost across items.</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Line Items */}
              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid #e5e7eb', paddingBottom: 3, marginBottom: 4 }}>
                  <h4 style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#9ca3af' }}>Line Items</h4>
                  <button
                    onClick={handleAddItem}
                    disabled={purchaseLocked}
                    style={{ opacity: purchaseLocked ? 0.4 : 1, height: 22, padding: '0 8px', fontSize: 10, border: '1px solid #7dd3fc', color: '#0284c7', background: 'white', borderRadius: 4, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 3 }}
                  >
                    <Plus className="w-3 h-3" /> Add Item
                  </button>
                </div>

                {formData.items.length > 0 && (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 72px 40px 72px 68px 18px', gap: '0 3px', padding: '0 2px', marginBottom: 2, fontSize: 9, fontWeight: 700, textTransform: 'uppercase', color: '#9ca3af', letterSpacing: '0.04em' }}>
                    <span>Description</span>
                    <span style={{ textAlign: 'center' }}>Item Price</span>
                    <span style={{ textAlign: 'center' }}>Qty</span>
                    <span style={{ textAlign: 'center' }}>Line Amt</span>
                    <span style={{ textAlign: 'center' }}>Unit Cost</span>
                    <span />
                  </div>
                )}

                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {formData.items.map((item, index) => (
                    <div key={index} style={{ background: '#f9fafb', borderRadius: 4, border: '1px solid #f3f4f6', padding: '2px 2px' }}>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 72px 40px 72px 68px 18px', gap: '0 3px', alignItems: 'center' }}>
                        <Input
                          value={item.description}
                          onChange={e => handleItemChange(index, 'description', e.target.value)}
                          placeholder="Item description"
                          className="bg-white border-gray-200 h-6 text-[11px]"
                        />
                        <div style={{ position: 'relative' }}>
                          <span style={{ position: 'absolute', left: 4, top: '50%', transform: 'translateY(-50%)', color: '#9ca3af', fontSize: 10 }}>$</span>
                          <NumericInput
                            value={item.item_price}
                            disabled={purchaseLocked}
                            onChange={v => handleItemChange(index, 'item_price', v)}
                            className="pl-3.5 bg-white border-gray-200 h-6 text-[11px] font-semibold text-right"
                          />
                        </div>
                        <NumericInput
                          value={item.quantity}
                          disabled={purchaseLocked}
                          onChange={v => handleItemChange(index, 'quantity', Math.max(1, Math.round(v)))}
                          placeholder="1"
                          className="bg-white border-gray-200 text-center h-6 text-[11px] font-semibold"
                        />
                        <div style={{ position: 'relative' }}>
                          <span style={{ position: 'absolute', left: 4, top: '50%', transform: 'translateY(-50%)', color: '#9ca3af', fontSize: 10 }}>$</span>
                          <NumericInput
                            value={Number(lineAmount(item).toFixed(2))}
                            disabled={purchaseLocked}
                            onChange={v => handleLineAmtChange(index, v)}
                            className="pl-3.5 bg-white border-gray-200 h-6 text-[11px] text-right"
                          />
                        </div>
                        <div style={{ height: 24, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', padding: '0 4px', background: '#f0f9ff', borderRadius: 3, fontSize: 10, color: '#0369a1', fontWeight: 700, border: '1px solid #e0f2fe' }}>
                          ${(item.item_cost ?? 0).toFixed(2)}
                        </div>
                        <button
                          onClick={() => handleRemoveItem(index)}
                          disabled={purchaseLocked}
                          aria-label={`Remove ${item.description || 'item'}`}
                          style={{ visibility: purchaseLocked ? 'hidden' : 'visible', height: 24, width: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#d1d5db', background: 'none', border: 'none', cursor: 'pointer' }}
                          onMouseEnter={e => (e.currentTarget.style.color = '#ef4444')}
                          onMouseLeave={e => (e.currentTarget.style.color = '#d1d5db')}
                        >
                          <Trash2 style={{ width: 12, height: 12 }} />
                        </button>
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, alignItems: 'center', marginTop: 2 }}>
                        <TaxChoice
                          item={item}
                          isGigExpense={!!(item._purchaseId && ledgerByPurchaseId[item._purchaseId])}
                          purchaseLocked={purchaseLocked}
                          onChange={value => handleItemChange(index, 'tax_treatment', value)}
                        />
                        {item.tax_treatment !== 'depreciate' && (
                          <ExpenseCategorySelect
                            item={item}
                            expenseCats={expenseCats}
                            needed={needsExpenseCategory(item)}
                            purchaseLocked={purchaseLocked}
                            onChange={value => handleItemChange(index, 'category', value)}
                          />
                        )}
                        <EquipmentPill
                          item={item}
                          isEditMode={isEditMode}
                          equipment={equipment}
                          onToggle={on => handleItemChange(index, 'is_asset', on)}
                          onOpenDetails={() => setDetailsIndex(index)}
                        />
                      </div>
                    </div>
                  ))}
                </div>

                {formData.items.length === 0 && (
                  <div style={{ textAlign: 'center', padding: '20px 0', background: '#f9fafb', border: '2px dashed #e5e7eb', borderRadius: 8 }}>
                    <Plus style={{ width: 24, height: 24, color: '#e5e7eb', margin: '0 auto 4px' }} />
                    <p style={{ fontSize: 11, color: '#9ca3af' }}>No items yet. Click "Add Item" to begin.</p>
                  </div>
                )}
              </div>

              <ReviewStatusMessages
                missingTotal={missingTotal}
                hasMismatch={hasMismatch}
                linesTotal={calculatedTotalCost}
                invoiceTotal={formData.total_inv_amount}
                diff={diff}
                onUseLinesTotal={useLinesTotal}
                undecided={undecided}
                noPeriod={noPeriod}
                noUnits={noUnits}
                noEquipCategory={noEquipCategory}
              />
            </div>
          </div>
          </div>

          {/* Footer */}
          <div style={{ padding: '6px 16px', borderTop: '1px solid #e5e7eb', background: '#f9fafb', display: 'flex', justifyContent: 'flex-end', gap: 12, flexShrink: 0 }}>
            <Button variant="outline" onClick={() => onOpenChange(false)} className="h-7 px-5 text-xs">
              {cancelLabel}
            </Button>
            <button
              onClick={onSaveClick}
              disabled={!canSave}
              style={{ height: 28, padding: '0 20px', fontSize: 12, fontWeight: 600, borderRadius: 4, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#0284c7', color: 'white', border: 'none', cursor: 'pointer', opacity: canSave ? 1 : 0.5 }}
            >
              {isSubmitting && <Loader2 style={{ width: 14, height: 14, marginRight: 6 }} className="animate-spin" />}
              {isEditMode ? 'Save Changes' : 'Save Purchase'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  const overlays = (
    <>
    <TotalsMismatchDialog
      open={confirmMismatch}
      onOpenChange={setConfirmMismatch}
      linesTotal={calculatedTotalCost}
      invoiceTotal={formData.total_inv_amount}
      onSave={save}
    />
    {detailsItem && (
      <EquipmentDetailsDialog
        open
        onOpenChange={o => { if (!o) setDetailsIndex(null); }}
        organizationId={organizationId}
        itemName={detailsItem.description}
        // A saved line: its units, plus a row for each piece it doesn't have yet.
        quantity={detailsItem._records?.length && equipmentOf(detailsItem).kind === 'units' ? unitRowsOf(detailsItem).length : detailsItem.quantity}
        categories={equipmentCats}
        items={itemOptions}
        value={(() => {
          const eq = equipmentOf(detailsItem);
          return {
            ...eq,
            units: eq.kind === 'units' ? unitRowsOf(detailsItem) : eq.units,
            replacement_value: eq.replacement_value || (detailsItem._records?.length ? '' : detailsItem.item_price ? String(detailsItem.item_price) : ''),
          };
        })()}
        depreciated={detailsItem.tax_treatment === 'depreciate'}
        categoryPeriods={categoryPeriods}
        // A filed year's recovery period can be filled in, not changed.
        periodLocked={purchaseLocked && !!detailsItem._records?.some(r => r.recovery_period != null)}
        onSave={saveDetails}
        // A depreciated line's category is its tax category too, so a filed year freezes it.
        categoryLocked={purchaseLocked && detailsItem.tax_treatment === 'depreciate'}
        saved={!!detailsItem._records?.length}
      />
    )}
    {pendingPlan && (pendingPlan.assetChanges.length > 0 || pendingPlan.gigChanges.length > 0 || pendingPlan.mismatches.length > 0) && (
      <LinkedUpdatesDialog
        plan={pendingPlan}
        lineDecisions={lineDecisions}
        onDecide={(lineId, next) => setLineDecisions(prev => ({ ...prev, [lineId]: next }))}
        isSubmitting={isSubmitting}
        onCancel={() => setPendingPlan(null)}
        onConfirm={() => commitUpdate(pendingPlan)}
      />
    )}

    <DocumentPreviewOverlays preview={preview} />
    </>
  );


  if (isPage) {
    return (
      <>
        {panel}
        {overlays}
      </>
    );
  }

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50" />
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ padding: 12 }}>
          {panel}
        </div>
        {overlays}
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
