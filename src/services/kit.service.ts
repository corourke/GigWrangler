import { handleApiError } from '../utils/api-error-utils';
import { getCurrentUser, getSupabase } from './base/dataAccess';
import { computeFieldChanges } from '../utils/fieldChanges';
import { sanitizeLikeInput } from '../utils/validation-utils';
import { writeActivity, actorNameOf } from './writeActivity';
import { pieceValue } from '../utils/equipmentItems';

const KIT_TRACKED_FIELDS = [
  'name', 'category', 'description', 'tags', 'rental_value', 'tag_number', 'is_container',
] as const;

/**
 * Fetch kits for an organization
 */
export async function getKits(organizationId: string, filters?: {
  category?: string;
  search?: string;
}) {
  const supabase = getSupabase();
  try {
    let query = supabase
      .from('kits')
      .select(`
        *,
        kit_components!kit_assets_kit_id_fkey!inner(
          quantity,
          asset:assets(*)
        )
      `)
      .eq('organization_id', organizationId)
      .order('name');

    if (filters?.category) {
      query = query.eq('category', filters.category);
    }

    if (filters?.search) {
      const s = sanitizeLikeInput(filters.search);
      query = query.or(`name.ilike.%${s}%,description.ilike.%${s}%`);
    }

    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  } catch (err) {
    return handleApiError(err, 'fetch kits');
  }
}

/** Every kit in the organization, for pickers (getKits leaves out empty kits). */
export async function getKitOptions(organizationId: string): Promise<{ id: string; name: string }[]> {
  const supabase = getSupabase();
  try {
    const { data, error } = await (supabase.from('kits') as any)
      .select('id, name')
      .eq('organization_id', organizationId)
      .order('name');
    if (error) throw error;
    return (data ?? []) as { id: string; name: string }[];
  } catch (err) {
    return handleApiError(err, 'fetch kits');
  }
}

/** Put a new equipment record (all of its quantity) into kits. */
export async function addAssetToKits(assetId: string, kitIds: string[], quantity: number): Promise<void> {
  if (!kitIds.length) return;
  return addKitAssetLines(kitIds.map(kit_id => ({ kit_id, asset_id: assetId, quantity })));
}

/**
 * Add kit lines for specific units or lots (an `asset_id` line each, as the kit editor
 * writes them): a unit with quantity 1, a lot with its quantity. Used by the CSV import
 * (#183 D) for the units and lots it has just made.
 */
export async function addKitAssetLines(lines: { kit_id: string; asset_id: string; quantity: number }[]): Promise<void> {
  if (!lines.length) return;
  const supabase = getSupabase();
  try {
    const rows = lines.map(l => ({ kit_id: l.kit_id, asset_id: l.asset_id, quantity: Math.max(1, Math.round(l.quantity || 1)) }));
    // A plain insert: the (kit_id, asset_id) unique index is partial, which
    // PostgREST's on-conflict can't target. Callers pass only new records.
    const { error } = await (supabase.from('kit_components') as any).insert(rows);
    if (error) throw error;
  } catch (err) {
    return handleApiError(err, 'add equipment to kits');
  }
}

/**
 * Fetch a single kit with its direct components (assets and/or sub-kits, one
 * level — not the recursive flattened view, see getKitFlattenedContents).
 */
export async function getKit(kitId: string) {
  const supabase = getSupabase();
  try {
    const { data, error } = await supabase
      .from('kits')
      .select(`
        *,
        kit_components!kit_assets_kit_id_fkey(
          id,
          quantity,
          notes,
          asset_id,
          child_kit_id,
          equipment_item_id,
          asset:assets(*),
          item:equipment_items(id, manufacturer_model, category, type),
          child_kit:kits!kit_components_child_kit_id_fkey(id, name, is_container, category, rental_value)
        )
      `)
      .eq('id', kitId)
      .single();

    if (error) throw error;
    return data;
  } catch (err) {
    return handleApiError(err, 'fetch kit');
  }
}

/**
 * Get distinct values for a field in kits
 */
