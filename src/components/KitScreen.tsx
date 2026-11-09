import { useState, useEffect, useMemo, useRef } from 'react';
import { AlertCircle, Plus, Save, Loader2, CheckCircle2, Boxes, Container, X } from 'lucide-react';
import { useSimpleFormChanges } from '../utils/hooks/useSimpleFormChanges';
import { createSubmissionPayload, normalizeFormData } from '../utils/form-utils';
import { toast } from 'sonner';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Card } from './ui/card';
import { Textarea } from './ui/textarea';
import { Badge } from './ui/badge';
import AppHeader from './AppHeader';
import { PageHeader } from './layout/PageHeader';
import { Organization, User, UserRole } from '../utils/supabase/types';
import { useAutocompleteSuggestions } from '../utils/hooks/useAutocompleteSuggestions';
import type { KitComponentRow } from './kit/kitTypes';
import { useKitScreenData } from './kit/useKitScreenData';
import { KitComponentPicker } from './kit/KitComponentPicker';
import { KitContentsCard } from './kit/KitContentsCard';
import { componentPieces, formatCurrency, totalValue, type KitLineLookups } from './kit/kitLineValues';

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
  const [showPicker, setShowPicker] = useState(false);
  const [tagInput, setTagInput] = useState('');

  // Sub-kits in the draft: their flattened contents (true equipment value, item count, and the
  // set of asset ids they reach) give their value here, not their own rental_value.
  const childKitIds = useMemo(
    () => Array.from(new Set(kitComponents.filter((c) => c.child_kit_id).map((c) => c.child_kit_id!))),
    [kitComponents],
  );
  // The organization's items and how many of each sit in container kits (#184).
  const {
    kit: loadedKit, kitLoadedAt, isLoading, error: kitLoadError, items, containerPieces, childKitSummaries, saveKit,
  } = useKitScreenData({ kitId, organizationId: organization.id, childKitIds });
  const lookups: KitLineLookups = { items, containerPieces, childKitSummaries };

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

  // The form seeds once per load of the kit (each open, and after a save); a load error leaves
  // the screen.
  useEffect(() => {
    if (kitId && loadedKit) applyLoadedKit(loadedKit);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- once per load, not on every change-tracker render
  }, [kitLoadedAt]);

  useEffect(() => {
    if (!kitLoadError) return;
    console.error('Error loading kit:', kitLoadError);
    toast.error(kitLoadError);
    onCancel();
  // eslint-disable-next-line react-hooks/exhaustive-deps -- once per failed load
  }, [kitLoadError]);

  // Ids of the components loaded: a save deletes only those the user removed (#92).
  const loadedComponentIdsRef = useRef<string[]>([]);

  const applyLoadedKit = (kit: any) => {
    {
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
    }
  };

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
        await saveKit({ kitData, loadedComponentIds: loadedComponentIdsRef.current });
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
        const newKit = await saveKit({ kitData, loadedComponentIds: [] });
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

            <KitContentsCard
              kitComponents={kitComponents}
              lookups={lookups}
              error={errors.components}
              onAddComponents={() => setShowPicker(true)}
              onUpdateQuantity={handleUpdateQuantity}
              onRemove={handleRemoveComponent}
            />
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
                    {kitComponents.reduce((sum, row) => sum + componentPieces(row, lookups), 0)}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-gray-600">Total Value</p>
                  <p className="text-2xl text-gray-900">{formatCurrency(totalValue(kitComponents, lookups))}</p>
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

      <KitComponentPicker
        open={showPicker}
        onOpenChange={setShowPicker}
        organizationId={organization.id}
        kitId={kitId}
        kitComponents={kitComponents}
        items={items}
        containerPieces={containerPieces}
        onAdd={(rows) => setKitComponents((prev) => [...prev, ...rows])}
      />
    </div>
  );
}
