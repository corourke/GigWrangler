import { useState, useEffect, useCallback } from 'react';
import { ChevronDown, ChevronRight, AlertTriangle, Package, Barcode } from 'lucide-react';
import { format } from 'date-fns';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../ui/collapsible';
import { Progress } from '../ui/progress';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip';
import { TrackingStatusBadge } from './TrackingStatusBadge';
import { ManualTrackingOverrideDialog } from './ManualTrackingOverrideDialog';
import {
  getActiveGigsWithTracking,
  getInventoryConflictFlags,
} from '../../services/inventoryManagement.service';
import type { GigWithTracking, KitAssignmentWithTracking } from '../../services/inventoryManagement.service';
import type { UserRole } from '../../utils/supabase/types';
import { plural } from '../../utils/plural';

interface InventorySummaryDashboardProps {
  /** Opens the scanning panel for a gig (Equipment › Out on gigs). */
  onTrack?: (gigId: string) => void;
  organizationId: string;
  userId: string;
  userRole?: UserRole;
}

function formatScannedAt(isoString: string): string {
  try {
    return format(new Date(isoString), 'MMM d, h:mm a');
  } catch {
    return isoString;
  }
}

function getKitProgress(assignment: KitAssignmentWithTracking): {
  total: number;
  scanned: number;
  latestStatus: string | null;
  latestLocation: string | null;
  latestScannedAt: string | null;
  scannedByName: string | null;
} {
  const { kit, tracking_records } = assignment;
  const isContainer = kit.is_container;

  if (isContainer) {
    const record = tracking_records.find((r) => !r.asset_id) ?? tracking_records[0];
    const rawRecord = record as any;
    const scannedBy = rawRecord?.scanned_by_user;
    const name = scannedBy
      ? [scannedBy.first_name, scannedBy.last_name].filter(Boolean).join(' ') || scannedBy.email || null
      : null;
    return {
      total: 1,
      scanned: record ? 1 : 0,
      latestStatus: record?.status ?? null,
      latestLocation: record?.location ?? null,
      latestScannedAt: record?.scanned_at ?? null,
      scannedByName: name,
    };
  }

  const total = kit.assets.length;
  const assetIds = new Set(kit.assets.map((a) => a.asset_id));
  const latestByAsset = new Map<string, (typeof tracking_records)[number]>();
  for (const record of tracking_records) {
    if (record.asset_id && assetIds.has(record.asset_id)) {
      const existing = latestByAsset.get(record.asset_id);
      if (!existing || new Date(record.scanned_at) > new Date(existing.scanned_at)) {
        latestByAsset.set(record.asset_id, record);
      }
    }
  }

  const scannedRecords = Array.from(latestByAsset.values());
  const latest = scannedRecords.sort(
    (a, b) => new Date(b.scanned_at).getTime() - new Date(a.scanned_at).getTime()
  )[0];

  const rawLatest = latest as any;
  const scannedBy = rawLatest?.scanned_by_user;
  const name = scannedBy
    ? [scannedBy.first_name, scannedBy.last_name].filter(Boolean).join(' ') || scannedBy.email || null
    : null;

  return {
    total,
    scanned: scannedRecords.length,
    latestStatus: latest?.status ?? null,
    latestLocation: latest?.location ?? null,
    latestScannedAt: latest?.scanned_at ?? null,
    scannedByName: name,
  };
}

function getGigProgress(gig: GigWithTracking): { total: number; onSite: number } {
  let total = 0;
  let onSite = 0;
  for (const assignment of gig.kit_assignments) {
    const { total: t, scanned, latestStatus } = getKitProgress(assignment);
    total += t;
    if (scanned > 0 && latestStatus) onSite += scanned;
  }
  return { total, onSite };
}

interface OverrideTarget {
  gigId: string;
  kitId: string;
  assetId?: string;
  isContainerKit?: boolean;
  assetIds?: string[];
}

interface KitRowProps {
  assignment: KitAssignmentWithTracking;
  gigId: string;
  conflictKitIds: Set<string>;
  canOverride: boolean;
  onOverride: (target: OverrideTarget) => void;
}

