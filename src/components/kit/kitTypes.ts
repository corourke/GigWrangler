import type { DbAsset } from '../../utils/supabase/types';
import type { ItemRecord } from '../../utils/equipmentItems';

/** An equipment item with its records, for "any" lines and availability (#184). */
export interface KitItem {
  id: string;
  manufacturer_model: string;
  category: string | null;
  type?: string | null;
  records: (ItemRecord & Partial<DbAsset>)[];
}

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
export interface KitComponentRow {
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
export type PickerCandidate =
  | { type: 'item'; id: string; name: string; subtitle: string; item: KitItem; owned: number; available: number; excludedReason: string | null }
  | { type: 'asset'; id: string; name: string; subtitle: string; asset: DbAsset; quantityAvailable: number | null; excludedReason: string | null }
  | { type: 'kit'; id: string; name: string; subtitle: string; componentCount: number; wouldCycle: boolean; excludedReason: string | null };

export type PickerFilter = 'all' | 'items' | 'units' | 'kits';

/** How a status reads when it makes a unit unavailable. */
export const STATUS_LABEL: Record<string, string> = { Maintenance: 'In maintenance', Inactive: 'Inactive' };