export async function getDistinctKitValues(
  organizationId: string,
  field: 'category'
): Promise<string[]> {
  const supabase = getSupabase();
  try {
    const { data, error } = await supabase
      .from('kits')
      .select(field)
      .eq('organization_id', organizationId)
      .not(field, 'is', null);

    if (error) throw error;

    const uniqueValues = Array.from(
      new Set(
        (data || [])
          .map((item: any) => item[field])
          .filter((value): value is string => !!value && value.trim() !== '')
      )
    ).sort();

    return uniqueValues;
  } catch (err) {
    return handleApiError(err, `fetch distinct kit ${field} values`);
  }
}

/**
 * A row in a kit's component list. Exactly one of asset_id (a specific unit or
 * lot), equipment_item_id ("N × any" of an item, #184) or child_kit_id is set.
 */
export type KitComponentInput = {
  id?: string;
  asset_id?: string;
  equipment_item_id?: string;
  child_kit_id?: string;
  quantity: number;
  notes?: string;
};

/**
 * Create a new kit with its components (assets and/or sub-kits)
 */
export async function createKit(kitData: {
  organization_id: string;
  name: string;
  category?: string;
  description?: string;
  tags?: string[];
  is_container?: boolean;
  components: KitComponentInput[];
}) {
  try {
    const user = await getCurrentUser();
    const supabase = getSupabase();

    const { components, ...restKitData } = kitData;

    const { data: kit, error: kitError } = await supabase
      .from('kits')
      .insert({
        ...restKitData,
        created_by: user.id,
        updated_by: user.id,
      })
      .select()
      .single();

    if (kitError) throw kitError;

    try {
      const actorDisplayName = actorNameOf(user);
      const { data: orgRow } = await (supabase.from('organizations') as any).select('name').eq('id', restKitData.organization_id).single();
      const actorOrgName = (orgRow as any)?.name ?? '';

      await writeActivity({
        organization_id: restKitData.organization_id,
        event_type: 'kit.created',
        entity_type: 'kit',
        entity_id: kit.id,
        gig_id: null,
        actor_display_name: actorDisplayName,
        actor_org_name: actorOrgName,
        context: { kit_name: kit.name },
      });
    } catch (e) {
      console.error('Activity log failed:', e);
    }

    if (components && components.length > 0) {
      const kitComponents = components.map(c => ({
        kit_id: kit.id,
        asset_id: c.asset_id ?? null,
        equipment_item_id: c.equipment_item_id ?? null,
        child_kit_id: c.child_kit_id ?? null,
        // A kit is a singular entity — it's either nested in the parent or
        // not, never nested "N times" as one row. Enforced here too, not
        // just in the picker, since this is the actual write path.
        quantity: c.child_kit_id ? 1 : c.quantity,
        notes: c.notes || null,
      }));

      const { error: componentsError } = await supabase.from('kit_components').insert(kitComponents);
      if (componentsError) {
        await supabase.from('kits').delete().eq('id', kit.id);
        throw componentsError;
      }
    }

    return kit;
  } catch (err) {
    return handleApiError(err, 'create kit');
  }
}

/** An item's model, for the activity log. */
async function itemModel(supabase: any, itemId: string): Promise<string> {
  const { data } = await supabase.from('equipment_items').select('manufacturer_model').eq('id', itemId).single();
  return data?.manufacturer_model ?? '';
}

/**
 * Update an existing kit and its components (assets and/or sub-kits).
 *
 * `loadedComponentIds` are the ids of the components the caller loaded. Only
 * those no longer in `components` are deleted: a component someone else added
 * since is left alone, and with no `loadedComponentIds` nothing is deleted
 * (issue #92).
 */
