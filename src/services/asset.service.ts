import { handleApiError } from '../utils/api-error-utils';
import { getCurrentUser, getSupabase } from './base/dataAccess';
import { computeFieldChanges } from '../utils/fieldChanges';
import { sanitizeLikeInput } from '../utils/validation-utils';
import type { DbAsset, DbInventoryTracking, ActivityLogEntry } from '../utils/supabase/types';
import { getEntityActivity } from './activityLog.service';
import { writeActivity, actorNameOf } from './writeActivity';

const ASSET_TRACKED_FIELDS = [
  'manufacturer_model', 'serial_number', 'category', 'type',
  'description', 'vendor', 'item_price', 'item_cost', 'replacement_value',
  'acquisition_date', 'retired_on', 'tag_number',
] as const;

/**
 * Fetch assets for an organization
 */
export async function getAssets(organizationId: string, filters?: {
  category?: string;
  insurance_added?: boolean;
  purchase_id?: string;
  search?: string;
}) {
  const supabase = getSupabase();
  try {
    let query = (supabase.from('assets') as any)
      .select('*')
      .eq('organization_id', organizationId)
      .order('manufacturer_model');

    if (filters?.category) {
      query = query.eq('category', filters.category);
    }

    if (filters?.insurance_added !== undefined) {
      query = query.eq('insurance_policy_added', filters.insurance_added);
    }

    if (filters?.purchase_id) {
      query = query.eq('purchase_id', filters.purchase_id);
    }

    if (filters?.search) {
      const s = sanitizeLikeInput(filters.search);
      query = query.or(`manufacturer_model.ilike.%${s}%,serial_number.ilike.%${s}%,description.ilike.%${s}%`);
    }

    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  } catch (err) {
    return handleApiError(err, 'fetch assets');
  }
}

/**
 * Get distinct values for a field in assets
 */
export async function getDistinctAssetValues(
  organizationId: string,
  field: 'category' | 'type' | 'vendor',
  filterByCategory?: string
): Promise<string[]> {
  const supabase = getSupabase();
  try {
    let query = (supabase.from('assets') as any)
      .select(field)
      .eq('organization_id', organizationId)
      .not(field, 'is', null);

    // Types are suggested per category ("Cable, XLR" only under Audio).
    if (filterByCategory && field === 'type') {
      query = query.eq('category', filterByCategory);
    }

    const { data, error } = await query;
    if (error) throw error;

    const uniqueValues: string[] = (Array.from(
      new Set(
        (data || [])
          .map((item: any) => item[field] as string)
          .filter((value: string) => !!value && value.trim() !== '')
      )
    ) as string[]).sort();

    return uniqueValues;
  } catch (err) {
    return handleApiError(err, `fetch distinct ${field} values`);
  }
}

/**
 * Fetch a single asset
 */
export async function getAsset(assetId: string) {
  const supabase = getSupabase();
  try {
    const { data, error } = await (supabase.from('assets') as any)
      .select('*')
      .eq('id', assetId)
      .single();

    if (error) throw error;
    return data as Record<string, any>;
  } catch (err) {
    return handleApiError(err, 'fetch asset');
  }
}

/**
 * Whether an equipment record is depreciated (#125): its purchase line has tax
 * treatment depreciate. Returns that line's date (or its invoice's), or null.
 * Null too when the user can't read purchases. The line is the record's own
 * (`purchase_line_id`, #183), or one that still names it in `asset_id`.
 */
export async function getAssetDepreciatedDate(assetId: string): Promise<string | null> {
  const supabase = getSupabase();
  try {
    const { data: asset } = await (supabase.from('assets') as any)
      .select('purchase_line_id')
      .eq('id', assetId)
      .maybeSingle();
    const lineId: string | null = asset?.purchase_line_id ?? null;
    const { data, error } = await (supabase.from('purchases') as any)
      .select('purchase_date, parent:parent_id(purchase_date)')
      .or(lineId ? `id.eq.${lineId},asset_id.eq.${assetId}` : `asset_id.eq.${assetId}`)
      .eq('tax_treatment', 'depreciate')
      .limit(1);
    if (error) throw error;
    const row = (data ?? [])[0];
    return row ? (row.purchase_date ?? row.parent?.purchase_date ?? '1900-01-01') : null;
  } catch (err) {
    console.error('Error checking depreciation:', err);
    return null;
  }
}

/**
 * Fetch change history for an asset from the unified activity_log
 */
export async function getAssetHistory(assetId: string): Promise<ActivityLogEntry[]> {
  return getEntityActivity('asset', assetId);
}

/**
 * @deprecated use getAssetHistory instead
 */
export const getAssetStatusHistory = getAssetHistory;

/**
 * Fetch inventory tracking records for an asset, with scanner name and gig/kit info joined
 */
