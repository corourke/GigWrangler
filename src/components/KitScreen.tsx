import {useState, useEffect, useMemo, useRef } from 'react';
import { Package, Save, Loader2, AlertCircle, Plus, X, Search, CheckCircle2, Boxes, Container, Layers } from 'lucide-react';
import { useSimpleFormChanges } from '../utils/hooks/useSimpleFormChanges';
import { createSubmissionPayload, normalizeFormData } from '../utils/form-utils';
import { toast } from 'sonner';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Card } from './ui/card';
import { Textarea } from './ui/textarea';
import { Badge } from './ui/badge';
import { Checkbox } from './ui/checkbox';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from './ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';
import AppHeader from './AppHeader';
import { PageHeader } from './layout/PageHeader';
import { Organization, User, UserRole } from '../utils/supabase/types';
import { getKit, createKit, updateKit, getKits, getKitsFlattenedSummary, getKitsThatWouldCycle, KitFlattenedSummary } from '../services/kit.service';
import { getAssets } from '../services/asset.service';
import { getItems, getContainerPieces } from '../services/equipmentItem.service';
import { type ContainerPieces, isAvailable, isRetired, itemMatchesSearch, pieceValue, recordKind, summarizeItem, type ItemRecord } from '../utils/equipmentItems';
import type { DbAsset } from '../utils/supabase/types';
import { useAutocompleteSuggestions } from '../utils/hooks/useAutocompleteSuggestions';

interface KitScreenProps {
  organization: Organization;
  user: User;
  userRole?: UserRole;
  kitId?: string | null;
  onCancel: () => void;
  onKitCreated: (kitId: string) => void;
  onKitUpdated: () => void;
  onSwitchOrganization: () => void;
  onLogout: () => void;
}

interface FormData {
  name: string;
  category: string;
  description: string;
  tags: string[];
  tag_number: string;
  rental_value: string;
}

/** An equipment item with its records, for "any" lines and availability (#184). */
interface KitItem {
  id: string;
  manufacturer_model: string;
  category: string | null;
  type?: string | null;
  records: (ItemRecord & Partial<DbAsset>)[];
}

/** How a status reads when it makes a unit unavailable. */
const STATUS_LABEL: Record<string, string> = { Maintenance: 'In maintenance', Inactive: 'Inactive' };

/**
 * A row in the kit's contents — exactly one of asset/item/childKit is set
 * (an item line is "N × any" of it, #184).
 * clientKey is the row's stable local identity: the DB id when loaded from an
 * existing kit, or a generated id for a row just added in this session. It's
 * never derived from asset_id/child_kit_id, which aren't unique — two rows
 * can't reference the same asset (the DB enforces that), but during editing,
 * deriving identity from a foreign key meant removing one row removed every
 * row sharing that key.
 */
interface KitComponentRow {
  clientKey: string;
  id?: string;
  asset_id?: string;
  equipment_item_id?: string;
  child_kit_id?: string;
  asset?: DbAsset;
  item?: { id: string; manufacturer_model: string; category?: string | null };
  childKit?: { id: string; name: string; is_container?: boolean; category?: string | null };
  quantity: number;
}

/** A searchable candidate in the unified picker: any of an item, a specific unit, or a kit (#184). */
type PickerCandidate =
  | { type: 'item'; id: string; name: string; subtitle: string; item: KitItem; owned: number; available: number; excludedReason: string | null }
  | { type: 'asset'; id: string; name: string; subtitle: string; asset: DbAsset; quantityAvailable: number | null; excludedReason: string | null }
  | { type: 'kit'; id: string; name: string; subtitle: string; componentCount: number; wouldCycle: boolean; excludedReason: string | null };