export async function updateKit(kitId: string, kitData: {
  name?: string;
  category?: string;
  description?: string;
  tags?: string[];
  tag_number?: string;
  rental_value?: number | null;
  is_container?: boolean;
  organization_id?: string;
  components?: KitComponentInput[];
}, loadedComponentIds: string[] = []) {
  try {
    const user = await getCurrentUser();
    const supabase = getSupabase();

    // 1. Pre-fetch for diffing and actor info
    const { data: kitRow } = await (supabase.from('kits') as any)
      .select('*, organization:organizations(name)')
      .eq('id', kitId)
      .single();

    if (!kitRow) throw new Error('Kit not found');

    const actorDisplayName = actorNameOf(user);
    const actorOrgName = (kitRow as any).organization?.name ?? '';
    const organizationId = kitRow.organization_id;
    const kitName = kitRow.name;

    const { components, organization_id: _orgId, ...restKitData } = kitData;

    if (Object.keys(restKitData).length > 0) {
      // .select() returns the saved row from this same update, for the change list (#20).
      const { data: savedRows, error: updateError } = await supabase
        .from('kits')
        .update({
          ...restKitData,
          updated_by: user.id,
          updated_at: new Date().toISOString(),
        })
        .eq('id', kitId)
        .select();

      if (updateError) throw updateError;

      // What the save changed: the record as saved before vs as saved now. Nothing saved, nothing logged.
      const savedKit = (savedRows ?? [])[0];
      const field_changes = savedKit ? computeFieldChanges(kitRow, savedKit, KIT_TRACKED_FIELDS) : [];

      if (field_changes.length > 0) {
        try {
          await writeActivity({
            organization_id: organizationId,
            event_type: 'kit.updated',
            entity_type: 'kit',
            entity_id: kitId,
            gig_id: null,
            actor_display_name: actorDisplayName,
            actor_org_name: actorOrgName,
            context: { kit_name: kitName, field_changes },
          });
        } catch (e) { console.error('Activity log failed:', e); }
      }
    }

    if (components) {
      const { data: existingComponents } = await (supabase.from('kit_components') as any)
        .select('id, asset_id, equipment_item_id, child_kit_id')
        .eq('kit_id', kitId);
      const existingIds = existingComponents?.map((c: any) => c.id) || [];
      const incomingIds = components.filter(c => c.id).map(c => c.id!);

      const idsToDelete = existingIds.filter((id: string) => loadedComponentIds.includes(id) && !incomingIds.includes(id));

      if (idsToDelete.length > 0) {
        const removed = (existingComponents ?? []).filter((c: any) => idsToDelete.includes(c.id));
        const { error: deleteError } = await supabase.from('kit_components').delete().in('id', idsToDelete);
        if (deleteError) throw deleteError;
        for (const c of removed) {
          try {
            if (c.asset_id) {
              const { data: assetRow } = await (supabase.from('assets') as any).select('manufacturer_model').eq('id', c.asset_id).single();
              await writeActivity({
                organization_id: organizationId,
                event_type: 'kit.asset_removed',
                entity_type: 'kit',
                entity_id: kitId,
                gig_id: null,
                actor_display_name: actorDisplayName,
                actor_org_name: actorOrgName,
                context: { kit_name: kitName, asset_model: (assetRow as any)?.manufacturer_model ?? '' },
              });
            } else if (c.equipment_item_id) {
              await writeActivity({
                organization_id: organizationId,
                event_type: 'kit.asset_removed',
                entity_type: 'kit',
                entity_id: kitId,
                gig_id: null,
                actor_display_name: actorDisplayName,
                actor_org_name: actorOrgName,
                context: { kit_name: kitName, asset_model: `any ${await itemModel(supabase, c.equipment_item_id)}` },
              });
            } else if (c.child_kit_id) {
              const { data: subKitRow } = await (supabase.from('kits') as any).select('name').eq('id', c.child_kit_id).single();
              await writeActivity({
                organization_id: organizationId,
                event_type: 'kit.subkit_removed',
                entity_type: 'kit',
                entity_id: kitId,
                gig_id: null,
                actor_display_name: actorDisplayName,
                actor_org_name: actorOrgName,
                context: { kit_name: kitName, subkit_name: (subKitRow as any)?.name ?? '' },
              });
            }
          } catch (e) { console.error('Activity log failed:', e); }
        }
      }

      for (const component of components) {
        const componentData = {
          asset_id: component.asset_id ?? null,
          equipment_item_id: component.equipment_item_id ?? null,
          child_kit_id: component.child_kit_id ?? null,
          // See createKit — a kit component is always exactly one instance.
          quantity: component.child_kit_id ? 1 : component.quantity,
          notes: component.notes || null,
        };
        if (component.id && existingIds.includes(component.id)) {
          const { error: updateError } = await supabase.from('kit_components').update(componentData).eq('id', component.id);
          if (updateError) throw updateError;
        } else {
          const { error: insertError } = await supabase.from('kit_components').insert({ kit_id: kitId, ...componentData });
          if (insertError) throw insertError;
          try {
            if (component.asset_id) {
              const { data: assetRow } = await (supabase.from('assets') as any).select('manufacturer_model').eq('id', component.asset_id).single();
              await writeActivity({
                organization_id: organizationId,
                event_type: 'kit.asset_added',
                entity_type: 'kit',
                entity_id: kitId,
                gig_id: null,
                actor_display_name: actorDisplayName,
                actor_org_name: actorOrgName,
                context: { kit_name: kitName, asset_model: (assetRow as any)?.manufacturer_model ?? '', quantity: component.quantity },
              });
            } else if (component.equipment_item_id) {
              await writeActivity({
                organization_id: organizationId,
                event_type: 'kit.asset_added',
                entity_type: 'kit',
                entity_id: kitId,
                gig_id: null,
                actor_display_name: actorDisplayName,
                actor_org_name: actorOrgName,
                context: { kit_name: kitName, asset_model: `any ${await itemModel(supabase, component.equipment_item_id)}`, quantity: component.quantity },
              });
            } else if (component.child_kit_id) {
              const { data: subKitRow } = await (supabase.from('kits') as any).select('name').eq('id', component.child_kit_id).single();
              await writeActivity({
                organization_id: organizationId,
                event_type: 'kit.subkit_added',
                entity_type: 'kit',
                entity_id: kitId,
                gig_id: null,
                actor_display_name: actorDisplayName,
                actor_org_name: actorOrgName,
                context: { kit_name: kitName, subkit_name: (subKitRow as any)?.name ?? '', quantity: component.quantity },
              });
            }
          } catch (e) { console.error('Activity log failed:', e); }
        }
      }
    }

    return getKit(kitId);
  } catch (err) {
    return handleApiError(err, 'update kit');
  }
}

