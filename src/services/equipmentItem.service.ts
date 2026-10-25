import { getSupabase, getCurrentUser, getRecord, listRecords } from './base/dataAccess';
import { handleApiError } from '../utils/api-error-utils';
import type { DbAsset, DbEquipmentItem } from '../utils/supabase/types';
import { containerPiecesByItem, recordItemMaps, type ContainerPieces, type ItemRecord } from '../utils/equipmentItems';

// Equipment items (#162, #182): what a piece of equipment is. Its units and
// lots are rows in `assets`, each pointing at its item (migration 20261014000000).

export type EquipmentItemWithRecords = DbEquipmentItem & { records: DbAsset[] };

/** The fields an item shares with every unit and lot it has. */
export const ITEM_FIELDS = ['category', 'manufacturer_model', 'type', 'description', 'insurance_class'] as const;
export type ItemFields = Partial<Pick<DbEquipmentItem, (typeof ITEM_FIELDS)[number]>>;

const withRecords = (row: any): EquipmentItemWithRecords => ({ ...row, records: row?.records ?? [] });

/** The organization's items, each with its units and lots. */
export async function getItems(organizationId: string): Promise<EquipmentItemWithRecords[]> {
  const supabase = getSupabase();
  try {
    const { data, error } = await (supabase.from('equipment_items') as any)
      .select('*, records:assets(*)')
      .eq('organization_id', organizationId)
      .order('manufacturer_model');
    if (error) throw error;
    return (data ?? []).map(withRecords);
  } catch (err) {
    return handleApiError(err, 'fetch equipment items');
  }
}

/** One item with its units and lots. */
export async function getItem(itemId: string): Promise<EquipmentItemWithRecords> {
  const data = await getRecord('equipment_items', itemId, {
    select: '*, records:assets(*)',
    mode: 'single',
    context: 'fetch equipment item',
  });
  return withRecords(data);
}

/**
 * Change what an item is. Until every screen reads items (#183–#186), its
 * units and lots keep their own copies of these fields, so they are updated
 * too; the database keeps each record on this item while they match.
 */
export async function updateItem(itemId: string, fields: ItemFields): Promise<DbEquipmentItem> {
  try {
    const user = await getCurrentUser();
    const supabase = getSupabase();
    // Trimmed; a cleared optional field (type, description, insurance class) is null.
    const shared = Object.fromEntries(ITEM_FIELDS.filter((f) => f in fields).map((f) => {
      const value = typeof fields[f] === 'string' ? (fields[f] as string).trim() : fields[f];
      return [f, value === '' && f !== 'category' && f !== 'manufacturer_model' ? null : value];
    }));

    const { data, error } = await (supabase.from('equipment_items') as any)
      .update({ ...shared, updated_by: user.id })
      .eq('id', itemId)
      .select()
      .single();
    if (error) {
      if (error.code === '23505') {
        throw new Error('Another item already has this manufacturer & model and category.');
      }
      throw error;
    }

    if (Object.keys(shared).length > 0) {
      const { error: recordsError } = await (supabase.from('assets') as any)
        .update({ ...shared, updated_by: user.id })
        .eq('equipment_item_id', itemId);
      // The item is already saved; say so, so the error isn't read as nothing saved.
      if (recordsError) {
        throw new Error(`The item was saved, but its units and lots weren’t updated (${recordsError.message}). Try the change again.`);
      }
    }
    return data;
  } catch (err) {
    return handleApiError(err, 'update equipment item');
  }
}

/**
 * How many pieces of each item sit inside container kits, which are never
 * free for other kits (#162 Q8): all of them (shown as "in container kits"),
 * and the available ones (the only ones "available" loses, #230).
 */
export async function getContainerPieces(
  organizationId: string,
  items: ReadonlyArray<{ id: string; records?: ReadonlyArray<ItemRecord> | null }>,
  /** A kit being edited: its own contents aren't counted against it (#184). */
  excludeKitId?: string | null,
): Promise<ContainerPieces> {
  const supabase = getSupabase();
  try {
    const { data: kits, error } = await (supabase.from('kits') as any)
      .select('id')
      .eq('organization_id', organizationId)
      .eq('is_container', true);
    if (error) throw error;
    const containerKitIds = new Set<string>((kits ?? []).map((k: { id: string }) => k.id));
    if (excludeKitId) containerKitIds.delete(excludeKitId);
    if (containerKitIds.size === 0) return { all: new Map(), active: new Map() };
    const ids = [...containerKitIds];

    const [components, unitCache, itemCache] = await Promise.all([
      (supabase.from('kit_components') as any).select('kit_id, child_kit_id').in('kit_id', ids).not('child_kit_id', 'is', null),
      (supabase.from('kit_flattened_cache') as any).select('kit_id, asset_id, total_quantity').in('kit_id', ids),
      (supabase.from('kit_flattened_item_cache') as any).select('kit_id, equipment_item_id, total_quantity').in('kit_id', ids),
    ]);
    for (const r of [components, unitCache, itemCache]) if (r.error) throw r.error;

    const nestedContainerIds = new Set<string>(
      (components.data ?? [])
        .map((c: { child_kit_id: string }) => c.child_kit_id)
        .filter((id: string) => containerKitIds.has(id)),
    );
    const maps = recordItemMaps(items);
    const count = (assetItem: ReadonlyMap<string, string>) => containerPiecesByItem({
      containerKitIds, nestedContainerIds, assetItem,
      unitCache: unitCache.data ?? [],
      itemCache: itemCache.data ?? [],
    });
    return { all: count(maps.all), active: count(maps.available) };
  } catch (err) {
    return handleApiError(err, 'count equipment in containers');
  }
}

export interface ItemKitLine {
  id: string;
  quantity: number;
  asset_id: string | null;
  equipment_item_id: string | null;
  kit: { id: string; name: string; tag_number: string | null; is_container: boolean } | null;
}

/**
 * The kit lines that use an item: "N × any" of it, or one of its specific
 * units or lots (`recordIds`).
 */
export async function getItemKitLines(itemId: string, recordIds: readonly string[]): Promise<ItemKitLine[]> {
  const filter = recordIds.length
    ? `equipment_item_id.eq.${itemId},asset_id.in.(${recordIds.join(',')})`
    : `equipment_item_id.eq.${itemId}`;
  return listRecords<ItemKitLine>('kit_components', {
    select: 'id, quantity, asset_id, equipment_item_id, kit:kits!kit_assets_kit_id_fkey(id, name, tag_number, is_container)',
    or: filter,
    context: 'fetch the kits that use this item',
  });
}