export default function KitScreen({
  organization,
  user,
  userRole,
  kitId,
  onCancel,
  onKitCreated,
  onKitUpdated,
  onSwitchOrganization,
  onLogout,
}: KitScreenProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [formData, setFormData] = useState<FormData>({
    name: '',
    category: '',
    description: '',
    tags: [],
    tag_number: '',
    rental_value: '',
  });

  const [isContainer, setIsContainer] = useState(false);
  const [kitComponents, setKitComponents] = useState<KitComponentRow[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  // Sub-kits' flattened contents (true equipment value, item count, and the
  // set of asset ids they reach), keyed by child_kit_id — not their own
  // rental_value, which isn't relevant here.
  const [childKitSummaries, setChildKitSummaries] = useState<Map<string, KitFlattenedSummary>>(new Map());

  // Unified component picker dialog
  const [showPicker, setShowPicker] = useState(false);
  const [pickerFilter, setPickerFilter] = useState<'all' | 'items' | 'units' | 'kits'>('all');
  const [pickerCandidates, setPickerCandidates] = useState<PickerCandidate[]>([]);
  const [pickerSearchQuery, setPickerSearchQuery] = useState('');
  const [showAlreadyInKit, setShowAlreadyInKit] = useState(false);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [addQuantities, setAddQuantities] = useState<Map<string, number>>(new Map());
  const [tagInput, setTagInput] = useState('');
  // The organization's items and how many of each sit in container kits (#184).
  const [items, setItems] = useState<Map<string, KitItem>>(new Map());
  const [containerPieces, setContainerPieces] = useState<ContainerPieces>({ all: new Map(), active: new Map() });

  const isEditMode = !!kitId;

  // Autocomplete suggestions for kit category
  const kitCategorySuggestions = useAutocompleteSuggestions({
    field: 'category',
    organizationId: organization.id,
    sourceTable: 'kits',
    enabled: true,
  });

  // Create currentData that includes form values + nested data for change detection
  const currentData = useMemo(() => ({
    ...formData,
    kitComponents: kitComponents,
    isContainer: isContainer,
  }), [formData, kitComponents, isContainer]);

  // Change detection for efficient updates
  const changeDetection = useSimpleFormChanges({
    initialData: {
      name: '',
      category: '',
      description: '',
      tags: [],
      tag_number: '',
      rental_value: '',
      kitComponents: [],
      isContainer: false,
    },
    currentData: currentData, // Pass the memoized currentData
  });

  // Data changes are automatically detected by the simplified hook

  useEffect(() => {
    if (kitId) {
      loadKit();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- loads when the kit changes, not on every change-tracker or callback render
  }, [kitId]);

  // Items and container pieces, for "any" lines and availability (#184).
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const list = ((await getItems(organization.id)) ?? []) as KitItem[];
        if (!live) return;
        setItems(new Map(list.map((i) => [i.id, { ...i, records: i.records ?? [] }])));
        const pieces = await getContainerPieces(organization.id, list, kitId);
        if (live) setContainerPieces(pieces ?? { all: new Map(), active: new Map() });
      } catch (error) {
        console.error('Error loading equipment items:', error);
      }
    })();
    return () => { live = false; };
  }, [organization.id, kitId]);

  // Fetch (and cache) each referenced sub-kit's flattened replacement value
  // whenever a new one shows up in the draft — covers both kits loaded with
  // the kit and ones just added via the picker.
  useEffect(() => {
    const childKitIds = Array.from(new Set(kitComponents.filter(c => c.child_kit_id).map(c => c.child_kit_id!)));
    const missing = childKitIds.filter((id) => !childKitSummaries.has(id));
    if (missing.length === 0) return;

    getKitsFlattenedSummary(missing).then((summaries) => {
      setChildKitSummaries((prev) => {
        const next = new Map(prev);
        for (const id of missing) {
          next.set(id, summaries.get(id) ?? { totalValue: 0, totalItems: 0, assetIds: new Set(), assetLabels: new Map(), itemQuantities: new Map() });
        }
        return next;
      });
    });
  }, [kitComponents, childKitSummaries]);

  // Ids of the components loaded: a save deletes only those the user removed (#92).
  const loadedComponentIdsRef = useRef<string[]>([]);

  const loadKit = async () => {
    if (!kitId) return;

    setIsLoading(true);
    try {
      const kit = await getKit(kitId);
      const loadedData = {
        name: kit.name || '',
        category: kit.category || '',
        description: kit.description || '',
        tags: kit.tags || [],
        tag_number: kit.tag_number || '',
        rental_value: kit.rental_value?.toString() || '',
      };

      setFormData(loadedData);
      setIsContainer(kit.is_container ?? false);

      const mappedComponents: KitComponentRow[] = (kit.kit_components || []).map((kc: any) => ({
        clientKey: kc.id,
        id: kc.id,
        asset_id: kc.asset_id ?? undefined,
        equipment_item_id: kc.equipment_item_id ?? undefined,
        child_kit_id: kc.child_kit_id ?? undefined,
        asset: kc.asset ?? undefined,
        item: kc.item ?? undefined,
        childKit: kc.child_kit ?? undefined,
        quantity: kc.quantity,
      }));
      loadedComponentIdsRef.current = (kit.kit_components || []).map((kc: any) => kc.id);
      setKitComponents(mappedComponents);

      // Load initial data for change detection (including kit components and tracking type)
      changeDetection.loadInitialData({
        ...loadedData,
        kitComponents: mappedComponents,
        isContainer: kit.is_container ?? false,
      });
    } catch (error: any) {
      console.error('Error loading kit:', error);
      toast.error(error.message || 'Failed to load kit');
      onCancel();
    } finally {
      setIsLoading(false);
    }
  };

  const loadPickerCandidates = async () => {
    try {
      const [assets, kits] = await Promise.all([
        pickerFilter === 'all' || pickerFilter === 'units' ? getAssets(organization.id, { search: pickerSearchQuery || undefined }) : Promise.resolve([]),
        pickerFilter === 'all' || pickerFilter === 'kits' ? getKits(organization.id, { search: pickerSearchQuery || undefined }) : Promise.resolve([]),
      ]);

      // Exclude assets already added as a direct component, and kits already
      // added (or the kit being edited itself) — adding the same asset/kit
      // again would either collide with the DB's unique constraint or, for a
      // still-unsaved row, produce two rows with no way to tell them apart.
      const alreadyDirectAssetIds = new Set(kitComponents.filter(c => c.asset_id).map(c => c.asset_id as string));
      const alreadyDirectKitIds = new Set(kitComponents.filter(c => c.child_kit_id).map(c => c.child_kit_id as string));

      const kitCandidateSource = (kits || []).filter((k: any) => k.id !== kitId && !alreadyDirectKitIds.has(k.id));
      const candidateKitIds = kitCandidateSource.map((k: any) => k.id as string);

      // Flattened contents for both the sub-kits already in this draft (to know
      // which assets they already cover) and every kit candidate on screen (to
      // know which assets picking it would introduce) — one batched query.
      const summaries = await getKitsFlattenedSummary([...alreadyDirectKitIds, ...candidateKitIds]);

      // Every asset already represented in this kit, directly or through an
      // already-added sub-kit's flattened contents — the same physical asset
      // can't enter a kit twice, however it gets there. Also remember which
      // already-added sub-kit contributed each such asset, so the picker can
      // name it in the exclusion reason instead of just saying "already in
      // this kit" (an asset added directly has no such kit).
      const childKitNames = new Map<string, string>();
      for (const row of kitComponents) {
        if (row.child_kit_id && row.childKit?.name) childKitNames.set(row.child_kit_id, row.childKit.name);
      }
      const existingFlattenedAssetIds = new Set<string>(alreadyDirectAssetIds);
      const assetIdToViaKitName = new Map<string, string>();
      for (const childKitId of alreadyDirectKitIds) {
        const kitAssetIds = summaries.get(childKitId)?.assetIds;
        if (!kitAssetIds) continue;
        const kitName = childKitNames.get(childKitId);
        for (const assetId of kitAssetIds) {
          existingFlattenedAssetIds.add(assetId);
          if (kitName && !assetIdToViaKitName.has(assetId)) assetIdToViaKitName.set(assetId, kitName);
        }
      }

      // Candidates already covered elsewhere in the kit's tree stay in the
      // list (not filtered out) so the picker can show them grayed out with
      // a reason, same treatment as the circular-reference case below —
      // gated behind the "show already in this kit" toggle at render time.
      // Any of an item: one per item, with how many are owned and available (#184).
      const alreadyItemIds = new Set(kitComponents.filter(c => c.equipment_item_id).map(c => c.equipment_item_id as string));
      const itemCandidates: PickerCandidate[] = pickerFilter === 'all' || pickerFilter === 'items'
        ? Array.from(items.values())
          .filter((i) => itemMatchesSearch(i, i.records, pickerSearchQuery))
          .map((i) => {
            const summary = summarizeItem(i.records, containerPieces.all.get(i.id) ?? 0, containerPieces.active.get(i.id) ?? 0);
            return {
              type: 'item' as const, id: i.id, name: i.manufacturer_model, subtitle: [i.category, i.type].filter(Boolean).join(' • '),
              item: i, owned: summary.owned, available: summary.available,
              excludedReason: alreadyItemIds.has(i.id) ? 'Already in this kit' : null,
            };
          })
        : [];

      // Retired units (Disposed, Returned or a retirement date) can't be picked (#184).
      const assetCandidates: PickerCandidate[] = (assets || []).filter((a: DbAsset) => !isRetired(a as ItemRecord)).map((a: DbAsset) => {
        let excludedReason: string | null = null;
        if (alreadyDirectAssetIds.has(a.id)) {
          excludedReason = 'Already in this kit';
        } else if (existingFlattenedAssetIds.has(a.id)) {
          const viaKitName = assetIdToViaKitName.get(a.id);
          excludedReason = viaKitName ? `Already in this kit via ${viaKitName}` : 'Already in this kit';
        }
        return {
          type: 'asset',
          id: a.id,
          name: a.manufacturer_model || 'Unknown Asset',
          subtitle: [a.category, a.serial_number ? `SN: ${a.serial_number}` : null].filter(Boolean).join(' • '),
          asset: a,
          quantityAvailable: a.quantity ?? null,
          excludedReason,
        };
      });

      // Check for circular references across every candidate BEFORE
      // filtering out duplicate assets — a cycle candidate is, by
      // construction, always also a duplicate-asset candidate (nesting X
      // into Y when X already contains Y means X's flattened set already
      // has everything Y has), so checking duplicates first would silently
      // exclude every cycle case behind the generic "already in this kit"
      // rule. The cycle is the more specific, more useful diagnosis, so it
      // takes priority: flagged inline on its row instead of hidden. A
      // brand-new, unsaved kit has no id yet and can't be anyone's
      // ancestor, so this only applies in edit mode.
      const cyclicKitIds = kitId
        ? await getKitsThatWouldCycle(kitId, kitCandidateSource.map((k: any) => k.id))
        : new Set<string>();

      // A non-cyclic kit candidate is flagged (not filtered out) if any
      // asset it flattens to is already covered above — same rule as
      // assets, the other direction: adding this kit would put an asset
      // already in the parent into it a second time. The cycle check still
      // takes priority: a cyclic candidate's excludedReason stays null,
      // since wouldCycle already carries its own, more specific reason.
      const kitCandidates: PickerCandidate[] = kitCandidateSource.map((k: any) => {
        const wouldCycle = cyclicKitIds.has(k.id);
        let excludedReason: string | null = null;
        if (!wouldCycle) {
          const assetIds = summaries.get(k.id)?.assetIds;
          if (assetIds) {
            for (const assetId of assetIds) {
              if (existingFlattenedAssetIds.has(assetId)) {
                excludedReason = 'Contains assets already in this kit';
                break;
              }
            }
          }
        }
        return {
          type: 'kit' as const,
          id: k.id,
          name: k.name,
          subtitle: k.category || '',
          componentCount: k.kit_components?.length ?? 0,
          wouldCycle,
          excludedReason,
        };
      });

      setPickerCandidates([...itemCandidates, ...assetCandidates, ...kitCandidates]);
    } catch (error: any) {
      console.error('Error loading picker candidates:', error);
    }
  };

  useEffect(() => {
    if (showPicker) {
      loadPickerCandidates();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- reloads on search, filter and stock changes; editing kit lines does not refetch the picker
  }, [pickerSearchQuery, pickerFilter, showPicker, items, containerPieces]);

  // Candidates already covered elsewhere in the kit's tree stay out of the
  // list by default — the toggle above the list reveals them, grayed out
  // with their reason, same as an always-visible circular-reference candidate.
  const visibleCandidates = useMemo(
    () => pickerCandidates.filter((c) => showAlreadyInKit || !c.excludedReason),
    [pickerCandidates, showAlreadyInKit]
  );

  const handleChange = (field: keyof FormData, value: string | string[]) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    if (errors[field]) {
      setErrors((prev) => {
        const newErrors = { ...prev };
        delete newErrors[field];
        return newErrors;
      });
    }
  };

  const handleAddTag = () => {
    const tag = tagInput.trim();
    if (tag && !formData.tags.includes(tag)) {
      handleChange('tags', [...formData.tags, tag]);
      setTagInput('');
    }
  };

  const handleRemoveTag = (tag: string) => {
    handleChange('tags', formData.tags.filter((t) => t !== tag));
  };

  const candidateKey = (c: PickerCandidate) => `${c.type}:${c.id}`;

  const toggleSelected = (c: PickerCandidate) => {
    if (c.type === 'kit' && c.wouldCycle) return;
    if (c.excludedReason) return;
    const key = candidateKey(c);
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const setAddQuantity = (key: string, quantity: number) => {
    setAddQuantities((prev) => new Map(prev).set(key, Math.max(1, quantity)));
  };

  const handleAddSelected = () => {
    const toAdd: KitComponentRow[] = [];
    for (const c of pickerCandidates) {
      const key = candidateKey(c);
      if (!selectedKeys.has(key)) continue;
      if (c.type === 'item') {
        toAdd.push({
          clientKey: crypto.randomUUID(), equipment_item_id: c.id, quantity: addQuantities.get(key) ?? 1,
          item: { id: c.item.id, manufacturer_model: c.item.manufacturer_model, category: c.item.category },
        });
      } else if (c.type === 'asset') {
        const requested = addQuantities.get(key) ?? 1;
        const quantity = Math.min(requested, c.quantityAvailable ?? Infinity);
        toAdd.push({ clientKey: crypto.randomUUID(), asset_id: c.id, asset: c.asset, quantity });
      } else {
        // A kit is a singular entity — always exactly one instance, never a
        // quantity of its own (the picker doesn't even offer a stepper for it).
        toAdd.push({
          clientKey: crypto.randomUUID(),
          child_kit_id: c.id,
          childKit: { id: c.id, name: c.name, category: c.subtitle || null },
          quantity: 1,
        });
      }
    }
    if (toAdd.length === 0) return;

    setKitComponents((prev) => [...prev, ...toAdd]);
    setShowPicker(false);
    setPickerSearchQuery('');
    setSelectedKeys(new Set());
    setAddQuantities(new Map());
  };

  const handleUpdateQuantity = (clientKey: string, quantity: number) => {
    setKitComponents((prev) =>
      prev.map((row) => {
        if (row.clientKey !== clientKey) return row;
        // A kit component can't exceed how many of that asset are in
        // inventory; a sub-kit component is always exactly 1 (its input
        // isn't editable, but clamp defensively all the same).
        const max = row.child_kit_id ? 1 : row.equipment_item_id ? Infinity : (row.asset?.quantity ?? Infinity);
        return { ...row, quantity: Math.min(Math.max(1, quantity), max) };
      })
    );
  };

  const handleRemoveComponent = (clientKey: string) => {
    setKitComponents((prev) => prev.filter((row) => row.clientKey !== clientKey));
  };

  const validate = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (!formData.name.trim()) {
      newErrors.name = 'Kit name is required';
    }

    if (kitComponents.length === 0) {
      newErrors.components = 'At least one asset or sub-kit must be added to the kit';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async () => {
    if (!validate()) {
      toast.error('Please fix the errors before submitting');
      return;
    }

    setIsSaving(true);
    try {
      // Normalize form data for basic kit fields
      const normalizedFormData = {
        name: formData.name,
        category: formData.category,
        description: formData.description,
        tags: formData.tags,
        tag_number: formData.tag_number,
        rental_value: formData.rental_value ? parseFloat(formData.rental_value) : null,
      };

      // Normalize and get only changed fields for basic kit data
      const normalizedData = normalizeFormData(normalizedFormData);

      // Transform originalData to match normalized structure (rental_value is number | null in normalized, string in original)
      const originalDataForComparison = isEditMode && changeDetection.originalData ? {
        name: changeDetection.originalData.name || '',
        category: changeDetection.originalData.category || '',
        description: changeDetection.originalData.description || '',
        tags: changeDetection.originalData.tags || [],
        tag_number: changeDetection.originalData.tag_number || '',
        rental_value: changeDetection.originalData.rental_value ? parseFloat(changeDetection.originalData.rental_value) : null,
      } : {};

      const basicKitData = isEditMode
        ? createSubmissionPayload(normalizedData, originalDataForComparison)
        : normalizedData;

      // Prepare kit data - combine basic fields with nested components
      const kitData: any = {
        organization_id: organization.id,
        ...basicKitData,
        is_container: isContainer,
      };

      // Always send components (complex nested data)
      kitData.components = kitComponents.map((row) => ({
        id: row.id,
        asset_id: row.asset_id,
        equipment_item_id: row.equipment_item_id,
        child_kit_id: row.child_kit_id,
        quantity: row.quantity,
      }));

      if (isEditMode && kitId) {
        await updateKit(kitId, kitData, loadedComponentIdsRef.current);
        toast.success('Kit updated successfully');

        // Mark as saved for change detection
        changeDetection.markAsSaved({
          name: formData.name.trim(),
          category: formData.category.trim(),
          description: formData.description.trim(),
          tags: formData.tags,
          tag_number: formData.tag_number.trim(),
          rental_value: formData.rental_value,
          kitComponents: kitComponents,
          isContainer: isContainer,
        });

        onKitUpdated();
      } else {
        const newKit = await createKit(kitData);
        toast.success('Kit created successfully');
        onKitCreated(newKit.id);
      }
    } catch (error: any) {
      console.error('Error saving kit:', error);
      if (error.code === '23505') {
        // Postgres unique_violation on kit_components — the raw message
        // ("duplicate key value violates unique constraint ...") isn't
        // user-facing on its own, so lead with plain context.
        toast.error(`An inventory asset or kit can not be added more than once. ${error.message || ''}`.trim());
      } else {
        // The circular-reference trigger's message is already user-facing —
        // no special-casing needed for that one.
        toast.error(error.message || 'Failed to save kit');
      }
    } finally {
      setIsSaving(false);
    }
  };

  // A sub-kit's "value" here is its flattened replacement value (what its
  // contents are worth), not its own rental_value — the parent kit's rental
  // value is what the user sets, informed by this total.
  const componentUnitValue = (row: KitComponentRow) =>
    row.equipment_item_id ? pieceValue(items.get(row.equipment_item_id)?.records ?? [])
      : row.asset?.replacement_value ?? (row.child_kit_id ? childKitSummaries.get(row.child_kit_id)?.totalValue : undefined) ?? 0;

  /** Pieces a line puts in the kit: a sub-kit counts what's in it. */
  const componentPieces = (row: KitComponentRow) =>
    row.child_kit_id ? (childKitSummaries.get(row.child_kit_id)?.totalItems ?? 0) : row.quantity;

  /** Availability (#184): Active, not retired, not in a container kit (Cameron, 10-09). */
  const availability = (row: KitComponentRow): { text: string; note?: string; tone: 'muted' | 'amber' | 'red' } | null => {
    if (row.equipment_item_id) {
      const item = items.get(row.equipment_item_id);
      if (!item) return null;
      const s = summarizeItem(item.records, containerPieces.all.get(item.id) ?? 0, containerPieces.active.get(item.id) ?? 0);
      // Units are one piece each; once a lot is in the count, it's pieces (#266).
      const noun = s.lots ? (s.owned === 1 ? 'piece' : 'pieces') : (s.owned === 1 ? 'unit' : 'units');
      const text = `${s.owned} ${noun} owned · ${s.available} available`;
      if (row.quantity <= s.available) return { text, tone: 'muted' };
      const inactive = item.records.filter((r) => !isRetired(r) && r.status === 'Inactive')
        .reduce((n, r) => n + (r.quantity == null ? 1 : Number(r.quantity)), 0);
      const why = [
        s.inMaintenance ? `${s.inMaintenance} in maintenance` : '',
        inactive ? `${inactive} inactive` : '',
        s.inContainers ? `${s.inContainers} in container kits` : '',
      ].filter(Boolean).join(' · ');
      return { text, note: why || undefined, tone: 'amber' };
    }
    if (row.asset) {
      const a = row.asset as ItemRecord;
      const lotPieces = a.quantity == null ? 1 : Number(a.quantity);
      const what = recordKind(a) === 'unit' ? 'Specific unit' : `Specific lot · ${lotPieces} ${lotPieces === 1 ? 'piece' : 'pieces'}`;
      if (isRetired(a)) {
        const status = a.retired_on && isAvailable({ status: a.status }) ? 'Retired' : a.status;
        return { text: `${status}: no longer owned. Remove it from the kit.`, tone: 'red' };
      }
      if (!isAvailable(a)) return { text: what, note: `${STATUS_LABEL[a.status ?? ''] ?? a.status}: not available now`, tone: 'amber' };
      // A lot shrunk by a partial write-off can hold fewer than the line asks for (#242).
      const has = Number(a.quantity ?? 1);
      if (recordKind(a) === 'lot' && row.quantity > has) return { text: what, note: `asks for ${row.quantity}, lot has ${has}`, tone: 'amber' };
      return { text: what, tone: 'muted' };
    }
    return null;
  };

  const getTotalValue = () => {
    return kitComponents.reduce((total, row) => total + componentUnitValue(row) * row.quantity, 0);
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(amount);
  };

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
        currentRoute="create-kit"
        onSwitchOrganization={onSwitchOrganization}
        onLogout={onLogout}
      />

      <PageHeader
        back={{ label: 'Back to Kits', onClick: onCancel }}
        title={isEditMode ? 'Edit Kit' : 'Create New Kit'}
      />

      {/* Narrower than the header, but left-aligned with the title (#39). */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 *:max-w-6xl">

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Main Form */}
          <div className="lg:col-span-2 space-y-6">
            {/* Basic Information */}
            <Card className="p-6">
              <h3 className="text-gray-900 mb-4">Basic Information</h3>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="name">
                    Kit Name <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    id="name"
                    value={formData.name}
                    onChange={(e) => handleChange('name', e.target.value)}
                    placeholder="e.g., Small Lighting Setup, Wedding DJ Kit"
                    className={errors.name ? 'border-red-500' : ''}
                  />
                  {errors.name && (
                    <p className="text-sm text-red-600 flex items-center gap-1">
                      <AlertCircle className="w-4 h-4" />
                      {errors.name}
                    </p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="category">Category</Label>
                  <Input
                    id="category"
                    list="kit_categories"
                    value={formData.category}
                    onChange={(e) => handleChange('category', e.target.value)}
                    placeholder="e.g., Audio, Lighting, Production"
                  />
                  <datalist id="kit_categories">
                    {kitCategorySuggestions.suggestions.map((cat, index) => (
                      <option key={`kit-category-${index}-${cat}`} value={cat} />
                    ))}
                  </datalist>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="description">Description</Label>
                  <Textarea
                    id="description"
                    value={formData.description}
                    onChange={(e) => handleChange('description', e.target.value)}
                    placeholder="Describe this kit and when to use it..."
                    rows={3}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="tags">Tags</Label>
                  <div className="flex gap-2">
                    <Input
                      id="tags"
                      value={tagInput}
                      onChange={(e) => setTagInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          handleAddTag();
                        }
                      }}
                      placeholder="Add tags (press Enter)"
                    />
                    <Button type="button" onClick={handleAddTag} variant="outline" aria-label="Add tag">
                      <Plus className="w-4 h-4" aria-hidden />
                    </Button>
                  </div>
                  {formData.tags.length > 0 && (
                    <div className="flex flex-wrap gap-2 mt-2">
                      {formData.tags.map((tag) => (
                        <Badge key={tag} variant="outline" className="pl-2 pr-1">
                          {tag}
                          <button
                            type="button"
                            onClick={() => handleRemoveTag(tag)}
                            className="ml-1 hover:text-red-600"
                            aria-label={`Remove tag ${tag}`}
                          >
                            <X className="w-3 h-3" aria-hidden />
                          </button>
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="tag_number">Tag Number</Label>
                  <Input
                    id="tag_number"
                    value={formData.tag_number}
                    onChange={(e) => handleChange('tag_number', e.target.value)}
                    placeholder="e.g., KIT-001, LGT-A"
                  />
                  <p className="text-xs text-gray-500">
                    Physical tag or identifier for this kit
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="rental_value">Rental Value</Label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-500">
                      $
                    </span>
                    <Input
                      id="rental_value"
                      type="number"
                      step="0.01"
                      min="0"
                      value={formData.rental_value}
                      onChange={(e) => handleChange('rental_value', e.target.value)}
                      placeholder="0.00"
                      className="pl-7"
                    />
                  </div>
                  <p className="text-xs text-gray-500">
                    Daily or event rental rate for this kit
                  </p>
                </div>
              </div>
            </Card>

            {/* Components */}
            <Card className="p-6">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-gray-900">Kit Contents</h3>
                  {errors.components && (
                    <p className="text-sm text-red-600 flex items-center gap-1 mt-1">
                      <AlertCircle className="w-4 h-4" />
                      {errors.components}
                    </p>
                  )}
                </div>
                <Button
                  type="button"
                  onClick={() => setShowPicker(true)}
                  variant="outline"
                >
                  <Plus className="w-4 h-4 mr-2" />
                  Add Components
                </Button>
              </div>

              {kitComponents.length === 0 ? (
                <div className="text-center py-8 border-2 border-dashed border-gray-200 rounded-lg">
                  <Package className="w-12 h-12 text-gray-300 mx-auto mb-2" />
                  <p className="text-gray-600 mb-4">No assets or kits added yet</p>
                  <Button
                    type="button"
                    onClick={() => setShowPicker(true)}
                    variant="outline"
                  >
                    <Plus className="w-4 h-4 mr-2" />
                    Add Your First Component
                  </Button>
                </div>
              ) : (
                // Cells are nowrap by default: Component and Availability wrap so Total Value and
                // the remove X fit the card (#279); a narrow screen still scrolls it sideways.
                <div className="border rounded-lg overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Component</TableHead>
                        <TableHead>Kind</TableHead>
                        <TableHead className="text-right">Quantity</TableHead>
                        <TableHead>Availability</TableHead>
                        <TableHead className="text-right">Unit Value</TableHead>
                        <TableHead className="text-right">Total Value</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {kitComponents.map((row) => {
                        const rowId = row.clientKey;
                        const isKit = !!row.child_kit_id;
                        const isAny = !!row.equipment_item_id;
                        const unitValue = componentUnitValue(row);
                        const avail = availability(row);
                        const kind = isKit ? 'Kit' : isAny ? 'Any' : row.asset && recordKind(row.asset as ItemRecord) === 'lot' ? 'Lot' : 'Unit';
                        const lineName = isKit ? (row.childKit?.name || 'Unknown Kit')
                          : isAny ? (row.item?.manufacturer_model || items.get(row.equipment_item_id!)?.manufacturer_model || 'Unknown item')
                          : (row.asset?.manufacturer_model || 'Unknown Asset');
                        return (
                          <TableRow key={rowId}>
                            <TableCell className="whitespace-normal break-words min-w-[8rem]">
                              <div>
                                <div className="text-sm text-gray-900">{lineName}</div>
                                {isAny && <div className="text-xs text-gray-500">any unit</div>}
                                {!isKit && !isAny && row.asset?.tag_number && (
                                  <div className="text-xs text-gray-500 font-mono">{row.asset.tag_number}</div>
                                )}
                                {!isKit && row.asset?.serial_number && (
                                  <div className="text-xs text-gray-500">
                                    SN: {row.asset.serial_number}
                                  </div>
                                )}
                                {isKit && row.childKit?.category && (
                                  <div className="text-xs text-gray-500">{row.childKit.category}</div>
                                )}
                              </div>
                            </TableCell>
                            <TableCell>
                              <Badge variant="outline" className={`gap-1 ${isAny ? 'border-sky-300 bg-sky-50 text-sky-800' : ''}`}>
                                {isKit ? <Layers className="w-3 h-3" /> : <Package className="w-3 h-3" />}
                                {kind}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-right">
                              {isKit ? (
                                // A kit is a singular entity — it's either in the
                                // parent kit or it isn't, never "N of" itself.
                                <span className="text-sm text-gray-500 pr-3">1</span>
                              ) : (
                                <Input
                                  type="number"
                                  min="1"
                                  max={isAny ? undefined : row.asset?.quantity ?? undefined}
                                  value={row.quantity}
                                  onChange={(e) =>
                                    handleUpdateQuantity(rowId, parseInt(e.target.value) || 1)
                                  }
                                  className="w-20 ml-auto"
                                />
                              )}
                            </TableCell>
                            <TableCell className="whitespace-normal">
                              {avail && (
                                <div className={`text-xs ${avail.tone === 'red' ? 'text-red-700' : avail.tone === 'amber' ? 'text-amber-700' : 'text-gray-500'}`}>
                                  <div className={avail.tone === 'amber' && isAny ? 'font-medium' : ''}>{avail.text}</div>
                                  {avail.note && <div>{avail.note}</div>}
                                </div>
                              )}
                            </TableCell>
                            <TableCell className="text-right">
                              {unitValue ? formatCurrency(unitValue) : '-'}
                            </TableCell>
                            <TableCell className="text-right">
                              {formatCurrency(unitValue * row.quantity)}
                            </TableCell>
                            <TableCell className="text-right">
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => handleRemoveComponent(rowId)}
                                className="text-red-600 hover:text-red-700"
                                aria-label={`Remove ${lineName} from kit`}
                              >
                                <X className="w-4 h-4" aria-hidden />
                              </Button>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </Card>
          </div>

          {/* Summary Sidebar */}
          <div className="space-y-6">
            <Card className="p-6">
              <h3 className="text-gray-900 mb-3">Tracking Type</h3>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setIsContainer(false)}
                  className={`relative flex flex-col items-start gap-1.5 rounded-lg border-2 p-3 text-left transition-colors ${
                    !isContainer
                      ? 'border-sky-500 bg-sky-50'
                      : 'border-gray-200 bg-white hover:border-gray-300'
                  }`}
                >
                  {!isContainer && (
                    <CheckCircle2 className="absolute top-2 right-2 h-4 w-4 text-sky-500" />
                  )}
                  <Boxes className={`h-5 w-5 ${!isContainer ? 'text-sky-600' : 'text-gray-400'}`} />
                  <span className={`text-sm font-medium ${!isContainer ? 'text-sky-700' : 'text-gray-700'}`}>
                    Items
                  </span>
                  <span className="text-xs text-gray-500 leading-snug">
                    Each line is confirmed when packed
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => setIsContainer(true)}
                  className={`relative flex flex-col items-start gap-1.5 rounded-lg border-2 p-3 text-left transition-colors ${
                    isContainer
                      ? 'border-sky-500 bg-sky-50'
                      : 'border-gray-200 bg-white hover:border-gray-300'
                  }`}
                >
                  {isContainer && (
                    <CheckCircle2 className="absolute top-2 right-2 h-4 w-4 text-sky-500" />
                  )}
                  <Container className={`h-5 w-5 ${isContainer ? 'text-sky-600' : 'text-gray-400'}`} />
                  <span className={`text-sm font-medium ${isContainer ? 'text-sky-700' : 'text-gray-700'}`}>
                    Container
                  </span>
                  <span className="text-xs text-gray-500 leading-snug">
                    Checked off as one, by its tag
                  </span>
                </button>
              </div>
            </Card>

            <Card className="p-6">
              <h3 className="text-gray-900 mb-4">Kit Summary</h3>
              <div className="space-y-4">
                <div>
                  <p className="text-sm text-gray-600">Components</p>
                  <p className="text-2xl text-gray-900">{kitComponents.length}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-600">Pieces</p>
                  <p className="text-2xl text-gray-900">
                    {kitComponents.reduce((sum, row) => sum + componentPieces(row), 0)}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-gray-600">Total Value</p>
                  <p className="text-2xl text-gray-900">{formatCurrency(getTotalValue())}</p>
                </div>
              </div>
            </Card>

            <Card className="p-6">
              <div className="space-y-3">
                <Button
                  onClick={handleSubmit}
                  disabled={isSaving || (isEditMode && !changeDetection.hasChanges)}
                  className="w-full bg-sky-500 hover:bg-sky-600 text-white"
                >
                  {isSaving ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    <>
                      <Save className="w-4 h-4 mr-2" />
                      {isEditMode ? 'Update Kit' : 'Create Kit'}
                    </>
                  )}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={onCancel}
                  disabled={isSaving}
                  className="w-full"
                >
                  Cancel
                </Button>
              </div>
            </Card>
          </div>
        </div>
      </div>

      {/* Unified Component Picker Dialog */}
      <Dialog open={showPicker} onOpenChange={(open) => { setShowPicker(open); if (!open) setSelectedKeys(new Set()); }}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Add Components</DialogTitle>
            <DialogDescription>
              Add how many of an item (any will do), a specific unit, or a kit.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
              <Input
                type="text"
                placeholder="Search items, units and kits..."
                value={pickerSearchQuery}
                onChange={(e) => setPickerSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>

            <div className="flex items-center justify-between gap-4">
              <div className="flex gap-2">
                {(['all', 'items', 'units', 'kits'] as const).map((f) => (
                  <Badge
                    key={f}
                    variant={pickerFilter === f ? 'default' : 'outline'}
                    className="cursor-pointer capitalize"
                    onClick={() => setPickerFilter(f)}
                  >
                    {f}
                  </Badge>
                ))}
              </div>
              <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer whitespace-nowrap">
                <Checkbox
                  checked={showAlreadyInKit}
                  onCheckedChange={(checked) => setShowAlreadyInKit(checked === true)}
                />
                Show items already in this kit
              </label>
            </div>

            <div className="border border-gray-200 rounded-lg divide-y divide-gray-200 max-h-96 overflow-y-auto">
              {visibleCandidates.length === 0 ? (
                <div className="p-8 text-center text-gray-500">
                  No assets or kits found
                </div>
              ) : (
                ([['item', 'Any of an item'], ['asset', 'A specific unit'], ['kit', 'Kits']] as const).map(([groupType, groupTitle]) => {
                  const group = visibleCandidates.filter((c) => c.type === groupType);
                  if (group.length === 0) return null;
                  return (
                    <div key={groupType} role="group" aria-label={groupTitle}>
                      <div className="px-4 py-1.5 bg-gray-50 text-[10px] font-semibold uppercase tracking-wider text-gray-500">{groupTitle}</div>
                      <div className="divide-y divide-gray-200">
                {group.map((c) => {
                  const key = candidateKey(c);
                  const selected = selectedKeys.has(key);
                  const quantityToAdd = addQuantities.get(key) ?? 1;
                  const disabledReason =
                    c.type === 'kit' && c.wouldCycle
                      ? `Would create a circular reference — this kit is already nested inside ${c.name}`
                      : c.excludedReason;
                  const disabled = !!disabledReason;
                  const assetRecord = c.type === 'asset' ? (c.asset as ItemRecord) : null;
                  const notNow = assetRecord && !isAvailable(assetRecord)
                    ? `${STATUS_LABEL[assetRecord.status ?? ''] ?? assetRecord.status}: not available now` : null;
                  return (
                    <div
                      key={key}
                      data-candidate
                      className={`p-4 flex items-start gap-3 ${
                        disabled ? 'cursor-not-allowed bg-gray-50/60' : 'hover:bg-gray-50 cursor-pointer'
                      }`}
                      onClick={() => toggleSelected(c)}
                    >
                      {/* Selection is handled by the row's onClick — this checkbox is
                          purely a controlled visual indicator, no handler of its own,
                          so a click on it doesn't double-fire via event bubbling. */}
                      <Checkbox checked={selected} disabled={disabled} className="mt-0.5 pointer-events-none" />
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <div className={`text-sm ${disabled ? 'text-gray-400' : 'text-gray-900'}`}>{c.name}</div>
                          {c.type === 'asset' && c.asset.tag_number && (
                            <span className="font-mono text-xs text-gray-600">{c.asset.tag_number}</span>
                          )}
                          <Badge variant="outline" className="gap-1 text-[10px]">
                            {c.type === 'kit' ? <Layers className="w-3 h-3" /> : <Package className="w-3 h-3" />}
                            {c.type === 'kit' ? 'Kit' : c.type === 'item' ? 'Any' : recordKind(c.asset as ItemRecord) === 'lot' ? 'Lot' : 'Unit'}
                          </Badge>
                        </div>
                        {disabledReason ? (
                          <div className="text-xs text-amber-600 flex items-center gap-1 mt-0.5">
                            <AlertCircle className="w-3 h-3" />
                            {disabledReason}
                          </div>
                        ) : (
                          <div className="text-xs text-gray-500">
                            {c.subtitle}
                            {c.type === 'item' && <span>{c.subtitle ? ' • ' : ''}{c.owned} owned · {c.available} available</span>}
                            {c.type === 'asset' && c.quantityAvailable != null && (
                              <span> • {c.quantityAvailable} in stock</span>
                            )}
                            {c.type === 'kit' && ` • ${c.componentCount} component${c.componentCount === 1 ? '' : 's'}`}
                          </div>
                        )}
                        {!disabledReason && notNow && (
                          <div className="text-xs text-amber-600">{notNow}</div>
                        )}
                      </div>
                      {/* A kit is a singular entity — no quantity to set, it's
                          always exactly one instance (enforced when adding and
                          again on save). */}
                      {(c.type === 'asset' || c.type === 'item') && (
                        <div onClick={(e) => e.stopPropagation()} className="flex items-center gap-1.5">
                          <Label htmlFor={`qty-${key}`} className="text-xs text-gray-500">
                            Qty
                          </Label>
                          <Input
                            id={`qty-${key}`}
                            type="number"
                            min="1"
                            max={c.type === 'asset' ? c.quantityAvailable ?? undefined : undefined}
                            value={quantityToAdd}
                            onChange={(e) => {
                              const requested = parseInt(e.target.value) || 1;
                              setAddQuantity(key, Math.min(requested, c.type === 'asset' ? c.quantityAvailable ?? Infinity : Infinity));
                            }}
                            className="w-16 h-8 text-sm"
                          />
                        </div>
                      )}
                    </div>
                  );
                })}
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-500">
                {selectedKeys.size} selected
              </span>
              <Button type="button" onClick={handleAddSelected} disabled={selectedKeys.size === 0}>
                Add {selectedKeys.size > 0 ? selectedKeys.size : ''} Selected
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