/**
 * Delete a kit
 */
export async function deleteKit(kitId: string) {
  const supabase = getSupabase();
  try {
    // .select() to confirm a row was removed — RLS denies silently (0 rows, no error)
    const { data, error } = await supabase.from('kits').delete().eq('id', kitId).select();
    if (error) throw error;
    if (!data || data.length === 0) {
      throw new Error('Kit not found, or you do not have permission to delete it.');
    }
    return { success: true };
  } catch (err) {
    return handleApiError(err, 'delete kit');
  }
}

/**
 * Duplicate an existing kit, including its is_container/rental_value flags
 * and all direct components (assets and sub-kits).
 */
export async function duplicateKit(kitId: string, newName?: string) {
  try {
    const user = await getCurrentUser();
    const supabase = getSupabase();

    const originalKit = await getKit(kitId);

    const { data: newKit, error: kitError } = await supabase
      .from('kits')
      .insert({
        organization_id: originalKit.organization_id,
        name: newName || `${originalKit.name} (Copy)`,
        category: originalKit.category,
        description: originalKit.description,
        tags: originalKit.tags || [],
        is_container: originalKit.is_container,
        rental_value: originalKit.rental_value,
        created_by: user.id,
        updated_by: user.id,
      })
      .select()
      .single();

    if (kitError) throw kitError;

    try {
      const actorDisplayName = actorNameOf(user);
      const { data: orgRow } = await (supabase.from('organizations') as any).select('name').eq('id', originalKit.organization_id).single();
      const actorOrgName = (orgRow as any)?.name ?? '';

      await writeActivity({
        organization_id: originalKit.organization_id,
        event_type: 'kit.created',
        entity_type: 'kit',
        entity_id: newKit.id,
        gig_id: null,
        actor_display_name: actorDisplayName,
        actor_org_name: actorOrgName,
        context: { kit_name: newKit.name },
      });
    } catch (e) {
      console.error('Activity log failed:', e);
    }

    if (originalKit.kit_components && originalKit.kit_components.length > 0) {
      const kitComponents = originalKit.kit_components.map((c: any) => ({
        kit_id: newKit.id,
        asset_id: c.asset_id ?? null,
        child_kit_id: c.child_kit_id ?? null,
        equipment_item_id: c.equipment_item_id ?? null,
        quantity: c.quantity,
        notes: c.notes,
      }));
      const { error: componentsError } = await supabase.from('kit_components').insert(kitComponents);
      if (componentsError) {
        // No empty "(Copy)" left behind, as in createKit.
        await supabase.from('kits').delete().eq('id', newKit.id);
        throw componentsError;
      }
    }

    return newKit;
  } catch (err) {
    return handleApiError(err, 'duplicate kit');
  }
}