export async function getAssetInventoryTracking(assetId: string): Promise<DbInventoryTracking[]> {
  const supabase = getSupabase();
  try {
    const { data, error } = await (supabase.from('inventory_tracking') as any)
      .select('*, gig:gig_id(title), kit:kit_id(name)')
      .eq('asset_id', assetId)
      .order('scanned_at', { ascending: false });

    if (error) throw error;

    const rows = data || [];
    const scannerIds = Array.from(new Set(rows.map((r: any) => r.scanned_by).filter(Boolean)));

    let userMap = new Map<string, { first_name: string; last_name: string }>();
    if (scannerIds.length > 0) {
      const { data: users } = await (supabase.from('users') as any)
        .select('id, first_name, last_name')
        .in('id', scannerIds);
      userMap = new Map((users || []).map((u: any) => [u.id, u]));
    }

    return rows.map((r: any) => ({
      ...r,
      scanned_by_user: r.scanned_by ? (userMap.get(r.scanned_by) ?? null) : null,
    })) as DbInventoryTracking[];
  } catch (err) {
    return handleApiError(err, 'fetch asset inventory tracking');
  }
}

/**
 * Create a new asset
 */
/**
 * Several units (or a lot) saved together (#183): one insert, so they all save or
 * none do. Each gets a "created" entry in its history. Returns the saved records.
 */
export async function createAssets(rows: Partial<DbAsset>[]): Promise<DbAsset[]> {
  if (rows.length === 0) return [];
  try {
    const user = await getCurrentUser();
    const supabase = getSupabase();
    const { data, error } = await (supabase.from('assets') as any)
      .insert(rows.map((r) => ({ ...r, created_by: user.id, updated_by: user.id })))
      .select();
    if (error) throw error;
    const saved = (data ?? []) as DbAsset[];

    try {
      const actorDisplayName = actorNameOf(user);
      const { data: orgRow } = await (supabase.from('organizations') as any).select('name').eq('id', saved[0]?.organization_id).single();
      for (const a of saved) {
        await writeActivity({
          organization_id: a.organization_id,
          event_type: 'asset.created',
          entity_type: 'asset',
          entity_id: a.id,
          gig_id: null,
          actor_display_name: actorDisplayName,
          actor_org_name: (orgRow as any)?.name ?? '',
          context: { asset_model: a.manufacturer_model ?? '', category: a.category ?? '' },
        });
      }
    } catch (e) {
      console.error('Activity log failed:', e);
    }
    return saved;
  } catch (err) {
    return handleApiError(err, 'create equipment');
  }
}

export async function createAsset(assetData: Partial<DbAsset> & { cost?: number }) {
  try {
    const user = await getCurrentUser();
    const supabase = getSupabase();

    // Handle legacy 'cost' field mapping
    const finalData = { ...assetData };
    if (finalData.cost !== undefined && finalData.item_cost === undefined) {
      finalData.item_cost = finalData.cost;
      delete finalData.cost;
    }

    const { data, error } = await (supabase.from('assets') as any)
      .insert({
        ...finalData,
        created_by: user.id,
        updated_by: user.id,
      })
      .select()
      .single();

    if (error) throw error;

    try {
      const actorDisplayName = actorNameOf(user);
      const { data: orgRow } = await (supabase.from('organizations') as any).select('name').eq('id', data.organization_id).single();
      const actorOrgName = (orgRow as any)?.name ?? '';

      await writeActivity({
        organization_id: data.organization_id,
        event_type: 'asset.created',
        entity_type: 'asset',
        entity_id: data.id,
        gig_id: null,
        actor_display_name: actorDisplayName,
        actor_org_name: actorOrgName,
        context: { asset_model: data.manufacturer_model ?? '', category: data.category ?? '' },
      });
    } catch (e) {
      console.error('Activity log failed:', e);
    }

    return data;
  } catch (err) {
    return handleApiError(err, 'create asset');
  }
}

/**
 * Update an existing asset
 */
