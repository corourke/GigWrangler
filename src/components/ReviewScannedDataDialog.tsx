import { useState, useEffect } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import {
  Loader2,
  Plus,
  Trash2,
  AlertCircle,
  FileIcon,
  Search,
  Maximize2,
  Layers,
  Tag,
  Pencil,
  HelpCircle,
  Package,
  X as CloseIcon
} from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';
import { format } from 'date-fns';
import { toast } from 'sonner';
import {
  createPurchaseWithUnits,
  addLineUnits,
  getPurchaseWithDetails,
  updatePurchase,
  createPurchase,
  deletePurchase,
  computeAssetFieldChanges,
  createLedgerEntryForPurchaseLine,
  type AssetFieldChange,
} from '../services/purchase.service';
import { getLockedTaxYears } from '../services/taxYear.service';
import {
  suggestedTaxTreatment,
  isTaxYearLocked,
  lineTaxTreatment,
  TAX_TREATMENT_HELP,
  type TaxTreatment,
} from '../utils/taxTreatment';
import { getGigFinancials, updateGigFinancial } from '../services/gig.service';
import { uploadAttachment, linkAttachmentToEntity, getAttachmentUrl } from '../services/attachment.service';
import { updateAsset, deleteAsset } from '../services/asset.service';
import { getItems } from '../services/equipmentItem.service';
import EquipmentDetailsDialog, { type EquipmentDetails } from './purchases/EquipmentDetailsDialog';
import type { FormUnitRow } from './equipment/form/UnitOrLotSection';
import { emptyItemDraft, draftCategory, type ItemOption } from './equipment/form/itemDraft';
import { buildLineUnits, resizeUnitRows, unitRowProblems, type ItemChoice, type LineUnitInput } from '../utils/lineUnits';
import { getExpenseCategories, getEquipmentCategories, getEquipmentCategoryPeriods, type ExpenseCategory } from '../services/purchaseCategory.service';
import { asRecoveryPeriod, effectiveRecoveryPeriod, recoveryPeriodLabel, type CategoryPeriods, type RecoveryPeriod } from '../utils/recoveryPeriod';
import { retargetCategories, equipmentCategoryOf, tidyAssetCategory } from '../utils/purchaseCategories';

function NumericInput({ value, onChange, placeholder = '0.00', className = '', disabled = false }: {
  value: number;
  onChange: (v: number) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
}) {
  const [raw, setRaw] = useState<string | null>(null);
  const displayed = raw !== null ? raw : (value === 0 ? '' : String(value));

  return (
    <Input
      type="text"
      disabled={disabled}
      value={displayed}
      onChange={e => {
        let v = e.target.value.replace(/[^0-9.]/g, '');
        // Allow only one decimal point
        const dots = v.split('.').length - 1;
        if (dots > 1) {
          const parts = v.split('.');
          v = parts[0] + '.' + parts.slice(1).join('');
        }
        setRaw(v);
        const num = parseFloat(v);
        if (!isNaN(num)) {
          if (num !== value) onChange(num);
        } else if (v === '') {
          if (value !== 0) onChange(0);
        }
      }}
      onBlur={() => setRaw(null)}
      placeholder={placeholder}
      className={className}
    />
  );
}

interface ScannedItem {
  description: string;
  quantity: number;
  item_price: number;
  item_cost: number;
  /** Track as equipment (an `assets` record). Always true when depreciated. */
  is_asset: boolean;
  /** Expense or depreciate; null while a grey-zone line is undecided (#133). */
  tax_treatment?: TaxTreatment | null;
  /** The user (or a saved purchase) chose the treatment, so price changes don't re-suggest it. */
  _taxChosen?: boolean;
  is_durable?: boolean;
  /** Make and model as read by the scan; the equipment record's Manufacturer/Model. */
  manufacturer_model?: string;
  /** Expensed: the expense category. Depreciated: the equipment category (see utils/purchaseCategories). */
  category?: string;
  /** The equipment category of an expensed line tracked as equipment (its asset's category). */
  asset_category?: string;
  /**
   * Equipment details, edited in the pop-up (#183): the item, units (a serial or tag
   * each) or a lot, the value, and a depreciated line's chosen recovery period.
   * Unset until the pop-up is used: a lot of the line's quantity.
   */
  equipment?: EquipmentDetails;
  // Edit-mode tracking (present only when editing an existing purchase)
  _purchaseId?: string;
  _assetId?: string | null;
  _gigId?: string | null;
  /** The units, or the lot, the saved line already has (#183). */
  _records?: any[];
  /** The line's quantity as loaded. */
  _loadedQuantity?: number;
  /** The line's unit price and cost, and its stored totals, as loaded (#330). */
  _loadedTotals?: { item_price: number; item_cost: number; line_amount: number | null; line_cost: number | null };
  /** The equipment as loaded: per-unit values are sent only when the pop-up changed them. */
  _savedEquipment?: EquipmentDetails;
}

interface UpdatePlan {
  headerData: Record<string, any>;
  updatedItems: { id: string; data: Record<string, any> }[];
  newItems: Record<string, any>[];
  removedItemIds: string[];
  assetChanges: { assetId: string; itemDescription: string; changes: AssetFieldChange[]; data: Record<string, any> }[];
  /** `settle`: the row was settled, so its settled amount follows the new amount. */
  gigChanges: { finId: string; label: string; from: number; to: number; settle?: boolean }[];
  /** Existing lines to start tracking as equipment (before their treatment is saved), with their units. */
  trackLines: { id: string; units: LineUnitInput[]; period: RecoveryPeriod | null }[];
  /** Saved lines getting more units: the rows filled in for them (#183). */
  addUnits: { lineId: string; description: string; units: LineUnitInput[] }[];
  /** Saved lines whose quantity no longer matches their equipment: update it, or leave it (#183). */
  mismatches: LineMismatch[];
  /** The purchase is in a filed year: only descriptions and equipment links change. */
  locked: boolean;
}

/** A saved line's quantity now differs from its equipment (#183). */
/** What to do with a line's equipment when its quantity changed (#183). */
interface LineDecision {
  mode: 'update' | 'leave';
  /** Units ticked to come off the line. */
  remove: string[];
  /** Asked each time (Cameron, 10-09): delete them, or keep them as Inactive, off the line. */
  how?: 'delete' | 'inactive';
}

interface LineMismatch {
  lineId: string;
  description: string;
  kind: 'units' | 'lot';
  /** The line's quantity now. */
  quantity: number;
  /** Units: the saved units, by label. Lot: the lot, with its saved quantity. */
  records: { id: string; label: string; quantity: number }[];
  /** The record the line points at (purchases.asset_id). */
  markerId: string | null;
  /** Saved like this before (the line wasn't changed here): left as it is then. */
  leftBefore: boolean;
}

/**
 * A line's cost total (#330): a saved line's stored line_cost, unless this edit changed its
 * quantity or unit cost (its own price, or its share of tax and shipping when the total is
 * re-spread); then quantity × unit cost. A stored total may differ by cents, trimmed so the
 * lines add up to what was paid.
 */
function lineCost(item: ScannedItem): number {
  const was = item._loadedTotals;
  if (was?.line_cost != null && item.quantity === item._loadedQuantity && item.item_cost === was.item_cost) return Number(was.line_cost);
  return Number(((item.item_cost ?? 0) * item.quantity).toFixed(4));
}

/** A line's printed total, by the same rule (#330): stored, unless its quantity or unit price changed. */
function lineAmount(item: ScannedItem): number {
  const was = item._loadedTotals;
  if (was?.line_amount != null && item.quantity === item._loadedQuantity && item.item_price === was.item_price) return Number(was.line_amount);
  return Number(((item.item_price ?? 0) * item.quantity).toFixed(4));
}

const recordLabel = (r: any) =>
  r.tag_number?.trim() || (r.serial_number?.trim() ? `SN ${r.serial_number}` : `Lot of ${r.quantity ?? 1}`);