/**
 * The fully-flattened (recursive) asset contents of a kit — reads the
 * write-time-maintained cache, not a live recursive query. Includes asset
 * display data for rendering.
 */
export async function getKitFlattenedContents(kitId: string) {
  const supabase = getSupabase();
  try {
    const { data, error } = await supabase
      .from('kit_flattened_cache')
      .select('asset_id, total_quantity, asset:assets(*)')
      .eq('kit_id', kitId);

    if (error) throw error;
    return data || [];
  } catch (err) {
    return handleApiError(err, 'fetch kit flattened contents');
  }
}

/**
 * The "any" lines of a kit and everything nested in it (#184): pieces per
 * item, with the item and its records (for owned and value).
 */
export async function getKitFlattenedItems(kitId: string) {
  const supabase = getSupabase();
  try {
    const { data, error } = await (supabase.from('kit_flattened_item_cache') as any)
      .select('equipment_item_id, total_quantity, item:equipment_items(id, manufacturer_model, category, type, records:assets(quantity, replacement_value, status, retired_on))')
      .eq('kit_id', kitId);
    if (error) throw error;
    return (data || []) as {
      equipment_item_id: string;
      total_quantity: number;
      item: { id: string; manufacturer_model: string; category: string | null; type?: string | null; records: any[] } | null;
    }[];
  } catch (err) {
    return handleApiError(err, 'fetch kit item lines');
  }
}

export interface KitFlattenedSummary {
  /** Sum of each flattened asset's replacement_value × quantity. */
  totalValue: number;
  /** Sum of each flattened asset's quantity — the true item count, recursing through nested kits. */
  totalItems: number;
  /** Every distinct asset reachable inside this kit, at any depth — used to detect the same physical asset entering a kit twice (once directly, once via a nested sub-kit, or via two different sub-kits). */
  assetIds: Set<string>;
  /** A readable name per asset id ("Shure SM58 (#M-12)"), to say what two kits share. */
  assetLabels: Map<string, string>;
  /** Pieces asked for by "any" lines, per item, through nested kits (#184). */
  itemQuantities?: Map<string, number>;
}

/** How an asset is named when telling the user what overlaps: model, plus tag when it has one. */
export function assetLabel(asset: { manufacturer_model?: string | null; tag_number?: string | null } | null | undefined): string {
  const model = asset?.manufacturer_model || 'Unnamed item';
  return asset?.tag_number ? `${model} (#${asset.tag_number})` : model;
}

/**
 * Flattened item count, replacement value, and asset-id set for each of the
 * given kits — one batched query against the recursive cache, so callers
 * never need to walk `kit_components` (whose child-kit rows carry no
 * `asset`/quantity of their own and would otherwise silently read as zero —
 * see the Kits list "Total Value"/"Items" columns and a kit's own contents
 * table for two places that bug showed up in practice). A sub-kit's own
 * rental_value isn't relevant to either total (see requirements: the
 * parent's rental value is what the user sets, informed by replacement
 * cost).
 */
