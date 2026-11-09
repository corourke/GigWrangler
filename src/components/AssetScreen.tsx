import { useState, useEffect, type ReactNode } from 'react';
import { Save, Loader2, AlertCircle, History, CreditCard, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Card } from './ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';
import AppHeader from './AppHeader';
import { PageHeader } from './layout/PageHeader';
import { Organization, User, UserRole } from '../utils/supabase/types';
import { updateAsset } from '../services/asset.service';
import { useAssetData, useAssetMutations, useAssetFormLookups } from './asset/useAssetData';
import type { DbInventoryTracking, ActivityLogEntry } from '../utils/supabase/types';
import ActivityFeed from './ActivityFeed';
import { ASSET_STATUS_CONFIG } from '../utils/supabase/constants';
import { useSimpleFormChanges } from '../utils/hooks/useSimpleFormChanges';
import { createSubmissionPayload, normalizeFormData } from '../utils/form-utils';
import { useAutocompleteSuggestions } from '../utils/hooks/useAutocompleteSuggestions';
import { isTaxYearLocked } from '../utils/taxTreatment';
import { RECOVERY_PERIODS, categoryPeriod } from '../utils/recoveryPeriod';
import AttachmentManager from './AttachmentManager';
import { recordKind } from '../utils/equipmentItems';
import { buildLineUnits, unitRowProblems, type ItemChoice } from '../utils/lineUnits';
import ItemSection from './equipment/form/ItemSection';
import { emptyItemDraft, itemDraftErrors, type ItemDraft } from './equipment/form/itemDraft';
import UnitOrLotSection, { type FormUnitRow, type UnitOrLot } from './equipment/form/UnitOrLotSection';
import InsuranceSection from './equipment/form/InsuranceSection';
import { isStaffOrAbove } from '../utils/permissions';

interface AssetScreenProps {
  organization: Organization;
  user: User;
  userRole?: UserRole;
  assetId?: string | null; // If provided, edit mode
  /** Adding to this item (#182). In edit mode the record's own item is used. */
  itemId?: string | null;
  /** Back and after saving: the item page, once the item is known. */
  onBackToItem?: (itemId: string) => void;
  onCancel: () => void;
  onAssetCreated: (assetId: string) => void;
  onAssetUpdated: () => void;
  onNavigateToPurchases?: (purchaseId?: string) => void;
  onSwitchOrganization: () => void;
  onEditProfile?: () => void;
  onLogout: () => void;
}

/** The fields of one record being edited, plus the financial fields of a new one. */
interface FormData {
  equipment_item_id: string;
  category: string;
  manufacturer_model: string;
  serial_number: string;
  acquisition_date: string;
  vendor: string;
  item_price: string;
  item_cost: string;
  replacement_value: string;
  type: string;
  description: string;
  insurance_policy_added: boolean;
  insurance_class: string;
  quantity: string;
  tag_number: string;
  status: string;
  retired_on: string;
  recovery_period: string;
  liquidation_amt: string;
  purchase_id?: string;
}

const MISSING_NOTE = 'Written off as missing. To bring it back, use Undo write-off on this equipment\'s page, or Undo in the gig\'s Not returned list.';
/** What write_off_pieces sets on a record; only Undo changes these again (#242). */
const WRITE_OFF_LOCKED_FIELDS = ['status', 'retired_on', 'liquidation_amt'] as const;
const num = (v: string) => (v.trim() === '' ? null : parseFloat(v));

/** A titled form section; its title names it for assistive tech. */
function FormSection({ id, title, first, children }: { id: string; title: string; first?: boolean; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className={first ? '' : 'border-t border-gray-100 pt-4'}>
      <h3 id={id} className="text-gray-900 mb-2">{title}</h3>
      {children}
    </section>
  );
}

/**
 * Add Item, Add unit or lot, and editing one unit or lot (#182, #183): the same
 * three sections as the purchase Equipment details pop-up (What it is, Unit or
 * lot, Insurance), plus Financial Information, and Lifecycle when editing.
 */