function KitRow({ assignment, gigId, conflictKitIds, canOverride, onOverride }: KitRowProps) {
  const { kit } = assignment;
  const progress = getKitProgress(assignment);
  const hasConflict = conflictKitIds.has(kit.id);
  const [expanded, setExpanded] = useState(false);
  const canExpand = !kit.is_container && kit.assets.length > 0;

  const handleOverride = () => {
    onOverride({
      gigId,
      kitId: kit.id,
      isContainerKit: kit.is_container,
      assetIds: kit.is_container ? undefined : kit.assets.map((a) => a.asset_id),
    });
  };

  const trackingByAsset = new Map(
    assignment.tracking_records
      .filter((r) => r.asset_id)
      .map((r) => [r.asset_id!, r])
  );

  return (
    <div className="border-b last:border-b-0 bg-white">
      <div className="flex items-start justify-between gap-3 py-2.5 px-4">
        <div className="flex flex-col gap-1 min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            {canExpand && (
              <button
                onClick={() => setExpanded((e) => !e)}
                className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
                aria-label={expanded ? 'Collapse kit' : 'Expand kit'}
              >
                {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
              </button>
            )}
            <span className="text-sm font-medium truncate">{kit.name}</span>
            <Tooltip>
              <TooltipTrigger asChild>
                <Badge
                  variant="outline"
                  className={`text-[10px] py-0 h-4 px-1.5 font-normal border shrink-0 cursor-help ${
                    kit.is_container
                      ? 'border-slate-200 bg-slate-50 text-slate-600'
                      : 'border-indigo-200 bg-indigo-50 text-indigo-700'
                  }`}
                >
                  {kit.is_container ? 'Container' : 'Items'}
                </Badge>
              </TooltipTrigger>
              <TooltipContent>
                {kit.is_container
                  ? 'Container kit: tracked as a single physical unit'
                  : 'Items kit: each asset inside is tracked individually'}
              </TooltipContent>
            </Tooltip>
            {hasConflict && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex items-center gap-1 text-[10px] font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5 cursor-default shrink-0">
                    <AlertTriangle className="h-3 w-3" />
                    Conflict
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  This kit is assigned to overlapping gigs
                </TooltipContent>
              </Tooltip>
            )}
          </div>
          <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap pl-5">
            {kit.is_container ? (
              progress.latestStatus ? (
                <TrackingStatusBadge status={progress.latestStatus} />
              ) : (
                <span className="text-muted-foreground">Not tracked</span>
              )
            ) : (
              <span>
                {progress.scanned}/{plural(progress.total, 'item')} scanned
                {progress.latestStatus ? ` — ${progress.latestStatus}` : ''}
              </span>
            )}
            {progress.latestLocation && <span>@ {progress.latestLocation}</span>}
            {progress.latestScannedAt && (
              <span>{formatScannedAt(progress.latestScannedAt)}</span>
            )}
            {progress.scannedByName && <span>by {progress.scannedByName}</span>}
          </div>
        </div>
        {canOverride && (
          <Button variant="outline" size="sm" className="shrink-0 text-xs h-7" onClick={handleOverride}>
            Override
          </Button>
        )}
      </div>

      {expanded && canExpand && (
        <div className="bg-muted/20 border-t px-6 py-2 flex flex-col divide-y divide-border/50">
          {kit.assets.map((a) => {
            const record = trackingByAsset.get(a.asset_id);
            return (
              <div key={a.asset_id} className="flex items-center gap-3 py-1.5 text-xs">
                <Package className="h-3 w-3 text-muted-foreground/50 shrink-0" />
                <span className="flex-1 min-w-0 truncate text-muted-foreground">
                  {a.asset.manufacturer_model ?? 'Unnamed Asset'}
                </span>
                {a.asset.tag_number && (
                  <span className="font-mono text-muted-foreground/60 shrink-0">{a.asset.tag_number}</span>
                )}
                {record ? (
                  <TrackingStatusBadge status={record.status} />
                ) : (
                  <span className="text-muted-foreground/50 shrink-0">Not scanned</span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

interface GigRowProps {
  gig: GigWithTracking;
  conflictKitIds: Set<string>;
  canOverride: boolean;
  onOverride: (target: OverrideTarget) => void;
  onTrack?: (gigId: string) => void;
}

function GigRow({ gig, conflictKitIds, canOverride, onOverride, onTrack }: GigRowProps) {
  const [open, setOpen] = useState(false);
  const { total, onSite } = getGigProgress(gig);
  const progressPercent = total > 0 ? Math.round((onSite / total) * 100) : 0;

  const hasConflict = gig.kit_assignments.some((a) => conflictKitIds.has(a.kit_id));

  const dateLabel = (() => {
    try {
      const start = format(new Date(gig.start), 'MMM d');
      const end = format(new Date(gig.end), 'MMM d, yyyy');
      return `${start} – ${end}`;
    } catch {
      return '';
    }
  })();

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      {/* The row expands on click; Track sits beside it, not inside the expand button. */}
      <div className="flex items-center bg-gray-50">
      <CollapsibleTrigger asChild>
        <button
          className="w-full flex items-center gap-3 px-4 py-3 bg-gray-50 hover:bg-gray-100 transition-colors text-left"
          aria-expanded={open}
        >
          <span className="shrink-0 text-gray-400">
            {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </span>
          <div className="flex flex-col gap-1 min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-medium text-sm truncate">{gig.title}</span>
              {hasConflict && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="inline-flex items-center gap-1 text-[10px] font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5 cursor-default shrink-0">
                      <AlertTriangle className="h-3 w-3" />
                      Kit Conflict
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>
                    One or more kits in this gig are assigned to overlapping gigs
                  </TooltipContent>
                </Tooltip>
              )}
            </div>
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              {dateLabel && <span>{dateLabel}</span>}
              <span>{gig.kit_assignments.length} kit{gig.kit_assignments.length !== 1 ? 's' : ''}</span>
            </div>
            <div className="flex items-center gap-2 mt-0.5">
              <Progress value={progressPercent} className="h-1.5 flex-1 max-w-48" />
              <span className="text-xs text-muted-foreground shrink-0">
                {onSite}/{plural(total, 'item')} tracked
              </span>
            </div>
          </div>
        </button>
      </CollapsibleTrigger>
      {onTrack && (
        <Button
          variant="outline"
          size="sm"
          className="mr-4 shrink-0"
          aria-label={`Track ${gig.title}`}
          onClick={() => onTrack(gig.id)}
        >
          <Barcode className="w-4 h-4 mr-1.5" />
          Track
        </Button>
      )}
      </div>
      <CollapsibleContent>
        <div className="divide-y divide-border border-t">
          {gig.kit_assignments.length === 0 ? (
            <p className="text-sm text-muted-foreground px-4 py-3">No kits assigned</p>
          ) : (
            gig.kit_assignments.map((assignment) => (
              <KitRow
                key={assignment.kit_id}
                assignment={assignment}
                gigId={gig.id}
                conflictKitIds={conflictKitIds}
                canOverride={canOverride}
                onOverride={onOverride}
              />
            ))
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

export function InventorySummaryDashboard({
  organizationId,
  userId,
  userRole,
  onTrack,
}: InventorySummaryDashboardProps) {
  const [gigs, setGigs] = useState<GigWithTracking[]>([]);
  const [conflictKitIds, setConflictKitIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [overrideTarget, setOverrideTarget] = useState<OverrideTarget | null>(null);

  const canOverride = userRole === 'Admin' || userRole === 'Manager';

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [gigsData, conflicts] = await Promise.all([
        getActiveGigsWithTracking(organizationId),
        getInventoryConflictFlags(organizationId),
      ]);
      setGigs(gigsData);
      setConflictKitIds(conflicts);
    } catch {
      setGigs([]);
      setConflictKitIds(new Set());
    } finally {
      setLoading(false);
    }
  }, [organizationId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <span className="text-sm text-muted-foreground">Loading inventory...</span>
      </div>
    );
  }

  if (gigs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 gap-2">
        <span className="text-sm text-muted-foreground">No active gigs with kit assignments found.</span>
      </div>
    );
  }

  return (
    <>
      <div className="rounded-md border divide-y divide-border overflow-hidden">
        {gigs.map((gig) => (
          <GigRow
            key={gig.id}
            onTrack={onTrack}
            gig={gig}
            conflictKitIds={conflictKitIds}
            canOverride={canOverride}
            onOverride={setOverrideTarget}
          />
        ))}
      </div>
      {overrideTarget && (
        <ManualTrackingOverrideDialog
          open={true}
          onOpenChange={(open) => { if (!open) setOverrideTarget(null); }}
          organizationId={organizationId}
          gigId={overrideTarget.gigId}
          kitId={overrideTarget.kitId}
          assetId={overrideTarget.assetId}
          isContainerKit={overrideTarget.isContainerKit}
          assetIds={overrideTarget.assetIds}
          userId={userId}
          userRole={userRole}
          onSuccess={loadData}
        />
      )}
    </>
  );
}