/** A saved line's equipment as the pop-up shows it (#183): its item, units or lot, and value. */
function savedEquipment(records: any[]): EquipmentDetails {
  const first = records[0];
  const isLot = records.some((r) => !(r.serial_number?.trim() || r.tag_number?.trim()));
  return {
    item: emptyItemDraft({ mode: 'existing', existing: {
      id: first.equipment_item_id, manufacturer_model: first.manufacturer_model, category: first.category,
      type: first.type ?? null, insurance_class: first.insurance_class ?? null, description: first.description ?? null,
    } }),
    kind: isLot ? 'lot' : 'units',
    units: isLot ? [] : records.map((r) => ({ id: r.id, serial_number: r.serial_number ?? '', tag_number: r.tag_number ?? '' })),
    replacement_value: first.replacement_value != null ? String(first.replacement_value) : '',
    insured: !!first.insurance_policy_added,
    recovery_period: asRecoveryPeriod(first.recovery_period),
  };
}

interface ScannedData {
  vendor: string;
  purchase_date: string;
  total_inv_amount: number;
  payment_method?: string;
  description?: string;
  category?: string;
  invoice_number?: string;
  items: ScannedItem[];
}

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
  const [lockedYears, setLockedYears] = useState<Set<number>>(new Set());
  const [expenseCats, setExpenseCats] = useState<ExpenseCategory[]>([]);
  const [equipmentCats, setEquipmentCats] = useState<string[]>([]);
  const [categoryPeriods, setCategoryPeriods] = useState<CategoryPeriods>({});
  /** The organization's items, for the Equipment details pop-up (#183). */
  const [itemOptions, setItemOptions] = useState<ItemOption[]>([]);
  /** Per saved line whose quantity changed: update its equipment (and which units go), or leave it (#183). */
  const [lineDecisions, setLineDecisions] = useState<Record<string, LineDecision>>({});
  /** The line whose Equipment details pop-up is open. */
  const [detailsIndex, setDetailsIndex] = useState<number | null>(null);
  const [originalDate, setOriginalDate] = useState<string | null>(null);
  // Judged on the saved date, so editing the date can't step around the lock.
  const purchaseLocked = isEditMode && isTaxYearLocked(originalDate, lockedYears);
  const [existingDoc, setExistingDoc] = useState<{ url: string; kind: 'image' | 'pdf' | 'other'; name: string } | null>(null);
  const [pendingPlan, setPendingPlan] = useState<UpdatePlan | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [showFullPreview, setShowFullPreview] = useState(false);
  const [pdfPageImages, setPdfPageImages] = useState<string[]>([]);
  const [magnifierEnabled, setMagnifierEnabled] = useState(false);
  const [magnifier, setMagnifier] = useState<{ show: boolean; pageX: number; pageY: number; src: string; bgX: number; bgY: number; bgW: number; bgH: number }>({ show: false, pageX: 0, pageY: 0, src: '', bgX: 0, bgY: 0, bgW: 0, bgH: 0 });

  useEffect(() => {
    if (file) {
      const url = URL.createObjectURL(file);
      setPreviewUrl(url);
      if (file.type === 'application/pdf') {
        renderPdfToImages(file);
      }
      return () => URL.revokeObjectURL(url);
    }
  }, [file]);

  async function renderPdfToImages(pdfFile: File) {
    try {
      const arrayBuffer = await pdfFile.arrayBuffer();
      const pdfjsLib = await import('pdfjs-dist');
      pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
        'pdfjs-dist/build/pdf.worker.min.mjs',
        import.meta.url
      ).toString();
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      const images: string[] = [];
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const viewport = page.getViewport({ scale: 2 });
        const canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        await page.render({ canvas, viewport }).promise;
        images.push(canvas.toDataURL('image/png'));
      }
      setPdfPageImages(images);
    } catch (err) {
      console.error('PDF render error:', err);
      setPdfPageImages([]);
    }
  }

  useEffect(() => {
    if (scannedData) {
      const description = scannedData.description
        || (scannedData.invoice_number ? `Invoice #${scannedData.invoice_number}` : '');
      setFormData(recalculateBurdenedCosts({
        ...scannedData,
        description,
        // The scanner's categories are equipment-style ("Audio"). Seeding each line as
        // depreciated lets withTaxDefaults move them into place for its suggested
        // treatment: an expensed line gets the matching expense heading.
        items: (scannedData.items || []).map(item => ({
          ...item,
          category: item.category ? tidyAssetCategory(item.category) : item.category,
          tax_treatment: item._taxChosen ? item.tax_treatment : 'depreciate',
          is_asset: item.is_asset ?? item.is_durable ?? false,
        }))
      }));
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

  // Filed (locked) tax years: their purchases keep their tax fields (#133).
  useEffect(() => {
    if (!open || !organizationId) return;
    let cancelled = false;
    getLockedTaxYears(organizationId).then(years => { if (!cancelled) setLockedYears(years); });
    getExpenseCategories(organizationId).then(c => { if (!cancelled) setExpenseCats(c); });
    getEquipmentCategories(organizationId).then(c => { if (!cancelled) setEquipmentCats(c); });
    getEquipmentCategoryPeriods(organizationId).then(p => { if (!cancelled) setCategoryPeriods(p); });
    getItems(organizationId)
      .then(list => { if (!cancelled) setItemOptions((list ?? []).map(i => ({
        id: i.id, manufacturer_model: i.manufacturer_model, category: i.category,
        type: i.type ?? null, insurance_class: i.insurance_class ?? null, description: i.description ?? null,
      }))); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [open, organizationId]);

  // Edit mode: load the existing purchase, its linked assets, and gig ledger rows.
  useEffect(() => {
    if (!open || !editPurchaseId) return;
    let cancelled = false;
    setExistingDoc(null);
    setPendingPlan(null);
    (async () => {
      try {
        const details: any = await getPurchaseWithDetails(editPurchaseId);
        if (cancelled) return;

        const items: any[] = details.items || [];
        const aById: Record<string, any> = {};
        (details.assets || []).forEach((a: any) => { aById[a.id] = a; });
        setAssetsById(aById);
        setOriginalItemIds(items.map((it) => it.id));
        setOriginalDate(details.purchase_date || null);

        // Show what is stored. Recomputing here would zero cost-only lines (CSV
        // imports have no printed price) and rescale lines that don't add up to
        // the total; the mismatch warning flags those instead (#128).
        setFormData({
          vendor: details.vendor || '',
          purchase_date: details.purchase_date || format(new Date(), 'yyyy-MM-dd'),
          total_inv_amount: details.total_inv_amount || 0,
          payment_method: details.payment_method || undefined,
          description: details.description || '',
          category: details.category || undefined,
          items: items.map((it) => {
            // The line's units or lot (#183): its own records, or the one it names.
            const own = (details.assets || []).filter((a: any) => a.purchase_line_id === it.id);
            const records: any[] = own.length ? own : it.asset_id && aById[it.asset_id] ? [aById[it.asset_id]] : [];
            return {
              description: it.description || '',
              quantity: it.quantity || 1,
              item_price: it.item_price || 0,
              item_cost: it.item_cost || 0,
              is_asset: !!it.asset_id,
              tax_treatment: lineTaxTreatment(it) ?? 'expense',
              _taxChosen: true,
              category: it.category || '',
              asset_category: it.asset_id && lineTaxTreatment(it) !== 'depreciate'
                ? aById[it.asset_id]?.category ?? undefined : undefined,
              equipment: records.length ? savedEquipment(records) : undefined,
              _savedEquipment: records.length ? savedEquipment(records) : undefined,
              _records: records.length ? records : undefined,
              _purchaseId: it.id,
              _assetId: it.asset_id || null,
              _loadedQuantity: it.quantity || 1,
              _loadedTotals: {
                item_price: it.item_price || 0, item_cost: it.item_cost || 0,
                line_amount: it.line_amount ?? null, line_cost: it.line_cost ?? null,
              },
              _gigId: it.gig_id || null,
            };
          }),
        });

        // Gig ledger rows linked by purchase_id, across every distinct linked gig.
        const gigIds = Array.from(new Set(
          [details.gig_id, ...items.map((it) => it.gig_id)].filter(Boolean)
        )) as string[];
        const lByPid: Record<string, any> = {};
        for (const gid of gigIds) {
          try {
            const rows: any[] = await getGigFinancials(gid, organizationId);
            (rows || []).forEach((r) => { if (r.purchase_id) lByPid[r.purchase_id] = r; });
          } catch { /* non-fatal */ }
        }
        if (!cancelled) setLedgerByPurchaseId(lByPid);

        // Show the existing attached document in the preview pane.
        const att: any = (details.attachments || [])[0];
        if (att?.file_path) {
          try {
            const url = await getAttachmentUrl(att.file_path);
            const ext = (att.file_name || '').split('.').pop()?.toLowerCase() || '';
            const kind = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'].includes(ext)
              ? 'image' : ext === 'pdf' ? 'pdf' : 'other';
            if (!cancelled) setExistingDoc({ url, kind, name: att.file_name });
          } catch { /* non-fatal */ }
        }
      } catch (err: any) {
        console.error('Error loading purchase for edit:', err);
        toast.error('Failed to load purchase');
      }
    })();
    return () => { cancelled = true; };
  }, [open, editPurchaseId, organizationId]);

  // Spread the invoice total across the lines in proportion to each line's
  // printed price, or its stored cost when it has no price (CSV imports, #128).
  function recalculateBurdenedCosts(data: ScannedData): ScannedData {
    const basis = (item: ScannedItem) => (item.item_price > 0 ? item.item_price : item.item_cost ?? 0);
    const totalBasis = data.items.reduce((sum, item) => sum + basis(item) * item.quantity, 0);
    if (totalBasis <= 0 || data.total_inv_amount <= 0) {
      return withTaxDefaults({ ...data, items: data.items.map(item => ({ ...item, item_cost: basis(item) })) });
    }
    const burdenFactor = data.total_inv_amount / totalBasis;
    return withTaxDefaults({
      ...data,
      items: data.items.map(item => ({
        ...item,
        item_cost: Number((basis(item) * burdenFactor).toFixed(4))
      }))
    });
  }

  // Pre-set each line's tax treatment from its per-item cost until the user
  // chooses one (#133): expense under $200, depreciate over $2,500, open between.
  // A depreciated line is always tracked as equipment.
  function withTaxDefaults(data: ScannedData): ScannedData {
    return {
      ...data,
      items: data.items.map(item => {
        const tax_treatment = item._taxChosen ? item.tax_treatment ?? null : suggestedTaxTreatment(item.item_cost ?? 0);
        return {
          ...retargetCategories(item, item.tax_treatment, tax_treatment),
          tax_treatment,
          is_asset: item.is_asset || tax_treatment === 'depreciate',
        };
      }),
    };
  }

  if (!open || !formData) return null;

  // A depreciated line's recovery period (#125): chosen, else its category's default.
  const periodOf = (item: ScannedItem): RecoveryPeriod | null =>
    item.tax_treatment === 'depreciate'
      ? effectiveRecoveryPeriod(item.equipment?.recovery_period, categoryPeriods, equipmentCategoryOf(item))
      : null;

  // ---- A line's equipment (#183) ----
  /** Its details; until the pop-up is used, a lot of the line's quantity, named from the line. */
  const equipmentOf = (item: ScannedItem): EquipmentDetails => item.equipment ?? {
    // A new item, named by the scan's make and model (#131) else the line, described by the line.
    item: emptyItemDraft({ manufacturer_model: item.manufacturer_model?.trim() || item.description, category: equipmentCategoryOf(item),
      description: item.description }),
    kind: 'lot', units: [], replacement_value: '', insured: false, recovery_period: null,
  };
  /** How many pieces a saved line's equipment already has. */
  const savedPieces = (item: ScannedItem) => (item._records ?? []).reduce((n, r) => n + (Number(r.quantity) || 1), 0);
  /**
   * Its unit rows: a new line's follow its quantity; a saved line keeps its units and
   * gets a row for each piece it doesn't have yet. Rows without an id are new units.
   */
  const unitRowsOf = (item: ScannedItem) => {
    const eq = equipmentOf(item);
    if (!item._records?.length) return resizeUnitRows(eq.units, item.quantity) as FormUnitRow[];
    const fresh = eq.units.filter(u => !u.id);
    const extra = Math.max(0, item.quantity - savedPieces(item));
    return [...eq.units.filter(u => u.id), ...Array.from({ length: extra }, (_, i): FormUnitRow => fresh[i] ?? { serial_number: '', tag_number: '' })];
  };
  /** Why its units can't be saved yet (a unit with neither a serial nor a tag, or one used twice). */
  const unitProblemOf = (item: ScannedItem): string | null => {
    if (!item.is_asset && item.tax_treatment !== 'depreciate') return null;
    if (equipmentOf(item).kind !== 'units') return null;
    return unitRowProblems(unitRowsOf(item))[0] ?? null;
  };
  const itemChoiceOf = (item: ScannedItem, eq: EquipmentDetails): ItemChoice => {
    const ex = eq.item.mode === 'existing' ? eq.item.existing : null;
    return ex
      ? { equipment_item_id: ex.id, manufacturer_model: ex.manufacturer_model, category: ex.category,
          type: ex.type, insurance_class: ex.insurance_class, description: ex.description }
      : { manufacturer_model: eq.item.manufacturer_model.trim() || item.manufacturer_model?.trim() || item.description,
          category: equipmentCategoryOf(item) || eq.item.category || item.category || formData.category || '',
          type: eq.item.type, insurance_class: eq.item.insurance_class, description: eq.item.description };
  };
  /** The new records a line makes: one per new unit row, or its lot. */
  const newUnitsOf = (item: ScannedItem, lineIndex: number): LineUnitInput[] => {
    const eq = equipmentOf(item);
    const rows = unitRowsOf(item).filter(r => !r.id);
    const n = eq.kind === 'units' ? rows.length : item.quantity;
    if (n < 1) return [];
    return buildLineUnits(organizationId, lineIndex, n, {
      item: itemChoiceOf(item, eq), kind: eq.kind, units: rows,
      // Like the line's printed price unless one was entered.
      replacement_value: eq.replacement_value.trim() ? parseFloat(eq.replacement_value) : (item.item_price || null),
      insured: eq.insured, recovery_period: periodOf(item),
    });
  };
  const withoutIndex = (units: LineUnitInput[]) => units.map(({ line_index: _i, ...u }) => u);

  const ZOOM = 3;
  const MAG_R = 90;

  const handleImgMouseMove = (src: string) => (e: React.MouseEvent<HTMLImageElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const relX = e.clientX - rect.left;
    const relY = e.clientY - rect.top;
    const bgW = rect.width * ZOOM;
    const bgH = rect.height * ZOOM;
    // To show the point (relX, relY) in the center (MAG_R, MAG_R) of the container:
    // bgX = center_of_container - (relX_on_original * ZOOM)
    const bgX = MAG_R - relX * ZOOM;
    const bgY = MAG_R - relY * ZOOM;
    setMagnifier({ show: true, pageX: e.clientX, pageY: e.clientY, src, bgX, bgY, bgW, bgH });
  };

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
      const items = formData.items.map(item => ({
        organization_id: organizationId,
        purchase_date: formData.purchase_date,
        vendor: formData.vendor,
        description: item.description,
        quantity: item.quantity,
        item_price: item.item_price,
        item_cost: item.item_cost,
        line_amount: item.item_price * item.quantity,
        line_cost: item.item_cost * item.quantity,
        category: item.category || formData.category,
        // One line type (10-07); the tax treatment is its own choice, and a tracked
        // line's equipment is in `units`.
        row_type: 'line' as const,
        tax_treatment: item.tax_treatment ?? undefined,
      }));

      // One record per unit, or one lot, for each tracked line (#183).
      const units = formData.items.flatMap((item, i) => (item.is_asset ? newUnitsOf(item, i) : []));
      const result = await createPurchaseWithUnits(header, items, units);

      // Scanned on a gig: each expensed line is a cost of the gig, with its own
      // money-out row. The purchase itself, and depreciated equipment, are not (#130, #133).
      if (gigId) {
        try {
          const saved = await getPurchaseWithDetails(result.id);
          const expensed = (saved?.items ?? []).filter((it: any) => lineTaxTreatment(it) === 'expense');
          for (const line of expensed) {
            await updatePurchase(line.id, { gig_id: gigId });
            await createLedgerEntryForPurchaseLine(line, gigId, organizationId);
          }
          window.dispatchEvent(new CustomEvent('gig-financials-updated', { detail: { gigId } }));
        } catch (finErr) {
          console.error('Error linking receipt lines to the gig:', finErr);
          toast.error('Purchase created, but its lines could not be added to the gig');
        }
      }

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

  // Build the set of DB writes implied by the current edit, including proposed
  // changes to linked equipment and gig ledger entries (surfaced for confirmation).
  const buildUpdatePlan = (fd: ScannedData): UpdatePlan => {
    // Existing lines newly ticked "Track as equipment" (or depreciated) get their
    // units first, so a depreciated line always has equipment.
    const trackLines = fd.items
      .filter(item => item._purchaseId && !item._assetId && item.is_asset)
      .map(item => ({ id: item._purchaseId!, units: withoutIndex(newUnitsOf(item, 0)), period: periodOf(item) }));

    // A saved line's units filled in for its new pieces (#183).
    const addUnits = fd.items
      .filter(item => item._purchaseId && item._records?.length && equipmentOf(item).kind === 'units')
      .map(item => ({ lineId: item._purchaseId!, description: item.description || '(item)', units: withoutIndex(newUnitsOf(item, 0)) }))
      .filter(a => a.units.length > 0);

    // The pop-up's changes to a saved line's equipment, record by record. Equipment
    // isn't a tax record, so this applies in a filed year too.
    const detailChanges = (item: ScannedItem, record: any): AssetFieldChange[] => {
      if (!item.equipment) return [];
      const eq = item.equipment;
      const norm = (v: unknown) => (v === undefined || v === null || v === '' ? null : v);
      const out: AssetFieldChange[] = [];
      const cmp = (field: string, label: string, to: unknown) => {
        const from = field === 'replacement_value' ? (record[field] == null ? null : Number(record[field])) : norm(record[field]);
        const next = field === 'replacement_value' ? (to === '' || to == null ? null : Number(to)) : norm(typeof to === 'string' ? to.trim() : to);
        if (from !== next) out.push({ field, label, from, to: next });
      };
      const row = eq.units.find(u => u.id === record.id);
      if (row) {
        cmp('serial_number', 'Serial Number', row.serial_number);
        cmp('tag_number', 'Tag Number', row.tag_number);
      }
      // The pop-up shows the first unit's values; a unit edited on its own keeps its own
      // unless the pop-up changed them (#183).
      const was = item._savedEquipment;
      if (!was || eq.replacement_value !== was.replacement_value) cmp('replacement_value', 'Replacement Value', eq.replacement_value);
      if ((!was || eq.insured !== was.insured) && !!record.insurance_policy_added !== eq.insured) {
        out.push({ field: 'insurance_policy_added', label: 'Insured', from: !!record.insurance_policy_added, to: eq.insured });
      }
      // A period chosen in the pop-up, or a unit with none yet (a line newly depreciated).
      if (item.tax_treatment === 'depreciate' && (!was || eq.recovery_period !== was.recovery_period || record.recovery_period == null)) {
        cmp('recovery_period', 'Recovery period', periodOf(item));
      }
      return out;
    };
    const toAssetChange = (item: ScannedItem, record: any, changes: AssetFieldChange[]) => {
      const data: Record<string, any> = {};
      changes.forEach(c => { data[c.field] = c.to; });
      const many = (item._records?.length ?? 0) > 1;
      return { assetId: record.id, itemDescription: `${item.description || '(item)'}${many ? ` · ${recordLabel(record)}` : ''}`, changes, data };
    };
    const recordsOf = (item: ScannedItem): any[] => item._records ?? (item._assetId && assetsById[item._assetId] ? [assetsById[item._assetId]] : []);

    // A filed year: only descriptions (and equipment links) may change (#133).
    if (purchaseLocked) {
      return {
        headerData: { description: fd.description, vendor: fd.vendor, payment_method: fd.payment_method },
        updatedItems: fd.items
          .filter(item => item._purchaseId)
          .map(item => ({ id: item._purchaseId!, data: { description: item.description } })),
        newItems: [],
        removedItemIds: [],
        assetChanges: fd.items.flatMap(item => recordsOf(item).map(record => {
          const changes = detailChanges(item, record);
          return changes.length ? toAssetChange(item, record, changes) : null;
        })).filter((c): c is NonNullable<typeof c> => !!c),
        gigChanges: [],
        trackLines,
        addUnits,
        mismatches: [],
        locked: true,
      };
    }

    const headerData = {
      vendor: fd.vendor,
      purchase_date: fd.purchase_date,
      description: fd.description,
      total_inv_amount: fd.total_inv_amount,
      payment_method: fd.payment_method,
      category: fd.category,
    };

    const updatedItems: UpdatePlan['updatedItems'] = [];
    const newItems: UpdatePlan['newItems'] = [];
    const presentIds = new Set<string>();

    for (const item of fd.items) {
      const lineData = {
        description: item.description,
        quantity: item.quantity,
        item_price: item.item_price,
        item_cost: item.item_cost,
        line_amount: lineAmount(item),
        line_cost: lineCost(item),
        category: item.category || fd.category,
        tax_treatment: item.tax_treatment ?? 'expense',
        // Lines take the purchase's date (#131), so none lands in the wrong tax year.
        purchase_date: fd.purchase_date,
      };
      if (item._purchaseId) {
        presentIds.add(item._purchaseId);
        updatedItems.push({ id: item._purchaseId, data: lineData });
      } else {
        newItems.push({
          organization_id: organizationId,
          parent_id: editPurchaseId,
          row_type: 'line',
          vendor: fd.vendor,
          ...lineData,
          _track: item.is_asset,
          _units: item.is_asset ? withoutIndex(newUnitsOf(item, 0)) : [],
          _period: periodOf(item),
        });
      }
    }

    const removedItemIds = originalItemIds.filter(id => !presentIds.has(id));

    // Equipment changes: the line's price, cost, vendor and date reach each of its
    // records, with the pop-up's changes. Its name and category are the item's (#183).
    const assetChanges: UpdatePlan['assetChanges'] = [];
    for (const item of fd.items) {
      for (const record of recordsOf(item)) {
        const changes = computeAssetFieldChanges(
          { item_price: item.item_price, item_cost: item.item_cost, vendor: fd.vendor, purchase_date: fd.purchase_date },
          record,
        ).concat(detailChanges(item, record));
        if (changes.length > 0) assetChanges.push(toAssetChange(item, record, changes));
      }
    }

    // A saved line's quantity that no longer matches its equipment: fewer units, or a lot of another size.
    const mismatches: LineMismatch[] = fd.items.flatMap((item): LineMismatch[] => {
      const records = recordsOf(item);
      if (!item._purchaseId || !records.length) return [];
      const lot = equipmentOf(item).kind === 'lot';
      const have = records.reduce((n, r) => n + (Number(r.quantity) || 1), 0);
      if (lot ? have === item.quantity : have <= item.quantity) return [];
      return [{
        lineId: item._purchaseId, description: item.description || '(item)', kind: lot ? 'lot' : 'units', quantity: item.quantity,
        records: records.map(r => ({ id: r.id, label: recordLabel(r), quantity: Number(r.quantity) || 1 })),
        markerId: item._assetId ?? null,
        leftBefore: item._loadedQuantity === item.quantity,
      }];
    });

    // Gig ledger changes — header total and any per-line linked ledger amounts.
    const gigChanges: UpdatePlan['gigChanges'] = [];
    const headerLedger = editPurchaseId ? ledgerByPurchaseId[editPurchaseId] : null;
    if (headerLedger && Number(headerLedger.amount) !== Number(fd.total_inv_amount)) {
      gigChanges.push({ finId: headerLedger.id, label: 'Invoice total → gig ledger', from: Number(headerLedger.amount), to: Number(fd.total_inv_amount) });
    }
    for (const item of fd.items) {
      if (!item._purchaseId) continue;
      const led = ledgerByPurchaseId[item._purchaseId];
      if (!led) continue;
      // The line's cost, with its share of tax and shipping (#131), not the printed price.
      const newAmt = Number(lineCost(item).toFixed(2));
      if (Number(led.amount) !== newAmt) {
        gigChanges.push({ finId: led.id, label: `${item.description || 'Line item'} → gig ledger`, from: Number(led.amount), to: newAmt,
          settle: led.amount_settled != null });
      }
    }

    return { headerData, updatedItems, newItems, removedItemIds, assetChanges, gigChanges, trackLines, addUnits, mismatches, locked: false };
  };

  /** Each mismatch's choice is made: leave it, or update it (for units, exactly the extra ones ticked). */
  const mismatchesDecided = (plan: UpdatePlan) => plan.mismatches.every(m => {
    const d = lineDecisions[m.lineId];
    if (!d) return false;
    if (d.mode === 'leave' || m.kind === 'lot') return true;
    return d.remove.length === m.records.length - m.quantity && !!d.how;
  });

  const commitUpdate = async (plan: UpdatePlan) => {
    if (!editPurchaseId) return;
    setIsSubmitting(true);
    try {
      // Quantities that no longer match their equipment, as chosen (#183). These go first: if the
      // database refuses one, nothing else is saved yet.
      for (const m of plan.mismatches) {
        const d = lineDecisions[m.lineId];
        if (!d || d.mode === 'leave') continue;
        if (m.kind === 'lot') { await updateAsset(m.records[0].id, { quantity: m.quantity }); continue; }
        // A depreciated line must keep an equipment record: point it at a unit that stays first.
        if (m.markerId && d.remove.includes(m.markerId)) {
          const kept = m.records.find(r => !d.remove.includes(r.id));
          if (kept) await updatePurchase(m.lineId, { asset_id: kept.id });
        }
        for (const id of d.remove) {
          if (d.how === 'inactive') await updateAsset(id, { status: 'Inactive', purchase_line_id: null });
          else await deleteAsset(id);
        }
      }
      await updatePurchase(editPurchaseId, plan.headerData);
      // Chosen recovery periods of new units: set once their lines are depreciated (#125).
      const periods: [string, RecoveryPeriod][] = [];
      const track = async (lineId: string, units: LineUnitInput[], period: RecoveryPeriod | null) => {
        if (!units.length) return;
        const ids = await addLineUnits(lineId, units);
        if (period) ids.forEach(id => periods.push([id, period]));
      };
      for (const t of plan.trackLines) await track(t.id, t.units, t.period);
      for (const u of plan.updatedItems) await updatePurchase(u.id, u.data);
      for (const { _track, _units, _period, ...n } of plan.newItems) {
        // A depreciated line needs its equipment before it is depreciated.
        const wanted = n.tax_treatment;
        const created: any = await createPurchase({ ...n, tax_treatment: _track ? 'expense' : wanted });
        if (_track && created?.id) {
          await track(created.id, _units, _period);
          if (wanted === 'depreciate') await updatePurchase(created.id, { tax_treatment: 'depreciate' });
        }
      }
      for (const a of plan.addUnits) await addLineUnits(a.lineId, a.units);
      for (const id of plan.removedItemIds) await deletePurchase(id);
      for (const [assetId, recovery_period] of periods) await updateAsset(assetId, { recovery_period });
      const removed = new Set(plan.mismatches.flatMap(m => lineDecisions[m.lineId]?.mode === 'update' ? lineDecisions[m.lineId].remove : []));
      for (const a of plan.assetChanges) if (!removed.has(a.assetId)) await updateAsset(a.assetId, a.data);
      for (const g of plan.gigChanges) {
        await updateGigFinancial(g.finId, g.settle ? { amount: g.to, amount_settled: g.to } : { amount: g.to });
      }

      if (file) {
        try {
          const attachment = await uploadAttachment(organizationId, file);
          if (attachment) await linkAttachmentToEntity(attachment.id, 'purchase', editPurchaseId);
        } catch (uploadErr) {
          console.error('Error uploading attachment:', uploadErr);
          toast.error('Purchase updated, but failed to upload the new document');
        }
      }

      if (plan.gigChanges.length > 0) {
        window.dispatchEvent(new CustomEvent('gig-financials-updated', {}));
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
    const plan = buildUpdatePlan(formData);
    if (plan.assetChanges.length > 0 || plan.gigChanges.length > 0 || plan.mismatches.length > 0) {
      // A line left as it is on an earlier save starts at Leave, so one click can't remove units.
      setLineDecisions(Object.fromEntries(plan.mismatches.filter(m => m.leftBefore).map(m => [m.lineId, { mode: 'leave' as const, remove: [] }])));
      setPendingPlan(plan); // show confirmation first
    } else {
      commitUpdate(plan);
    }
  };

  const fmtVal = (v: unknown) => (v === null || v === undefined || v === '' ? '—' : String(v));

  const calculatedTotalCost = formData.items.reduce((sum, item) => sum + lineCost(item), 0);
  const diff = Math.abs(calculatedTotalCost - formData.total_inv_amount);
  const hasMismatch = diff > 0.05;
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
  const isImage = file?.type.startsWith('image/');
  const isPdf = file?.type === 'application/pdf';

  const renderMagnifiableImage = (src: string, alt: string) => (
    <img
      src={src}
      alt={alt}
      style={{ maxWidth: '100%', display: 'block', borderRadius: 4, cursor: magnifierEnabled ? 'crosshair' : 'default', pointerEvents: magnifierEnabled ? 'auto' : 'none' }}
      onMouseMove={magnifierEnabled ? handleImgMouseMove(src) : undefined}
      onMouseLeave={magnifierEnabled ? () => setMagnifier(prev => ({ ...prev, show: false })) : undefined}
    />
  );

  // Tracking can't be undone here (manage the equipment from its asset page),
  // and a depreciated line is always tracked.
  const equipmentLocked = (item: ScannedItem) => (isEditMode && !!item._assetId) || item.tax_treatment === 'depreciate';
  const equipmentTitle = (item: ScannedItem) =>
    isEditMode && item._assetId ? 'Tracked as equipment. Manage it from its asset page.'
      : item.tax_treatment === 'depreciate' ? 'Depreciated items are always tracked as equipment'
      : item.is_asset ? 'Tracked as equipment (can go in kits)' : 'Track as equipment';

  const renderTaxChoice = (item: ScannedItem, index: number) => {
    const isGigExpense = !!(item._purchaseId && ledgerByPurchaseId[item._purchaseId]);
    const option = (value: TaxTreatment, label: string) => {
      const blocked = purchaseLocked || (value === 'depreciate' && isGigExpense);
      const on = item.tax_treatment === value;
      return (
        <button
          type="button"
          aria-pressed={on}
          disabled={blocked}
          title={value === 'depreciate' && isGigExpense ? 'This line is a gig expense. Remove it from the gig first.' : undefined}
          onClick={() => handleItemChange(index, 'tax_treatment', value)}
          style={{
            height: 18, padding: '0 6px', fontSize: 9, fontWeight: 600, border: 'none', cursor: blocked ? 'not-allowed' : 'pointer',
            background: on ? (value === 'expense' ? '#7f1d1d' : '#0369a1') : 'white',
            color: on ? 'white' : blocked ? '#d1d5db' : '#4b5563',
          }}
        >
          {label}
        </button>
      );
    };
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0 }}>
        <div
          role="group"
          aria-label={`Tax treatment: ${item.description || 'item'}`}
          style={{ display: 'inline-flex', borderRadius: 3, overflow: 'hidden', border: `1px solid ${item.tax_treatment ? '#d1d5db' : '#f59e0b'}` }}
        >
          {option('expense', 'Expense')}
          <span style={{ width: 1, background: '#d1d5db' }} />
          {option('depreciate', 'Depreciate')}
        </div>
        <Popover>
          <PopoverTrigger asChild>
            <button type="button" aria-label="About expense or depreciate" style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: '#9ca3af', display: 'flex' }}>
              <HelpCircle style={{ width: 12, height: 12 }} />
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-72 text-xs leading-relaxed">{TAX_TREATMENT_HELP}</PopoverContent>
        </Popover>
      </div>
    );
  };

  // One control (10-07): the Equipment switch, then, when it's on, the details
  // button (Category › Type | kits) in the same pill. Off, the pill reads
  // "Equipment"; on, the details take its place, amber until a category is chosen.
  const renderEquipment = (item: ScannedItem, index: number) => {
    const locked = equipmentLocked(item);
    const on = item.is_asset || item.tax_treatment === 'depreciate';
    const category = equipmentCategoryOf(item);
    const eq = equipmentOf(item);
    const type = (eq.item.mode === 'existing' ? eq.item.existing?.type ?? '' : eq.item.type).trim();
    const missing = on && !category;
    const depreciated = item.tax_treatment === 'depreciate';
    const period = periodOf(item);
    const noPeriodHere = depreciated && !missing && !period;
    const noUnitsHere = on && !missing && !!unitProblemOf(item);
    const amber = missing || noPeriodHere || noUnitsHere;
    const count = eq.kind === 'units' ? unitRowsOf(item).length : item.quantity;
    const edge = !on ? '#94a3b8' : amber ? '#f59e0b' : '#0369a1';
    return (
      <div
        role="group"
        aria-label={`Equipment: ${item.description || 'item'}`}
        style={{
          height: 20, display: 'inline-flex', alignItems: 'stretch', maxWidth: '100%', minWidth: 0, flex: '0 1 auto',
          borderRadius: 999, border: `1.5px solid ${edge}`, overflow: 'hidden',
          background: !on ? 'white' : amber ? '#fffbeb' : '#f0f9ff',
          opacity: locked && !on ? 0.5 : 1,
        }}
      >
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-label={`Track ${item.description || 'item'} as equipment`}
          title={equipmentTitle(item)}
          disabled={locked}
          onClick={() => handleItemChange(index, 'is_asset', !on)}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 4, flexShrink: 0, padding: on ? '0 4px 0 3px' : '0 8px 0 3px',
            border: 'none', background: 'transparent', color: '#475569', fontSize: 10, fontWeight: 700,
            cursor: locked ? 'not-allowed' : 'pointer',
          }}
        >
          <span aria-hidden style={{ width: 22, height: 12, borderRadius: 999, background: on ? edge : '#cbd5e1', position: 'relative', flexShrink: 0 }}>
            <span style={{ position: 'absolute', top: 1, left: on ? 11 : 1, width: 10, height: 10, borderRadius: 999, background: 'white', boxShadow: '0 1px 1px rgba(0,0,0,0.3)' }} />
          </span>
          {!on && <><Package style={{ width: 12, height: 12 }} />Equipment</>}
        </button>
        {on && (
          <button
            type="button"
            aria-label={`Equipment details: ${item.description || 'item'}`}
            title="Equipment details"
            onClick={() => setDetailsIndex(index)}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 5, minWidth: 0, padding: '0 8px 0 2px',
              border: 'none', background: 'transparent', fontSize: 10, fontWeight: 600, cursor: 'pointer',
              color: missing ? '#92400e' : '#0c4a6e',
            }}
          >
            <Package style={{ width: 11, height: 11, flexShrink: 0 }} />
            <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {missing ? 'Choose an equipment category' : type ? `${category} › ${type}` : category}
            </span>
            {depreciated && !missing && (
              <span title="Recovery period" style={{
                paddingLeft: 6, borderLeft: '1px solid #7dd3fc', whiteSpace: 'nowrap',
                color: noPeriodHere ? '#92400e' : undefined, fontWeight: noPeriodHere ? 700 : undefined,
              }}>
                {period ? recoveryPeriodLabel(period) : 'Choose a recovery period'}
              </span>
            )}
            {!missing && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, paddingLeft: 6, borderLeft: '1px solid #7dd3fc', whiteSpace: 'nowrap',
                color: noUnitsHere ? '#92400e' : undefined, fontWeight: noUnitsHere ? 700 : undefined }}>
                {eq.kind === 'units' ? <Tag style={{ width: 10, height: 10 }} aria-hidden /> : <Layers style={{ width: 10, height: 10 }} aria-hidden />}
                {noUnitsHere ? 'Serials or tags needed' : eq.kind === 'units' ? `${count} ${count === 1 ? 'unit' : 'units'}` : `lot of ${count}`}
              </span>
            )}
            <Pencil style={{ width: 10, height: 10, opacity: 0.7, flexShrink: 0 }} />
          </button>
        )}
      </div>
    );
  };

  const selectStyle: React.CSSProperties = { height: 20, fontSize: 10, border: '1px solid #e5e7eb', borderRadius: 4, background: 'white', padding: '0 2px', minWidth: 0, flex: 1 };
  const fieldLabel = (text: string) => <span style={{ fontSize: 7, color: '#9ca3af', fontWeight: 700, textTransform: 'uppercase', flexShrink: 0 }}>{text}</span>;

  const renderExpenseCategory = (item: ScannedItem, index: number) => {
    const value = item.category || '';
    const known = expenseCats.some(c => c.name === value);
    const needed = needsExpenseCategory(item);
    return (
      <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 2, flex: '0 1 240px', minWidth: 0 }}>
        {fieldLabel('Expense')}
        <select
          aria-label={`Expense category: ${item.description || 'item'}`}
          value={value}
          disabled={purchaseLocked}
          onChange={e => handleItemChange(index, 'category', e.target.value)}
          style={{ ...selectStyle, borderColor: value ? '#e5e7eb' : '#fcd34d' }}
        >
          <option value="">Choose…</option>
          {value && !known && <option value={value}>{value} (not on the list)</option>}
          {expenseCats.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
        </select>
        {needed && <span role="status" style={{ flexBasis: '100%', fontSize: 10, fontWeight: 600, color: '#92400e' }}>Choose an expense category</span>}
      </div>
    );
  };

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
    if (category && !equipmentCats.includes(category)) setEquipmentCats(c => [...c, category]);
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
        <div style={{ width: '45%', height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden', background: '#f3f4f6', borderRight: '1px solid #e5e7eb', position: 'relative' }}>
          <button
            onClick={() => setShowFullPreview(true)}
            style={{ position: 'absolute', top: 8, right: 8, zIndex: 20, background: 'rgba(255,255,255,0.9)', border: 'none', borderRadius: 4, padding: 6, cursor: 'pointer', boxShadow: '0 1px 3px rgba(0,0,0,0.15)' }}
            title="Full screen preview"
          >
            <Maximize2 className="w-4 h-4" />
          </button>

          <div style={{ flex: 1, overflow: 'auto', padding: 12, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
            {previewUrl && isImage && renderMagnifiableImage(previewUrl, 'Document Preview')}
            {isPdf && pdfPageImages.length > 0 && pdfPageImages.map((src, i) => (
              <div key={i}>{renderMagnifiableImage(src, `Page ${i + 1}`)}</div>
            ))}
            {isPdf && pdfPageImages.length === 0 && previewUrl && (
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9ca3af', fontSize: 14 }}>
                <Loader2 className="w-5 h-5 mr-2 animate-spin" /> Rendering PDF...
              </div>
            )}
            {/* Edit mode: render the already-attached document (no local file). */}
            {!previewUrl && existingDoc && existingDoc.kind === 'image' && (
              <img src={existingDoc.url} alt={existingDoc.name} style={{ maxWidth: '100%', display: 'block', borderRadius: 4 }} />
            )}
            {!previewUrl && existingDoc && existingDoc.kind === 'pdf' && (
              <iframe src={existingDoc.url} title={existingDoc.name} style={{ width: '100%', height: '100%', border: 0, borderRadius: 4 }} />
            )}
            {!previewUrl && existingDoc && existingDoc.kind === 'other' && (
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#6b7280' }}>
                <FileIcon className="w-12 h-12 mb-2 opacity-30" />
                <a href={existingDoc.url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 13, color: '#0284c7' }}>{existingDoc.name}</a>
              </div>
            )}
            {!previewUrl && !existingDoc && (
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#9ca3af' }}>
                <FileIcon className="w-12 h-12 mb-2 opacity-20" />
                <p style={{ fontSize: 13 }}>{isEditMode ? 'No document attached' : 'No preview available'}</p>
              </div>
            )}
          </div>

          <div style={{ padding: '3px 12px', borderTop: '1px solid #e5e7eb', background: '#f9fafb', display: 'flex', justifyContent: 'center', gap: 12, fontSize: 10, color: '#9ca3af', flexShrink: 0 }}>
            <button
              onClick={() => { setMagnifierEnabled(v => !v); setMagnifier(prev => ({ ...prev, show: false })); }}
              style={{ display: 'flex', alignItems: 'center', gap: 4, border: 'none', background: magnifierEnabled ? '#dbeafe' : 'transparent', color: magnifierEnabled ? '#2563eb' : '#9ca3af', borderRadius: 3, padding: '2px 8px', cursor: 'pointer', fontSize: 10, fontWeight: magnifierEnabled ? 600 : 400 }}
            >
              <Search className="w-3 h-3" /> {magnifierEnabled ? 'Magnifier ON' : 'Magnifier'}
            </button>
            <button
              onClick={() => setShowFullPreview(true)}
              style={{ display: 'flex', alignItems: 'center', gap: 4, border: 'none', background: 'transparent', color: '#9ca3af', borderRadius: 3, padding: '2px 8px', cursor: 'pointer', fontSize: 10 }}
            >
              <Maximize2 className="w-3 h-3" /> Full preview
            </button>
          </div>
        </div>

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
                        {renderTaxChoice(item, index)}
                        {item.tax_treatment !== 'depreciate' && renderExpenseCategory(item, index)}
                        {renderEquipment(item, index)}
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

              {/* Reconciliation (the $0 total message below replaces it when the total is missing) */}
              {!missingTotal && (
              <div style={{ padding: 6, borderRadius: 4, display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, border: `1px solid ${hasMismatch ? '#fde68a' : '#a7f3d0'}`, background: hasMismatch ? '#fffbeb' : '#ecfdf5', color: hasMismatch ? '#92400e' : '#065f46' }}>
                <AlertCircle style={{ width: 14, height: 14, flexShrink: 0, color: hasMismatch ? '#f59e0b' : '#10b981' }} />
                <span>
                  <strong>{hasMismatch ? 'Mismatch' : 'Reconciled'}:</strong>{' '}
                  Line costs ${calculatedTotalCost.toFixed(2)} vs Invoice ${formData.total_inv_amount.toFixed(2)}
                  {hasMismatch && <span style={{ color: '#d97706' }}> (diff: ${diff.toFixed(2)})</span>}
                </span>
              </div>
              )}
              {missingTotal && (
                <div role="status" style={{ padding: 6, borderRadius: 4, display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, border: '1px solid #fde68a', background: '#fffbeb', color: '#92400e' }}>
                  <AlertCircle style={{ width: 14, height: 14, flexShrink: 0, color: '#f59e0b' }} />
                  <span>Enter the invoice total, or set it to match the lines (${calculatedTotalCost.toFixed(2)}).</span>
                  <button
                    type="button"
                    onClick={useLinesTotal}
                    style={{ marginLeft: 'auto', fontWeight: 600, textDecoration: 'underline', cursor: 'pointer' }}
                  >
                    Use ${calculatedTotalCost.toFixed(2)}
                  </button>
                </div>
              )}
              {undecided > 0 && (
                <div role="status" style={{ padding: 6, borderRadius: 4, display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, border: '1px solid #fde68a', background: '#fffbeb', color: '#92400e' }}>
                  <AlertCircle style={{ width: 14, height: 14, flexShrink: 0, color: '#f59e0b' }} />
                  <span>Choose Expense or Depreciate for {undecided} {undecided === 1 ? 'item' : 'items'} between $200 and $2,500 before saving.</span>
                </div>
              )}
              {noPeriod > 0 && (
                <div role="status" style={{ padding: 6, borderRadius: 4, display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, border: '1px solid #fde68a', background: '#fffbeb', color: '#92400e' }}>
                  <AlertCircle style={{ width: 14, height: 14, flexShrink: 0, color: '#f59e0b' }} />
                  <span>Choose a recovery period for {noPeriod} depreciated {noPeriod === 1 ? 'item' : 'items'} before saving: click its Equipment details.</span>
                </div>
              )}
              {noUnits > 0 && (
                <div role="status" style={{ padding: 6, borderRadius: 4, display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, border: '1px solid #fde68a', background: '#fffbeb', color: '#92400e' }}>
                  <AlertCircle style={{ width: 14, height: 14, flexShrink: 0, color: '#f59e0b' }} />
                  <span>Enter a serial number or tag for each unit of {noUnits} {noUnits === 1 ? 'item' : 'items'} before saving: click its Equipment details.</span>
                </div>
              )}
              {noEquipCategory > 0 && (
                <div role="status" style={{ padding: 6, borderRadius: 4, display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, border: '1px solid #fde68a', background: '#fffbeb', color: '#92400e' }}>
                  <AlertCircle style={{ width: 14, height: 14, flexShrink: 0, color: '#f59e0b' }} />
                  <span>Choose an equipment category for {noEquipCategory} {noEquipCategory === 1 ? 'item' : 'items'} tracked as equipment before saving: click its amber Equipment switch.</span>
                </div>
              )}
            </div>
          </div>
          </div>

          {/* Footer */}
          <div style={{ padding: '6px 16px', borderTop: '1px solid #e5e7eb', background: '#f9fafb', display: 'flex', justifyContent: 'flex-end', gap: 12, flexShrink: 0 }}>
            <Button variant="outline" onClick={() => onOpenChange(false)} className="h-7 px-5 text-xs">
              {cancelLabel}
            </Button>
            <button
              onClick={isEditMode ? handleUpdate : handleSubmit}
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
      <div style={{ position: 'fixed', inset: 0, zIndex: 150, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
        <div role="dialog" aria-modal="true" aria-labelledby="linked-updates-title" style={{ background: 'white', borderRadius: 8, boxShadow: '0 10px 40px rgba(0,0,0,0.3)', width: 540, maxWidth: '100%', maxHeight: '85vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ padding: '12px 16px', borderBottom: '1px solid #e5e7eb' }}>
            <h3 id="linked-updates-title" style={{ fontSize: 14, fontWeight: 700, color: '#111827' }}>Confirm linked record updates</h3>
            <p style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>Your edits also affect these linked records. Review and confirm before saving.</p>
          </div>
          <div style={{ padding: '12px 16px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 14 }}>
            {pendingPlan.mismatches.length > 0 && (
              <div>
                <h4 style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#b45309', marginBottom: 6 }}>Quantity changed</h4>
                {pendingPlan.mismatches.map(m => {
                  const d = lineDecisions[m.lineId];
                  const have = m.records.reduce((n, r) => n + r.quantity, 0);
                  const extra = have - m.quantity;
                  const decide = (next: LineDecision) => setLineDecisions(prev => ({ ...prev, [m.lineId]: next }));
                  return (
                    <fieldset key={m.lineId} style={{ marginBottom: 8, border: '1px solid #fde68a', background: '#fffbeb', borderRadius: 6, padding: '6px 8px' }}>
                      <legend style={{ fontSize: 11, fontWeight: 600, color: '#374151', padding: '0 4px' }}>{m.description}</legend>
                      <p style={{ fontSize: 11, color: '#92400e', marginBottom: 6 }}>
                        {m.kind === 'lot'
                          ? `The line is now ${m.quantity}; its lot is ${have}.`
                          : `The line is now ${m.quantity}; it has ${have} units.`}
                      </p>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
                        <input type="radio" name={`mm-${m.lineId}`} checked={d?.mode === 'update'} onChange={() => decide({ mode: 'update', remove: [] })} />
                        {m.kind === 'lot' ? `Update the equipment: make the lot ${m.quantity}` : `Update the equipment: remove ${extra} ${extra === 1 ? 'unit' : 'units'}`}
                      </label>
                      {m.kind === 'units' && d?.mode === 'update' && (
                        <div role="group" aria-label={`Units to remove: ${m.description}`} style={{ margin: '4px 0 4px 22px', display: 'flex', flexWrap: 'wrap', gap: '2px 12px' }}>
                          {m.records.map(r => (
                            <label key={r.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontFamily: 'monospace' }}>
                              <input type="checkbox" checked={d.remove.includes(r.id)}
                                onChange={e => decide({ ...d, remove: e.target.checked ? [...d.remove, r.id] : d.remove.filter(x => x !== r.id) })} />
                              {r.label}
                            </label>
                          ))}
                          <span style={{ fontSize: 10, color: '#92400e', width: '100%' }}>Tick {extra}.</span>
                        </div>
                      )}
                      {m.kind === 'units' && d?.mode === 'update' && d.remove.length > 0 && (
                        <div role="radiogroup" aria-label={`Removed units: ${m.description}`} style={{ margin: '2px 0 4px 22px', display: 'flex', flexDirection: 'column', gap: 2 }}>
                          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
                            <input type="radio" name={`mm-how-${m.lineId}`} checked={d.how === 'delete'} onChange={() => decide({ ...d, how: 'delete' })} />
                            Delete them: their kits and scan history go with them
                          </label>
                          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
                            <input type="radio" name={`mm-how-${m.lineId}`} checked={d.how === 'inactive'} onChange={() => decide({ ...d, how: 'inactive' })} />
                            Mark Inactive: kept, with their kits and scans, and no longer on this purchase
                          </label>
                        </div>
                      )}
                      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
                        <input type="radio" name={`mm-${m.lineId}`} checked={d?.mode === 'leave'} onChange={() => decide({ mode: 'leave', remove: [] })} />
                        Leave the equipment as it is
                      </label>
                    </fieldset>
                  );
                })}
              </div>
            )}
            {pendingPlan.assetChanges.length > 0 && (
              <div>
                <h4 style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#0284c7', marginBottom: 6 }}>Asset updates</h4>
                {pendingPlan.assetChanges.map((a, ai) => (
                  <div key={ai} style={{ marginBottom: 8, border: '1px solid #e5e7eb', borderRadius: 6, padding: '6px 8px' }}>
                    <p style={{ fontSize: 11, fontWeight: 600, color: '#374151', marginBottom: 4 }}>{a.itemDescription}</p>
                    <table style={{ width: '100%', fontSize: 11, borderCollapse: 'collapse' }}>
                      <tbody>
                        {a.changes.map((c, ci) => (
                          <tr key={ci}>
                            <td style={{ color: '#6b7280', padding: '1px 6px 1px 0', whiteSpace: 'nowrap' }}>{c.label}</td>
                            <td style={{ color: '#9ca3af', padding: '1px 6px', textAlign: 'right' }}>{fmtVal(c.from)}</td>
                            <td style={{ color: '#9ca3af', padding: '1px 4px' }}>→</td>
                            <td style={{ color: '#065f46', fontWeight: 600, padding: '1px 0' }}>{fmtVal(c.to)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ))}
              </div>
            )}
            {pendingPlan.gigChanges.length > 0 && (
              <div>
                <h4 style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#7c3aed', marginBottom: 6 }}>Gig ledger updates</h4>
                <table style={{ width: '100%', fontSize: 11, borderCollapse: 'collapse' }}>
                  <tbody>
                    {pendingPlan.gigChanges.map((g, gi) => (
                      <tr key={gi}>
                        <td style={{ color: '#6b7280', padding: '1px 6px 1px 0' }}>{g.label}</td>
                        <td style={{ color: '#9ca3af', padding: '1px 6px', textAlign: 'right' }}>${g.from.toFixed(2)}</td>
                        <td style={{ color: '#9ca3af', padding: '1px 4px' }}>→</td>
                        <td style={{ color: '#065f46', fontWeight: 600, padding: '1px 0' }}>${g.to.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          <div style={{ padding: '10px 16px', borderTop: '1px solid #e5e7eb', background: '#f9fafb', display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
            <Button variant="outline" onClick={() => setPendingPlan(null)} disabled={isSubmitting} className="h-7 px-4 text-xs">
              Cancel
            </Button>
            <button
              onClick={() => commitUpdate(pendingPlan)}
              disabled={isSubmitting || !mismatchesDecided(pendingPlan)}
              style={{ height: 28, padding: '0 16px', fontSize: 12, fontWeight: 600, borderRadius: 4, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#0284c7', color: 'white', border: 'none', cursor: 'pointer', opacity: isSubmitting || !mismatchesDecided(pendingPlan) ? 0.5 : 1 }}
            >
              {isSubmitting && <Loader2 style={{ width: 14, height: 14, marginRight: 6 }} className="animate-spin" />}
              Confirm &amp; Save
            </button>
          </div>
        </div>
      </div>
    )}

    {magnifier.show && magnifier.src && (
      <div
        style={{
          position: 'fixed',
          pointerEvents: 'none',
          zIndex: 200,
          border: '2px solid white',
          boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
          borderRadius: '50%',
          overflow: 'hidden',
          background: 'white',
          width: MAG_R * 2,
          height: MAG_R * 2,
          left: magnifier.pageX - MAG_R,
          top: magnifier.pageY - MAG_R,
        }}
      >
        <div
          style={{
            width: '100%',
            height: '100%',
            backgroundImage: `url(${magnifier.src})`,
            backgroundRepeat: 'no-repeat',
            backgroundSize: `${magnifier.bgW}px ${magnifier.bgH}px`,
            backgroundPosition: `${magnifier.bgX}px ${magnifier.bgY}px`,
          }}
        />
      </div>
    )}

    {showFullPreview && previewUrl && (
      <div
        style={{ position: 'fixed', inset: 0, zIndex: 100, background: 'rgba(0,0,0,0.95)', display: 'flex', flexDirection: 'column', padding: 16 }}
        onClick={() => setShowFullPreview(false)}
      >
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
          <button
            style={{ background: 'none', border: 'none', color: 'white', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, padding: '4px 12px', borderRadius: 4 }}
            onClick={() => setShowFullPreview(false)}
            onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.15)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'none')}
          >
            <CloseIcon style={{ width: 18, height: 18 }} /> Close
          </button>
        </div>
        <div style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }} onClick={e => e.stopPropagation()}>
          {isImage && <img src={previewUrl} alt="Full Preview" style={{ maxWidth: '100%', objectFit: 'contain', borderRadius: 4 }} />}
          {isPdf && pdfPageImages.map((src, i) => (
            <img key={i} src={src} alt={`Page ${i + 1}`} style={{ maxWidth: '100%', objectFit: 'contain', borderRadius: 4, boxShadow: '0 4px 12px rgba(0,0,0,0.3)' }} />
          ))}
        </div>
      </div>
    )}
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