export default function AssetScreen({
  organization,
  user,
  userRole,
  assetId,
  itemId,
  onBackToItem,
  onCancel,
  onAssetCreated,
  onAssetUpdated,
  onNavigateToPurchases,
  onSwitchOrganization,
  onEditProfile,
  onLogout,
}: AssetScreenProps) {
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [totalCost, setTotalCost] = useState<string>(''); // Helper field, not saved

  const [formData, setFormData] = useState<FormData>({
    equipment_item_id: '',
    category: '',
    manufacturer_model: '',
    serial_number: '',
    acquisition_date: '',
    vendor: '',
    item_price: '',
    item_cost: '',
    replacement_value: '',
    type: '',
    description: '',
    insurance_policy_added: false,
    insurance_class: '',
    quantity: '',
    tag_number: '',
    status: 'Active',
    retired_on: '',
    recovery_period: '',
    liquidation_amt: '',
  });

  const isEditMode = !!assetId;

  // What it is (#183): an item we already have, or a new one.
  const [itemDraft, setItemDraft] = useState<ItemDraft>(emptyItemDraft());
  // Unit or lot. Adding: the quantity sets the serial/tag rows, one per unit.
  const [kind, setKind] = useState<UnitOrLot>('units');
  const [quantity, setQuantity] = useState(1);
  const [rows, setRows] = useState<FormUnitRow[]>([{ serial_number: '', tag_number: '' }]);
  const [loadedLotQuantity, setLoadedLotQuantity] = useState<number | null>(null);
  const [showProblems, setShowProblems] = useState(false);

  const changeDetection = useSimpleFormChanges({
    currentData: formData,
    initialData: {},
  });

  // Server state (Phase 7): asset + read-only history/tracking via useQuery.
  const { assetQuery, inventoryTrackingQuery, activityQuery } = useAssetData(assetId);
  // The form's lookups (A10). The item: the record's own when editing, else the one added to.
  const lookups = useAssetFormLookups(organization.id, {
    assetId,
    itemId: assetId ? (assetQuery.data as any)?.equipment_item_id ?? null : itemId,
  });
  const { categories: equipmentCategories, items, categoryPeriods, depreciatedOn, lockedYears } = lookups;
  // Start from the record's item, or the one added to, once it is read.
  const lookedUpItem = lookups.item;
  useEffect(() => {
    if (lookedUpItem) setItemDraft(emptyItemDraft({ mode: 'existing', existing: lookedUpItem }));
  }, [lookedUpItem]);

  // Editing: choosing another item moves the record to it.
  const changeItem = (next: ItemDraft) => {
    setItemDraft(next);
    if (!isEditMode || !next.existing) return;
    const it = next.existing;
    setFormData((prev) => ({
      ...prev,
      equipment_item_id: it.id,
      manufacturer_model: it.manufacturer_model,
      category: it.category,
      type: it.type ?? '',
      description: it.description ?? '',
      insurance_class: it.insurance_class ?? '',
    }));
  };

  // Only depreciated equipment has a recovery period (#125); a filed year's, once set, stays.
  const depreciated = !!depreciatedOn;
  const defaultPeriod = categoryPeriod(categoryPeriods, formData.category);
  const periodLocked = depreciated && isTaxYearLocked(depreciatedOn, lockedYears) && !!changeDetection.originalData?.recovery_period;

  const vendorSuggestions = useAutocompleteSuggestions({
    field: 'vendor',
    organizationId: organization.id,
    sourceTable: 'assets',
    enabled: true,
  });

  const assetMutations = useAssetMutations(organization.id);
  const isLoading = assetQuery.isLoading;
  const isSaving = assetMutations.createAssets.isPending || assetMutations.updateAsset.isPending;
  const inventoryTracking = (inventoryTrackingQuery.data ?? []) as DbInventoryTracking[];
  const assetActivity = (activityQuery.data ?? []) as ActivityLogEntry[];
  const isLoadingHistory = inventoryTrackingQuery.isLoading || activityQuery.isLoading;

  // Populate the form when the asset query first resolves (edit mode). The
  // query is not invalidated by mutations, so this never clobbers edits.
  useEffect(() => {
    const asset = assetQuery.data;
    if (!asset) return;
    const loadedData: FormData = {
      equipment_item_id: asset.equipment_item_id || '',
      category: asset.category || '',
      manufacturer_model: asset.manufacturer_model || '',
      serial_number: asset.serial_number || '',
      acquisition_date: asset.acquisition_date || '',
      vendor: asset.vendor || '',
      item_price: asset.item_price?.toString() || '',
      item_cost: asset.item_cost?.toString() || '',
      replacement_value: asset.replacement_value?.toString() || '',
      type: asset.type || '',
      description: asset.description || '',
      insurance_policy_added: asset.insurance_policy_added || false,
      insurance_class: asset.insurance_class || '',
      quantity: asset.quantity?.toString() || '',
      tag_number: asset.tag_number || '',
      status: asset.status || 'Active',
      retired_on: asset.retired_on || '',
      recovery_period: asset.recovery_period?.toString() || '',
      liquidation_amt: asset.liquidation_amt?.toString() || '',
      purchase_id: asset.purchase_id,
    };
    setFormData(loadedData);
    changeDetection.loadInitialData(loadedData);
    const loadedKind = recordKind(asset) === 'unit' ? 'units' : 'lot';
    setKind(loadedKind);
    setLoadedLotQuantity(loadedKind === 'lot' ? (asset.quantity ?? 1) : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assetQuery.data]);

  // Surface a load failure the same way the old loader did: toast + cancel.
  useEffect(() => {
    if (!assetQuery.isError) return;
    const error = assetQuery.error as any;
    console.error('Error loading asset:', error);
    toast.error(error?.message || 'Failed to load asset');
    onCancel();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assetQuery.isError]);

  const isMissing = formData.status === 'Missing';
  // Equipment status changes take Staff or above (#185 PR 2).
  const canSetStatus = isStaffOrAbove(userRole);

  const handleChange = (field: keyof FormData, value: string | boolean) => {
    setFormData((prev) => {
      const next = { ...prev, [field]: value };
      // Auto-set status to 'Disposed' when liquidation_amt is entered (never for a written-off
      // record: Missing is left only by Undo, and a flip would fail the save).
      if (field === 'liquidation_amt' && typeof value === 'string' && value.trim() !== '' && prev.status !== 'Missing') {
        next.status = 'Disposed';
      }
      return next;
    });
    if (errors[field]) {
      setErrors((prev) => {
        const newErrors = { ...prev };
        delete newErrors[field];
        return newErrors;
      });
    }
  };

  // Editing one record: its serial and tag are the one row; a lot's quantity is its own.
  const editRows: FormUnitRow[] = [{ serial_number: formData.serial_number, tag_number: formData.tag_number }];
  const unitRows = isEditMode ? editRows : rows;
  const unitProblems = kind === 'units' ? unitRowProblems(unitRows) : [];
  const shownItem = itemDraft.mode === 'existing' ? itemDraft.existing : null;
  const newItem = !isEditMode && itemDraft.mode === 'new';

  const validate = (): boolean => {
    const newErrors: Record<string, string> = {};
    if (!isEditMode) Object.assign(newErrors, itemDraftErrors(itemDraft));
    if (!formData.acquisition_date) newErrors.acquisition_date = 'Acquisition date is required';
    if (formData.item_price && isNaN(parseFloat(formData.item_price))) newErrors.item_price = 'Item price must be a valid number';
    if (formData.item_cost && isNaN(parseFloat(formData.item_cost))) newErrors.item_cost = 'Item cost must be a valid number';
    if (formData.replacement_value && isNaN(parseFloat(formData.replacement_value))) newErrors.replacement_value = 'Replacement value must be a valid number';
    if (unitProblems.length) newErrors.unit = unitProblems[0];
    if (kind === 'lot' && isEditMode && formData.quantity && (isNaN(parseInt(formData.quantity)) || parseInt(formData.quantity) < 1)) {
      newErrors.quantity = 'Quantity must be a positive number';
    }
    if (depreciated && !formData.recovery_period && !defaultPeriod) {
      newErrors.recovery_period = 'Choose a recovery period: this equipment is depreciated';
    }
    if (formData.liquidation_amt && isNaN(parseFloat(formData.liquidation_amt))) {
      newErrors.liquidation_amt = 'Disposal or salvage amount must be a valid number';
    }
    setErrors(newErrors);
    setShowProblems(true);
    return Object.keys(newErrors).length === 0;
  };

  // Adding: one record per unit row, or one lot, all saved together.
  const createRecords = async () => {
    const d = itemDraft;
    const item: ItemChoice = d.mode === 'existing' && d.existing
      ? { equipment_item_id: d.existing.id, manufacturer_model: d.existing.manufacturer_model, category: d.existing.category,
          type: d.existing.type, insurance_class: d.existing.insurance_class, description: d.existing.description }
      : { manufacturer_model: d.manufacturer_model, category: d.category, type: d.type, insurance_class: d.insurance_class, description: d.description };
    const built = buildLineUnits(organization.id, 0, kind === 'units' ? rows.length : quantity, {
      item, kind, units: rows, replacement_value: num(formData.replacement_value), insured: formData.insurance_policy_added,
    });
    const records = built.map(({ line_index: _drop, ...r }) => ({
      ...r,
      acquisition_date: formData.acquisition_date,
      vendor: formData.vendor.trim() || null,
      item_price: num(formData.item_price),
      item_cost: num(formData.item_cost),
      status: 'Active',
    }));
    const saved = await assetMutations.createAssets.mutateAsync(records as Parameters<typeof assetMutations.createAssets.mutateAsync>[0]);
    toast.success(kind === 'lot' ? 'Lot added' : records.length === 1 ? 'Unit added' : `${records.length} units added`);
    const newItemId = saved[0]?.equipment_item_id ?? shownItem?.id;
    if (newItemId && onBackToItem) onBackToItem(newItemId); else if (saved[0]) onAssetCreated(saved[0].id);
  };

  const updateRecord = async () => {
    // A unit is one thing (quantity 1); a lot has no serial number or tag.
    const shaped: FormData = kind === 'units'
      ? { ...formData, quantity: '1' }
      : { ...formData, serial_number: '', tag_number: '', quantity: formData.quantity || '1' };
    const normalizedData = normalizeFormData(shaped) as Record<string, any>;
    for (const f of ['item_price', 'item_cost', 'replacement_value', 'liquidation_amt'] as const) {
      const v = normalizedData[f];
      normalizedData[f] = v === null || v === '' ? null : typeof v === 'string' ? parseFloat(v) : v;
    }
    const q = normalizedData.quantity;
    normalizedData.quantity = q === null || q === '' ? undefined : typeof q === 'string' ? parseInt(q) : q;
    // Depreciated: the period chosen, else the category's. Not depreciated: none.
    if (depreciated) {
      normalizedData.recovery_period = formData.recovery_period ? parseInt(formData.recovery_period) : defaultPeriod;
    } else {
      delete normalizedData.recovery_period;
    }
    // A written-off record's status, retired date and disposal amount belong to the write-off
    // (only Undo changes them), so a save never carries them.
    if (formData.status === 'Missing') {
      for (const f of WRITE_OFF_LOCKED_FIELDS) delete normalizedData[f];
    }
    const changed = changeDetection.hasChanges
      ? createSubmissionPayload(normalizedData, changeDetection.originalData)
      : normalizedData;
    await assetMutations.updateAsset.mutateAsync({
      id: assetId as string,
      data: { ...changed, organization_id: organization.id } as Parameters<typeof updateAsset>[1],
    });
    changeDetection.markAsSaved(normalizedData);
    toast.success(kind === 'units' ? 'Unit updated' : 'Lot updated');
    const backTo = shownItem?.id;
    if (backTo && onBackToItem) onBackToItem(backTo); else onAssetUpdated();
  };

  const handleSubmit = async () => {
    if (!validate()) {
      toast.error('Please fix the errors before submitting');
      return;
    }
    try {
      if (isEditMode && assetId) await updateRecord(); else await createRecords();
    } catch (error: any) {
      console.error('Error saving asset:', error);
      toast.error(error.message || 'Failed to save asset');
    }
  };

  const count = kind === 'units' ? unitRows.length : 1;
  const saveLabel = isEditMode
    ? (kind === 'units' ? 'Update Unit' : 'Update Lot')
    : `Add ${newItem ? 'Item and ' : ''}${kind === 'lot' ? 'Lot' : count === 1 ? 'Unit' : `${count} Units`}`;

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-sky-500" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <AppHeader
        organization={organization}
        user={user}
        userRole={userRole}
        currentRoute="create-asset"
        onSwitchOrganization={onSwitchOrganization}
        onEditProfile={onEditProfile}
        onLogout={onLogout}
      />

      <PageHeader
        back={shownItem && onBackToItem && (isEditMode || itemId)
          ? { label: `Back to ${shownItem.manufacturer_model}`, onClick: () => onBackToItem(shownItem.id) }
          : { label: 'Back to Items', onClick: onCancel }}
        title={isEditMode
          ? (formData.tag_number || (formData.serial_number ? `SN ${formData.serial_number}` : `Lot of ${formData.quantity || 1}`))
          : itemId ? 'Add unit or lot' : 'Add Item'}
        meta={(isEditMode || itemId) && shownItem ? shownItem.manufacturer_model : undefined}
      />

      {/* Narrower than the header, but left-aligned with the title (#39). */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 *:max-w-4xl">
        <Card className="p-4">
          <div className="space-y-4">
            <FormSection id="section-what" title="What it is" first>
              <ItemSection
                idPrefix="item"
                organizationId={organization.id}
                value={itemDraft}
                onChange={changeItem}
                categories={equipmentCategories}
                items={items}
                fixed={isEditMode || !!itemId}
                errors={showProblems && !isEditMode ? itemDraftErrors(itemDraft) : {}}
              />
            </FormSection>

            <FormSection id="section-units" title="Unit or lot">
              <UnitOrLotSection
                idPrefix="units"
                kind={kind}
                onKindChange={(k) => {
                  // A lot has no serial or tag: saving one as a lot drops them.
                  if (isEditMode && k === 'lot' && kind === 'units' && (formData.serial_number?.trim() || formData.tag_number?.trim())
                    && !window.confirm('Make this unit a lot? Its serial number and tag are removed when you save.')) return;
                  setKind(k);
                  if (isEditMode && k === 'lot') handleChange('quantity', formData.quantity || '1');
                }}
                quantity={isEditMode ? (kind === 'units' ? 1 : parseInt(formData.quantity) || 1) : kind === 'units' ? rows.length : quantity}
                onQuantityChange={(n) => {
                  if (isEditMode) handleChange('quantity', String(n));
                  else setQuantity(n);
                }}
                quantityLocked={isEditMode && kind === 'units'}
                quantityNote={isEditMode && kind === 'units' ? 'This page edits one unit.' : undefined}
                rows={unitRows}
                onRowsChange={(next) => {
                  if (isEditMode) {
                    setFormData((prev) => ({ ...prev, serial_number: next[0]?.serial_number ?? '', tag_number: next[0]?.tag_number ?? '' }));
                  } else {
                    setRows(next);
                    setQuantity(next.length);
                  }
                }}
                problems={showProblems ? unitProblems : []}
                helpers={!isEditMode}
                unitBlocked={(loadedLotQuantity ?? 0) > 1
                  ? `A lot of ${loadedLotQuantity} can’t become one unit here. Splitting a lot comes with the maintenance work (#186).` : undefined}
                lotError={errors.quantity}
              />
            </FormSection>

            <FormSection id="section-insurance" title="Insurance">
              <InsuranceSection
                idPrefix="value"
                replacementValue={formData.replacement_value}
                onReplacementValueChange={(v) => handleChange('replacement_value', v)}
                insured={formData.insurance_policy_added}
                onInsuredChange={(v) => handleChange('insurance_policy_added', v)}
                count={count}
                error={errors.replacement_value}
              />
            </FormSection>

            {/* Financial Information */}
            <FormSection id="section-financial" title="Financial Information">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="acquisition_date">
                    Acquisition Date <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    id="acquisition_date"
                    type="date"
                    value={formData.acquisition_date}
                    onChange={(e) => handleChange('acquisition_date', e.target.value)}
                    className={errors.acquisition_date ? 'border-red-500' : ''}
                  />
                  {errors.acquisition_date && (
                    <p className="text-sm text-red-600 flex items-center gap-1">
                      <AlertCircle className="w-4 h-4" />
                      {errors.acquisition_date}
                    </p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="vendor">Vendor</Label>
                  <Input
                    id="vendor"
                    list="vendors"
                    value={formData.vendor}
                    onChange={(e) => handleChange('vendor', e.target.value)}
                    placeholder="Where was this purchased?"
                  />
                  <datalist id="vendors">
                    {vendorSuggestions.suggestions.map((vendor, index) => (
                      <option key={`vendor-${index}-${vendor}`} value={vendor} />
                    ))}
                  </datalist>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="total_cost">
                    Total Invoice Amount
                    <span className="text-xs text-gray-400 font-normal ml-2">
                      (Used to calculate Item Cost)
                    </span>
                  </Label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-500">
                      $
                    </span>
                    <Input
                      id="total_cost"
                      type="number"
                      step="0.01"
                      min="0"
                      value={totalCost}
                      onChange={(e) => setTotalCost(e.target.value)}
                      onBlur={() => {
                        const qty = isEditMode ? parseInt(formData.quantity) || 1 : kind === 'units' ? rows.length : quantity;
                        const total = parseFloat(totalCost);
                        if (totalCost && !isNaN(total) && qty > 0) handleChange('item_cost', (total / qty).toFixed(2));
                      }}
                      placeholder="0.00"
                      className="pl-7"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="item_price">
                    Item Price
                    <span className="text-xs text-gray-400 font-normal ml-2">
                      {count > 1 ? `(Each, for all ${count})` : '(Selling price per item)'}
                    </span>
                  </Label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-500">
                      $
                    </span>
                    <Input
                      id="item_price"
                      type="number"
                      step="0.01"
                      min="0"
                      value={formData.item_price}
                      onChange={(e) => handleChange('item_price', e.target.value)}
                      placeholder="0.00"
                      className={`pl-7 ${errors.item_price ? 'border-red-500' : ''}`}
                    />
                  </div>
                  {errors.item_price && (
                    <p className="text-sm text-red-600 flex items-center gap-1">
                      <AlertCircle className="w-4 h-4" />
                      {errors.item_price}
                    </p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="item_cost">
                    Item Cost
                    <span className="text-xs text-gray-400 font-normal ml-2">
                      {count > 1 ? `(Each, for all ${count})` : '(Burdened cost per item)'}
                    </span>
                  </Label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-500">
                      $
                    </span>
                    <Input
                      id="item_cost"
                      type="number"
                      step="0.01"
                      min="0"
                      value={formData.item_cost}
                      onChange={(e) => handleChange('item_cost', e.target.value)}
                      placeholder="0.00"
                      className={`pl-7 ${errors.item_cost ? 'border-red-500' : ''}`}
                    />
                  </div>
                  {errors.item_cost && (
                    <p className="text-sm text-red-600 flex items-center gap-1">
                      <AlertCircle className="w-4 h-4" />
                      {errors.item_cost}
                    </p>
                  )}
                </div>

                {formData.purchase_id && onNavigateToPurchases && (
                  <div className="space-y-2 flex flex-col justify-end">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => onNavigateToPurchases?.(formData.purchase_id)}
                      className="text-sky-600 border-sky-200 hover:bg-sky-50"
                    >
                      <CreditCard className="w-4 h-4 mr-2" />
                      View in Purchase Management
                      <ExternalLink className="w-3 h-3 ml-2 opacity-50" />
                    </Button>
                  </div>
                )}
              </div>
            </FormSection>

            {/* Lifecycle: only when editing; new equipment is Active. */}
            {isEditMode && (
            <FormSection id="section-lifecycle" title="Lifecycle">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="status">Status</Label>
                  <Select
                    value={formData.status}
                    onValueChange={(value) => handleChange('status', value)}
                    disabled={isMissing || !canSetStatus}
                  >
                    <SelectTrigger id="status">
                      {formData.status in ASSET_STATUS_CONFIG ? (
                        <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium ${ASSET_STATUS_CONFIG[formData.status as keyof typeof ASSET_STATUS_CONFIG].color}`}>
                          {ASSET_STATUS_CONFIG[formData.status as keyof typeof ASSET_STATUS_CONFIG].label}
                        </span>
                      ) : (
                        <SelectValue placeholder="Select status" />
                      )}
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(ASSET_STATUS_CONFIG).filter(([key]) => key !== 'Missing').map(([key, cfg]) => (
                        <SelectItem key={key} value={key}>
                          <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium ${cfg.color}`}>
                            {cfg.label}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {isMissing && <p className="text-xs text-rose-700">{MISSING_NOTE}</p>}
                  {!isMissing && !canSetStatus && <p className="text-xs text-muted-foreground">Equipment status changes take Staff or above.</p>}
                  {formData.status === 'Disposed' && (
                    <p className="text-xs text-amber-600">
                      This asset is marked as disposed. Enter a Disposal or Salvage Amount below if applicable.
                    </p>
                  )}
                </div>

                {depreciated && (
                  <div className="space-y-2 md:col-span-2">
                    <Label htmlFor="recovery_period">Recovery period</Label>
                    <Select
                      value={formData.recovery_period || (defaultPeriod ? String(defaultPeriod) : '')}
                      onValueChange={(value) => handleChange('recovery_period', value)}
                      disabled={periodLocked}
                    >
                      <SelectTrigger id="recovery_period" aria-label="Recovery period" className={errors.recovery_period ? 'border-red-500' : ''}>
                        <SelectValue placeholder="Choose a recovery period" />
                      </SelectTrigger>
                      <SelectContent>
                        {RECOVERY_PERIODS.map(p => (
                          <SelectItem key={p.value} value={String(p.value)}>{p.label}: {p.examples}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-gray-500">
                      {periodLocked ? 'Its tax year is filed, so the recovery period stays as it is.'
                        : !formData.recovery_period && defaultPeriod ? `The default for ${formData.category}. The tax program uses it to work out depreciation.`
                        : 'This item is depreciated. The tax program uses the period to work out depreciation.'}
                    </p>
                    {errors.recovery_period && (
                      <p className="text-sm text-red-600 flex items-center gap-1">
                        <AlertCircle className="w-4 h-4" />
                        {errors.recovery_period}
                      </p>
                    )}
                  </div>
                )}

                <div className="space-y-2">
                  <Label htmlFor="retired_on">Retired On</Label>
                  <Input
                    id="retired_on"
                    type="date"
                    value={formData.retired_on}
                    onChange={(e) => handleChange('retired_on', e.target.value)}
                    disabled={isMissing}
                  />
                  {isMissing && <p className="text-xs text-rose-700">{MISSING_NOTE}</p>}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="liquidation_amt">
                    Disposal or Salvage Amount
                    <span className="text-xs text-gray-400 font-normal ml-2">
                      (Setting this marks status as Disposed)
                    </span>
                  </Label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-500">
                      $
                    </span>
                    <Input
                      id="liquidation_amt"
                      type="number"
                      step="0.01"
                      min="0"
                      value={formData.liquidation_amt}
                      onChange={(e) => handleChange('liquidation_amt', e.target.value)}
                      disabled={isMissing}
                      placeholder="0.00"
                      className={`pl-7 ${errors.liquidation_amt ? 'border-red-500' : ''}`}
                    />
                  </div>
                  {isMissing && <p className="text-xs text-rose-700">{MISSING_NOTE}</p>}
                  {errors.liquidation_amt && (
                    <p className="text-sm text-red-600 flex items-center gap-1">
                      <AlertCircle className="w-4 h-4" />
                      {errors.liquidation_amt}
                    </p>
                  )}
                </div>
              </div>
            </FormSection>
            )}

            {/* Attachments: only once the record exists */}
            {isEditMode && assetId && (
              <FormSection id="section-attachments" title="Attachments">
                <AttachmentManager
                  organizationId={organization.id}
                  entityType="asset"
                  entityId={assetId}
                  title="Asset Attachments"
                />
              </FormSection>
            )}

            {/* Read-only History Tables — Edit Mode Only */}
            {isEditMode && (
              <div className="space-y-4 pt-2 border-t border-gray-100">
                {/* Asset Change History */}
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <History className="w-4 h-4 text-gray-500" />
                    <h3 className="text-gray-900">Change History</h3>
                  </div>
                  <ActivityFeed entries={assetActivity} isLoading={isLoadingHistory} />
                </div>

                {/* Inventory Tracking */}
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <History className="w-4 h-4 text-gray-500" />
                    <h3 className="text-gray-900">Inventory Tracking</h3>
                    {inventoryTracking.length > 10 && (
                      <span className="text-xs text-gray-400 ml-1">(last 10 of {inventoryTracking.length})</span>
                    )}
                  </div>
                  {isLoadingHistory ? (
                    <div className="flex items-center gap-2 text-sm text-gray-500 py-4">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Loading tracking...
                    </div>
                  ) : inventoryTracking.length === 0 ? (
                    <p className="text-sm text-gray-400 py-2">No inventory scans recorded.</p>
                  ) : (
                    <div className="border rounded-md overflow-hidden">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Gig</TableHead>
                            <TableHead>Kit</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead>Scanned By</TableHead>
                            <TableHead>Scanned At</TableHead>
                            <TableHead>Notes</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {inventoryTracking.slice(0, 10).map((row) => (
                            <TableRow key={row.id}>
                              <TableCell className="font-medium">{row.gig?.title ?? '—'}</TableCell>
                              <TableCell>{row.kit?.name ?? '—'}</TableCell>
                              <TableCell>
                                <span className="inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium bg-sky-100 text-sky-800 border-sky-300">
                                  {row.status}
                                </span>
                              </TableCell>
                              <TableCell>
                                {row.scanned_by_user
                                  ? `${row.scanned_by_user.first_name} ${row.scanned_by_user.last_name}`.trim()
                                  : '—'}
                              </TableCell>
                              <TableCell className="text-gray-500 text-xs">
                                {format(new Date(row.scanned_at), 'PPp')}
                              </TableCell>
                              <TableCell className="text-gray-500 text-xs max-w-[160px] truncate">
                                {row.notes ?? '—'}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Actions */}
            <div className="flex items-center justify-end gap-3 pt-4 border-t border-gray-200">
              <Button variant="outline" onClick={onCancel} disabled={isSaving}>
                Cancel
              </Button>
              <Button
                onClick={handleSubmit}
                disabled={isSaving || (isEditMode && !changeDetection.hasChanges)}
                className="bg-sky-500 hover:bg-sky-600 text-white"
              >
                {isSaving ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Saving...
                  </>
                ) : isEditMode && !changeDetection.hasChanges ? (
                  <>
                    <Save className="w-4 h-4 mr-2" />
                    No Changes
                  </>
                ) : (
                  <>
                    <Save className="w-4 h-4 mr-2" />
                    {saveLabel}
                  </>
                )}
              </Button>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