export async function getKitsFlattenedSummary(kitIds: string[]): Promise<Map<string, KitFlattenedSummary>> {
  const result = new Map<string, KitFlattenedSummary>();
  if (kitIds.length === 0) return result;

  const supabase = getSupabase();
  try {
    const { data, error } = await supabase
      .from('kit_flattened_cache')
      .select('kit_id, asset_id, total_quantity, asset:assets(replacement_value, manufacturer_model, tag_number)')
      .in('kit_id', kitIds);

    if (error) throw error;
    const summaryOf = (kitId: string) => {
      const existing = result.get(kitId) || { totalValue: 0, totalItems: 0, assetIds: new Set<string>(), assetLabels: new Map<string, string>(), itemQuantities: new Map<string, number>() };
      result.set(kitId, existing);
      return existing;
    };
    for (const row of (data || []) as any[]) {
      const existing = summaryOf(row.kit_id);
      existing.totalValue += (row.asset?.replacement_value || 0) * row.total_quantity;
      existing.totalItems += row.total_quantity;
      existing.assetIds.add(row.asset_id);
      existing.assetLabels.set(row.asset_id, assetLabel(row.asset));
    }

    // "Any" lines: N pieces of an item, valued at its average piece.
    const { data: itemRows, error: itemError } = await supabase
      .from('kit_flattened_item_cache')
      .select('kit_id, equipment_item_id, total_quantity')
      .in('kit_id', kitIds);
    if (itemError) throw itemError;
    const itemIds = Array.from(new Set(((itemRows || []) as any[]).map((r) => r.equipment_item_id)));
    const values = new Map<string, number>();
    if (itemIds.length) {
      const { data: records, error: recordsError } = await supabase
        .from('assets')
        .select('equipment_item_id, quantity, replacement_value, status, retired_on')
        .in('equipment_item_id', itemIds);
      if (recordsError) throw recordsError;
      const byItem = new Map<string, any[]>();
      for (const r of (records || []) as any[]) byItem.set(r.equipment_item_id, [...(byItem.get(r.equipment_item_id) ?? []), r]);
      for (const id of itemIds) values.set(id, pieceValue(byItem.get(id) ?? []));
    }
    for (const row of (itemRows || []) as any[]) {
      const existing = summaryOf(row.kit_id);
      existing.totalItems += row.total_quantity;
      existing.totalValue += (values.get(row.equipment_item_id) ?? 0) * row.total_quantity;
      const quantities = (existing.itemQuantities ??= new Map<string, number>());
      quantities.set(row.equipment_item_id, (quantities.get(row.equipment_item_id) ?? 0) + row.total_quantity);
    }
    return result;
  } catch (err) {
    return handleApiError(err, 'fetch kits flattened summary');
  }
}

/**
 * The nested sub-kit structure (edges + depth) for the hierarchy display,
 * enriched with each child kit's name — the RPC only returns IDs, so this
 * does one follow-up batch fetch rather than a second DB round-trip per edge.
 */
export async function getKitHierarchyTree(kitId: string): Promise<{
  parent_kit_id: string;
  child_kit_id: string;
  child_kit_name: string;
  quantity: number;
  depth: number;
}[]> {
  const supabase = getSupabase();
  try {
    const { data, error } = await supabase.rpc('get_kit_hierarchy_tree', { p_kit_id: kitId });
    if (error) throw error;
    const edges = data || [];
    if (edges.length === 0) return [];

    const childKitIds = Array.from(new Set(edges.map((e: any) => e.child_kit_id)));
    const { data: childKits, error: kitsError } = await supabase
      .from('kits')
      .select('id, name')
      .in('id', childKitIds);
    if (kitsError) throw kitsError;

    const nameById = new Map((childKits || []).map((k: any) => [k.id, k.name]));
    return edges.map((e: any) => ({ ...e, child_kit_name: nameById.get(e.child_kit_id) ?? 'Unknown Kit' }));
  } catch (err) {
    return handleApiError(err, 'fetch kit hierarchy tree');
  }
}

/**
 * Which of the given candidate kits would create a circular reference if
 * nested into `parentKitId` — lets the picker flag a candidate inline,
 * right on its row, instead of only finding out from the
 * kit_components_prevent_cycle trigger's rejection at save time. One
 * batched RPC call wrapping the same kit_would_create_cycle() the trigger
 * itself uses, so the two can never disagree.
 */
export async function getKitsThatWouldCycle(parentKitId: string, candidateKitIds: string[]): Promise<Set<string>> {
  const result = new Set<string>();
  if (candidateKitIds.length === 0) return result;

  const supabase = getSupabase();
  try {
    const { data, error } = await supabase.rpc('kits_that_would_cycle', {
      p_parent_kit_id: parentKitId,
      p_candidate_kit_ids: candidateKitIds,
    });
    if (error) throw error;
    for (const row of (data || []) as any[]) result.add(row.kit_id);
    return result;
  } catch (err) {
    return handleApiError(err, 'check kit cycle candidates');
  }
}

export interface KitComponentTreeNode {
  clientKey: string;
  /** 'item': "N × any" of an item (#184); quantity is N. */
  type: 'asset' | 'item' | 'kit';
  quantity: number;
  asset?: any;
  item?: { id: string; manufacturer_model: string; category: string | null; type?: string | null };
  kit?: { id: string; name: string; category: string | null; is_container: boolean; tag_number?: string | null };
  /** Populated (possibly empty) for kit-type nodes only. */
  children: KitComponentTreeNode[];
}