export async function updateAsset(assetId: string, assetData: Partial<DbAsset> & { cost?: number }) {
  try {
    const user = await getCurrentUser();
    const supabase = getSupabase();

    // 1. Pre-fetch for diffing and actor info
    const { data: assetRow } = await (supabase.from('assets') as any)
      .select('*, organization:organizations(name)')
      .eq('id', assetId)
      .single();
    
    if (!assetRow) throw new Error('Asset not found');

    const actorDisplayName = actorNameOf(user);
    const actorOrgName = (assetRow as any).organization?.name ?? '';
    const organizationId = assetRow.organization_id;

    // Only a real change: status changes take Staff or above, other edits don't (#185 PR 2).
    if (assetData.status && assetData.status !== assetRow.status) {
      const { error: rpcError } = await supabase.rpc('update_asset_status', {
        p_asset_id: assetId,
        p_status: assetData.status
      });
      if (rpcError) throw rpcError;
      if (assetRow.status !== assetData.status) {
        try {
          await writeActivity({
            organization_id: organizationId,
            event_type: 'asset.status_changed',
            entity_type: 'asset',
            entity_id: assetId,
            gig_id: null,
            actor_display_name: actorDisplayName,
            actor_org_name: actorOrgName,
            context: { asset_model: assetRow.manufacturer_model ?? '', category: assetRow.category ?? '', from_status: assetRow.status, to_status: assetData.status },
          });
        } catch (e) { console.error('Activity log failed:', e); }
      }
    }

    // Handle legacy 'cost' field mapping
    const finalData = { ...assetData };
    if (finalData.cost !== undefined && finalData.item_cost === undefined) {
      finalData.item_cost = finalData.cost;
      delete finalData.cost;
    }

    // If there are other fields to update besides status
    const updatePayload = { ...finalData };
    delete updatePayload.status; // Already handled by RPC if present

    if (Object.keys(updatePayload).length > 0) {
      const { data, error } = await (supabase.from('assets') as any)
        .update({
          ...updatePayload,
          updated_by: user.id,
          updated_at: new Date().toISOString(),
        })
        .eq('id', assetId)
        .select()
        .single();

      if (error) throw error;

      // What the save changed: the record as saved before vs as saved now (#20).
      const field_changes = computeFieldChanges(assetRow, data ?? {}, ASSET_TRACKED_FIELDS);
      if (field_changes.length > 0) {
        try {
          await writeActivity({
            organization_id: organizationId,
            event_type: 'asset.updated',
            entity_type: 'asset',
            entity_id: assetId,
            gig_id: null,
            actor_display_name: actorDisplayName,
            actor_org_name: actorOrgName,
            context: { asset_model: assetRow.manufacturer_model ?? '', category: assetRow.category ?? '', field_changes },
          });
        } catch (e) { console.error('Activity log failed:', e); }
      }

      return data;
    }

    // If only status was updated, fetch the latest asset to return
    return getAsset(assetId);
  } catch (err) {
    return handleApiError(err, 'update asset');
  }
}

/**
 * Delete an asset
 */
export async function deleteAsset(assetId: string) {
  const supabase = getSupabase();
  try {
    // .select() to confirm a row was removed — RLS denies silently (0 rows, no error)
    const { data, error } = await (supabase.from('assets') as any).delete().eq('id', assetId).select();
    if (error) throw error;
    if (!data || data.length === 0) {
      throw new Error('Asset not found, or you do not have permission to delete it.');
    }
    return { success: true };
  } catch (err) {
    return handleApiError(err, 'delete asset');
  }
}

/**
 * Duplicate an existing asset
 */
export async function duplicateAsset(assetId: string) {
  try {
    const user = await getCurrentUser();
    const supabase = getSupabase();

    const original = await getAsset(assetId);
    if (!original) throw new Error('Original asset not found');

    const {
      id,
      created_at,
      updated_at,
      created_by,
      updated_by,
      // The copy wasn't on the original's invoice (#131).
      purchase_id: _purchaseId,
      purchase_line_id: _purchaseLineId,
      // Nor depreciated, so it has no recovery period (#125).
      recovery_period: _recoveryPeriod,
      // Nor in maintenance or flagged for it: that's the original's (#186).
      maintenance_notes: _maintenanceNotes,
      maintenance_location: _maintenanceLocation,
      maintenance_expected_back: _maintenanceExpectedBack,
      maintenance_since: _maintenanceSince,
      maintenance_by: _maintenanceBy,
      maintenance_from: _maintenanceFrom,
      status_before_maintenance: _statusBeforeMaintenance,
      maintenance_pending: _maintenancePending,
      maintenance_pending_gig_id: _maintenancePendingGigId,
      maintenance_pending_quantity: _maintenancePendingQuantity,
      ...assetData
    } = original as any;

    const { data, error } = await (supabase.from('assets') as any)
      .insert({
        ...assetData,
        manufacturer_model: `${original.manufacturer_model} (Copy)`,
        created_by: user.id,
        updated_by: user.id,
      })
      .select()
      .single();

    if (error) throw error;

    try {
      const actorDisplayName = actorNameOf(user);
      const { data: orgRow } = await (supabase.from('organizations') as any).select('name').eq('id', data.organization_id).single();
      const actorOrgName = (orgRow as any)?.name ?? '';

      await writeActivity({
        organization_id: data.organization_id,
        event_type: 'asset.created',
        entity_type: 'asset',
        entity_id: data.id,
        gig_id: null,
        actor_display_name: actorDisplayName,
        actor_org_name: actorOrgName,
        context: { asset_model: data.manufacturer_model ?? '', category: data.category ?? '' },
      });
    } catch (e) {
      console.error('Activity log failed:', e);
    }

    return data;
  } catch (err) {
    return handleApiError(err, 'duplicate asset');
  }
}