/**
 * The full nested tree of this kit's contents — assets and sub-kits kept
 * per level, unlike kit_flattened_cache which aggregates everything into
 * one flat per-asset total — so the UI can render true nesting and label
 * each sub-kit as a container or individual items. Every level is
 * included, even inside containers; it's up to the caller (see
 * `countInventoryItems`, and the "show container contents" toggle in
 * KitDetailScreen) whether to drill into a container's own contents.
 *
 * Reuses the existing get_kit_hierarchy_tree RPC for the set of descendant
 * kit ids, then does two batched follow-up queries (every involved kit's
 * own name/category/is_container, and every involved kit's own direct
 * components) rather than one query per level.
 */
export async function getKitComponentTree(kitId: string): Promise<KitComponentTreeNode[]> {
  const supabase = getSupabase();
  try {
    const { data: edgeRows, error: edgeError } = await supabase.rpc('get_kit_hierarchy_tree', { p_kit_id: kitId });
    if (edgeError) throw edgeError;
    const edges = (edgeRows || []) as { parent_kit_id: string; child_kit_id: string; quantity: number; depth: number }[];

    const allKitIds = Array.from(new Set([kitId, ...edges.map((e) => e.child_kit_id)]));

    const [{ data: kitsData, error: kitsError }, { data: componentRows, error: componentsError }] = await Promise.all([
      supabase.from('kits').select('id, name, category, is_container, tag_number').in('id', allKitIds),
      supabase.from('kit_components').select('kit_id, asset_id, child_kit_id, equipment_item_id, quantity, asset:assets(*), item:equipment_items(id, manufacturer_model, category, type)').in('kit_id', allKitIds),
    ]);
    if (kitsError) throw kitsError;
    if (componentsError) throw componentsError;

    const kitsById = new Map((kitsData || []).map((k: any) => [k.id, k]));
    const componentsByKit = new Map<string, any[]>();
    for (const row of (componentRows || []) as any[]) {
      const list = componentsByKit.get(row.kit_id) || [];
      list.push(row);
      componentsByKit.set(row.kit_id, list);
    }

    const buildChildren = (parentKitId: string): KitComponentTreeNode[] =>
      (componentsByKit.get(parentKitId) || []).map((row) => {
        if (row.asset_id) {
          return {
            clientKey: `asset-${row.asset_id}`,
            type: 'asset' as const,
            quantity: row.quantity,
            asset: row.asset,
            children: [],
          };
        }
        if (row.equipment_item_id) {
          return {
            clientKey: `item-${row.equipment_item_id}`,
            type: 'item' as const,
            quantity: row.quantity,
            item: row.item ?? { id: row.equipment_item_id, manufacturer_model: 'Unknown item', category: null },
            children: [],
          };
        }
        const childKit = kitsById.get(row.child_kit_id);
        return {
          clientKey: `kit-${row.child_kit_id}`,
          type: 'kit' as const,
          quantity: row.quantity,
          kit: {
            id: row.child_kit_id,
            name: childKit?.name ?? 'Unknown Kit',
            category: childKit?.category ?? null,
            is_container: !!childKit?.is_container,
            tag_number: childKit?.tag_number ?? null,
          },
          children: buildChildren(row.child_kit_id),
        };
      });

    return buildChildren(kitId);
  } catch (err) {
    return handleApiError(err, 'fetch kit component tree');
  }
}

/**
 * "Inventory items" per the kit-hierarchy tracking model: a physical asset
 * counts individually, but a container sub-kit counts as exactly one item
 * and its own contents aren't drilled into further — day to day it's a
 * sealed unit, not a bag of loose parts. A non-container sub-kit is
 * transparent: it isn't itself counted, it just contributes whatever its
 * own contents count to (recursively, until hitting a container or a leaf
 * asset) — multiplied by its own quantity, same as a container or an asset
 * (2 copies of a non-container sub-kit means 2x everything inside it).
 * Contrast with the fully-flattened "Total Items" count, which ignores
 * container boundaries entirely.
 */
export function countInventoryItems(nodes: KitComponentTreeNode[]): number {
  return nodes.reduce((total, node) => {
    if (node.type === 'asset' || node.type === 'item') return total + node.quantity;
    if (node.kit?.is_container) return total + node.quantity;
    return total + node.quantity * countInventoryItems(node.children);
  }, 0);
}

export interface ScanUnit {
  /** Which kit this unit is tracked/grouped under — the container's own id
   * for a container unit, or the top (owning) kit's id for a loose asset. */
  kit_id: string;
  kit_name: string | null;
  is_container: boolean;
  /** unit / lot: a specific record; any: N of an item (#185); container: a sealed case. */
  kind: 'unit' | 'lot' | 'any' | 'container';
  asset_id: string | null;
  /** An "any" line's item. */
  item_id?: string | null;
  asset_name: string | null;
  tag_number: string | null;
  /** How many the kit asks for, multiplied through non-container sub-kits
   * (2 copies of a sub-kit is 2x everything in it). Scanning tracks status per
   * asset_id, not per physical copy, so this is a count on the row. */
  quantity: number;
  /** A lot line: how many the lot holds ("from a lot of 6"). */
  lot_of?: number | null;
  /** A container: what it holds, e.g. "8 × XLR Cable". */
  contents?: string[];
}

const nodeLabel = (n: KitComponentTreeNode) =>
  n.type === 'asset' ? n.asset?.manufacturer_model ?? 'Unnamed item'
    : n.type === 'item' ? n.item?.manufacturer_model ?? 'Unknown item'
      : n.kit?.name ?? 'Unknown Kit';
const isLotAsset = (a: { serial_number?: string | null; tag_number?: string | null } | null | undefined) =>
  !a?.serial_number?.trim() && !a?.tag_number?.trim();

/**
 * Every physically scannable unit in a kit's tree, respecting container
 * boundaries at *every* level, not just the top one — the traversal
 * `kit_flattened_cache` can't do, since it flattens straight through every
 * container. A container sub-kit becomes its own single unit, however
 * deeply nested, and is never drilled into further; a non-container
 * sub-kit is transparent, contributing whatever its own contents resolve
 * to. Loose assets and "any" lines (not sealed inside any container) are
 * attributed to `owningKit` — the top kit whose tree this is, matching how
 * gig_kit_assignments only ever assigns top-level kits.
 */
export function flattenToScanUnits(nodes: KitComponentTreeNode[], owningKit: { id: string; name: string }, multiplier = 1): ScanUnit[] {
  const units: ScanUnit[] = [];
  for (const node of nodes) {
    const quantity = node.quantity * multiplier;
    if (node.type === 'asset') {
      const lot = isLotAsset(node.asset as any);
      units.push({
        kit_id: owningKit.id,
        kit_name: owningKit.name,
        is_container: false,
        kind: lot ? 'lot' : 'unit',
        asset_id: node.asset?.id ?? null,
        asset_name: node.asset?.manufacturer_model ?? null,
        tag_number: node.asset?.tag_number ?? null,
        quantity,
        lot_of: lot ? Number((node.asset as any)?.quantity ?? 1) : null,
      });
    } else if (node.type === 'item') {
      units.push({
        kit_id: owningKit.id,
        kit_name: owningKit.name,
        is_container: false,
        kind: 'any',
        asset_id: null,
        item_id: node.item?.id ?? null,
        asset_name: node.item?.manufacturer_model ?? null,
        tag_number: null,
        quantity,
      });
    } else if (node.kit?.is_container) {
      units.push({
        kit_id: node.kit.id,
        kit_name: node.kit.name,
        is_container: true,
        kind: 'container',
        asset_id: null,
        asset_name: null,
        tag_number: node.kit.tag_number ?? null,
        quantity,
        contents: node.children.map((c) => `${c.quantity} × ${nodeLabel(c)}`),
      });
    } else {
      units.push(...flattenToScanUnits(node.children, owningKit, quantity));
    }
  }
  return units;
}

/** Deepest sub-kit nesting level reached anywhere in the tree (a direct sub-kit is depth 1). */
export function maxTreeDepth(nodes: KitComponentTreeNode[]): number {
  return nodes.reduce((max, node) => {
    if (node.type !== 'kit') return max;
    return Math.max(max, 1 + maxTreeDepth(node.children));
  }, 0);
}
