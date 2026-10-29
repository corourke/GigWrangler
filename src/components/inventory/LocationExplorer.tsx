import { Fragment, useState, useEffect, useCallback, useMemo } from 'react';
import { format } from 'date-fns';
import { MapPin, Filter, ChevronRight, ChevronDown, Layers, Package, Pencil } from 'lucide-react';
import { LocationCombobox } from './LocationCombobox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../ui/table';
import { Label } from '../ui/label';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { cn } from '../ui/utils';
import {
  getItemsByLocation,
  getActiveGigsWithTracking,
  getItemWhereabouts,
} from '../../services/inventoryManagement.service';
import type { LocationItem, GigWithTracking, ItemWhereabout } from '../../services/inventoryManagement.service';
import { getItems } from '../../services/equipmentItem.service';
import type { EquipmentItemWithRecords } from '../../services/equipmentItem.service';
import { ManualTrackingOverrideDialog } from './ManualTrackingOverrideDialog';
import { whereCardText } from '../../utils/whereaboutText';
import { RETURNED_STATUS, SCANNING_MODES } from '../../config/inventoryWorkflow';
import { TRACKING_STATUS_CONFIG } from '../../utils/supabase/constants';
import type { UserRole } from '../../utils/supabase/types';
import { LineExtras, piecesOf } from './LineExtras';

interface LocationExplorerProps {
  organizationId: string;
  userId?: string;
  userRole?: UserRole;
}

interface OverrideTarget {
  gigId: string;
  gigTitle: string;
  kitId: string;
  assetId?: string;
  isContainerKit?: boolean;
  /** Whole-kit override of a logical kit: its own row and the units listed under it. */
  assetIds?: string[];
  keepKitRow?: boolean;
  label: string;
  /** Part of a lot at this place (#186): move N of its pieces. */
  lot?: ReturnType<typeof lotOf>;
  /** #186 step 4: a unit at home (sent with no gig), and the record's maintenance. */
  atHome?: boolean;
  maintenance?: { state: 'in' | 'flagged'; location?: string | null } | null;
}

/** A unit or lot line's maintenance details for the override (#186 step 4). */
const maintenanceOf = (item: LocationItem) => ({
  atHome: item.status === RETURNED_STATUS,
  maintenance: item.maintenance ? { state: item.maintenance, location: item.maintenance_location ?? null } : null,
});

/** A lot line's override details (#186); none for a unit. A lot in a case says where the case is. */
const lotOf = (item: LocationItem) => (item.lot_of != null
  ? { here: piecesOf(item), of: item.lot_of, status: item.status, location: item.location ?? null,
    place: [item.gig_title, item.location].filter(Boolean).length === 2 ? `${item.gig_title} (${item.location})` : item.gig_title ?? item.location ?? 'this place',
    inCase: item.is_container && item.case_gig_id
      ? { name: item.kit_name ?? 'the case', gigId: item.case_gig_id, gigTitle: item.case_gig_title ?? 'its gig' }
      : null }
  : undefined);

/** One kit's items within a single (status, location) bucket — the kit's own
 * whole-kit scan record (if any) kept separate from its individual assets,
 * so the two can be rendered as a parent row and indented children. */
interface KitGroup {
  kitId: string;
  kitName: string;
  isContainer: boolean;
  kitLevelItem?: LocationItem;
  assetItems: LocationItem[];
}

const UNIQUE_STATUSES = Array.from(new Set(SCANNING_MODES.map(m => m.resultingStatus)));

function formatLastScanned(isoString: string): string {
  try {
    return format(new Date(isoString), 'MMM d, h:mm a');
  } catch {
    return isoString;
  }
}


/** A line's name, with "2 of 10" for part of a lot (#186). */
function lineName(item: LocationItem) {
  return (
    <span className="inline-flex items-center gap-2">
      {item.asset_name ?? '—'}
      <LineExtras item={item} />
    </span>
  );
}

function groupByKit(items: LocationItem[]): KitGroup[] {
  const map = new Map<string, KitGroup>();
  for (const item of items) {
    let group = map.get(item.kit_id);
    if (!group) {
      group = { kitId: item.kit_id, kitName: item.kit_name ?? 'Unknown Kit', isContainer: item.is_container, assetItems: [] };
      map.set(item.kit_id, group);
    }
    if (item.asset_id) {
      group.assetItems.push(item);
    } else {
      group.kitLevelItem = item;
    }
  }
  return Array.from(map.values());
}

export function LocationExplorer({ organizationId, userId, userRole }: LocationExplorerProps) {
  const [locationFilter, setLocationFilter] = useState('');
  const [selectedStatuses, setSelectedStatuses] = useState<string[]>(UNIQUE_STATUSES);
  const [gigFilter, setGigFilter] = useState('all');
  const [itemFilter, setItemFilter] = useState('all');
  const [equipmentItems, setEquipmentItems] = useState<EquipmentItemWithRecords[]>([]);
  const [places, setPlaces] = useState<ItemWhereabout[] | null>(null);
  const [items, setItems] = useState<LocationItem[]>([]);
  const [gigs, setGigs] = useState<GigWithTracking[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [expandedContainers, setExpandedContainers] = useState<Set<string>>(new Set());
  const [overrideTarget, setOverrideTarget] = useState<OverrideTarget | null>(null);

  const canOverride = !!userId && (userRole === 'Admin' || userRole === 'Manager');

  useEffect(() => {
    getActiveGigsWithTracking(organizationId)
      .then(setGigs)
      .catch(() => setGigs([]));
  }, [organizationId]);

  // The org's items, for the Item filter (#186).
  useEffect(() => {
    getItems(organizationId)
      .then((list) => setEquipmentItems([...list].sort((a, b) => (a.manufacturer_model ?? '').localeCompare(b.manufacturer_model ?? ''))))
      .catch(() => setEquipmentItems([]));
  }, [organizationId]);

  const selectedItem = useMemo(() => equipmentItems.find((i) => i.id === itemFilter) ?? null, [equipmentItems, itemFilter]);

  // Where all of the chosen item is, home pieces included (#186).
  useEffect(() => {
    if (!selectedItem) { setPlaces(null); return; }
    let live = true;
    getItemWhereabouts(organizationId, selectedItem.records)
      .then((p) => { if (live) setPlaces(p); })
      .catch(() => { if (live) setPlaces(null); });
    return () => { live = false; };
  }, [organizationId, selectedItem]);

  const toggleStatus = (status: string) => {
    setSelectedStatuses(prev =>
      prev.includes(status)
        ? prev.filter(s => s !== status)
        : [...prev, status]
    );
  };

  const toggleExpanded = (key: string) => {
    setExpandedContainers((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const hasFilters = !!(locationFilter || selectedStatuses.length > 0 || gigFilter !== 'all' || itemFilter !== 'all');

  const fetchItems = useCallback(async () => {
    if (!locationFilter && selectedStatuses.length === 0 && gigFilter === 'all' && itemFilter === 'all') {
      setItems([]);
      setHasSearched(false);
      return;
    }
    setLoading(true);
    setHasSearched(true);
    try {
      const results = await getItemsByLocation(organizationId, {
        location: locationFilter || undefined,
        status: selectedStatuses.length > 0 ? selectedStatuses : undefined,
        gigId: gigFilter !== 'all' ? gigFilter : undefined,
        itemId: itemFilter !== 'all' ? itemFilter : undefined,
      });
      setItems(results);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [organizationId, locationFilter, selectedStatuses, gigFilter, itemFilter]);

  useEffect(() => {
    fetchItems();
  }, [fetchItems]);

  const groupedItems = useMemo(() => {
    const groups: Record<string, Record<string, LocationItem[]>> = {};

    for (const item of items) {
      const status = item.status;
      const location = item.location || 'Unknown Location';

      if (!groups[status]) groups[status] = {};
      if (!groups[status][location]) groups[status][location] = [];

      groups[status][location].push(item);
    }

    return groups;
  }, [items]);

  const gigOptions = useMemo(() => gigs.map((g) => ({ id: g.id, title: g.title })), [gigs]);

  return (
    <div className="flex flex-col gap-6">
      <div className="bg-white p-4 rounded-lg border shadow-sm flex flex-col gap-4">
        <div className="flex items-center gap-2 text-sm font-semibold text-gray-700 border-b pb-2">
          <Filter className="h-4 w-4" />
          Location Explorer Filters
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <div className="flex flex-col gap-2">
            <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Location</Label>
            <LocationCombobox
              value={locationFilter}
              onChange={setLocationFilter}
              organizationId={organizationId}
              placeholder="Filter by location..."
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Gig</Label>
            <Select value={gigFilter} onValueChange={setGigFilter}>
              <SelectTrigger aria-label="Filter by gig">
                <SelectValue placeholder="All gigs" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All gigs</SelectItem>
                {gigs.map((gig) => (
                  <SelectItem key={gig.id} value={gig.id}>
                    {gig.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-2">
            <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Item</Label>
            <Select value={itemFilter} onValueChange={setItemFilter}>
              <SelectTrigger aria-label="Filter by item">
                <SelectValue placeholder="All items" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All items</SelectItem>
                {equipmentItems.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.manufacturer_model}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-2">
            <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Status Filter</Label>
            <div className="flex flex-wrap gap-2 pt-1">
              {UNIQUE_STATUSES.map((status) => {
                const isActive = selectedStatuses.includes(status);
                const config = TRACKING_STATUS_CONFIG[status as keyof typeof TRACKING_STATUS_CONFIG];
                return (
                  <button
                    key={status}
                    onClick={() => toggleStatus(status)}
                    className={cn(
                      'text-xs font-medium px-3 py-1.5 rounded-full border transition-all',
                      isActive
                        ? config?.color ?? 'border-border bg-muted/40 text-muted-foreground'
                        : 'border-dashed border-muted-foreground/30 text-muted-foreground/50 bg-transparent hover:border-muted-foreground/50 hover:text-muted-foreground/70'
                    )}
                  >
                    {status}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {selectedItem && places && places.length > 0 && (
        <div data-testid="where-is-it" className="bg-white p-4 rounded-lg border shadow-sm text-sm">
          <span className="font-semibold">{selectedItem.manufacturer_model}:</span> {whereCardText(places)}
        </div>
      )}

      {!hasFilters && !hasSearched && (
        <div className="flex flex-col items-center justify-center py-12 gap-2 border rounded-md bg-muted/20">
          <MapPin className="h-8 w-8 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">Apply filters above to explore items by status and location.</p>
        </div>
      )}

      {hasFilters && loading && (
        <div className="flex items-center justify-center py-12" data-testid="loading-spinner">
          <span className="text-sm text-muted-foreground">Loading...</span>
        </div>
      )}

      {hasFilters && !loading && (
        <div className="flex flex-col gap-8">
          {Object.keys(groupedItems).length === 0 ? (
            <div className="text-center text-muted-foreground py-12 border rounded-md bg-muted/5">
              No items found matching the selected filters.
            </div>
          ) : (
            Object.entries(groupedItems).sort().map(([status, locations]) => (
              <div key={status} className="flex flex-col gap-4">
                <div className="flex items-center gap-3">
                  <h2 className="text-lg font-bold text-gray-900">{status}</h2>
                  <div className="h-px flex-1 bg-gray-200" />
                </div>

                {Object.entries(locations).sort().map(([location, locationItems]) => {
                  const kitGroups = groupByKit(locationItems);
                  return (
                    <div key={location} className="flex flex-col gap-2 pl-4 border-l-2 border-primary/20">
                      <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground mb-1">
                        <MapPin className="h-3.5 w-3.5" />
                        {location}
                        <span className="text-xs bg-muted px-2 py-0.5 rounded-full ml-1">
                          {locationItems.reduce((n, i) => n + piecesOf(i), 0)} pieces
                        </span>
                      </div>

                      <div className="rounded-md border bg-white overflow-hidden shadow-sm">
                        <Table>
                          <TableHeader>
                            <TableRow className="bg-muted/30">
                              <TableHead>Item</TableHead>
                              <TableHead className="w-[120px]">Tag #</TableHead>
                              <TableHead className="w-[200px]">Gig</TableHead>
                              <TableHead className="w-[160px]">Last Scanned</TableHead>
                              {canOverride && <TableHead className="w-[60px]" />}
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {kitGroups.map((group) => {
                              const expandKey = `${status}:${location}:${group.kitId}`;
                              const expanded = expandedContainers.has(expandKey);

                              if (group.isContainer) {
                                // Only the case's own row stands for the case. Contents whose newest rows sit
                                // apart from it (a case-only record moved the case) list under a "Contents"
                                // heading; none of them is promoted to stand in for the case (#255).
                                const representative = group.kitLevelItem;
                                const hiddenChildren = group.assetItems;
                                return (
                                  <Fragment key={group.kitId}>
                                    <TableRow>
                                      <TableCell className="font-medium">
                                        <div className="flex items-center gap-1.5">
                                          {hiddenChildren.length > 0 && (
                                            <button
                                              type="button"
                                              onClick={() => toggleExpanded(expandKey)}
                                              className="text-muted-foreground hover:text-foreground"
                                              aria-label={expanded ? 'Collapse container contents' : 'Expand container contents'}
                                            >
                                              {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                                            </button>
                                          )}
                                          <Layers className="h-3.5 w-3.5 text-muted-foreground" />
                                          {group.kitName}
                                          {representative
                                            ? <Badge className="text-[10px]">Container</Badge>
                                            : <Badge variant="outline" className="text-[10px]">Contents</Badge>}
                                        </div>
                                      </TableCell>
                                      <TableCell className="font-mono text-xs">—</TableCell>
                                      <TableCell className="text-sm">{representative?.gig_title ?? '—'}</TableCell>
                                      <TableCell className="text-muted-foreground text-xs">
                                        {representative ? formatLastScanned(representative.scanned_at) : '—'}
                                      </TableCell>
                                      {canOverride && (
                                        <TableCell>
                                          {representative && (
                                            <Button
                                              size="sm"
                                              variant="ghost"
                                              onClick={() => setOverrideTarget({
                                                gigId: representative.gig_id,
                                                gigTitle: representative.gig_title ?? '',
                                                kitId: group.kitId,
                                                isContainerKit: true,
                                                label: group.kitName,
                                              })}
                                            >
                                              <Pencil className="h-3.5 w-3.5" />
                                            </Button>
                                          )}
                                        </TableCell>
                                      )}
                                    </TableRow>
                                    {expanded && hiddenChildren.map((child) => (
                                      <TableRow key={`${group.kitId}-${child.asset_id}`}>
                                        <TableCell className="pl-8 text-sm text-muted-foreground">{lineName(child)}</TableCell>
                                        <TableCell className="font-mono text-xs">{child.tag_number ?? '—'}</TableCell>
                                        <TableCell className="text-sm">{child.gig_title ?? '—'}</TableCell>
                                        <TableCell className="text-muted-foreground text-xs">{formatLastScanned(child.scanned_at)}</TableCell>
                                        {canOverride && (
                                          <TableCell>
                                            <Button
                                              size="sm"
                                              variant="ghost"
                                              onClick={() => setOverrideTarget({
                                                gigId: child.gig_id,
                                                gigTitle: child.gig_title ?? '',
                                                kitId: group.kitId,
                                                assetId: child.asset_id ?? undefined,
                                                label: `${group.kitName} — ${child.asset_name ?? 'Item'}`,
                                                lot: lotOf(child),
                                                ...maintenanceOf(child),
                                              })}
                                            >
                                              <Pencil className="h-3.5 w-3.5" />
                                            </Button>
                                          </TableCell>
                                        )}
                                      </TableRow>
                                    ))}
                                  </Fragment>
                                );
                              }

                              // Non-container kit: its own header row, then every scanned asset indented beneath.
                              return (
                                <Fragment key={group.kitId}>
                                  <TableRow className="bg-muted/10">
                                    <TableCell colSpan={canOverride ? 5 : 4} className="font-medium">
                                      <div className="flex items-center gap-1.5">
                                        <Package className="h-3.5 w-3.5 text-muted-foreground" />
                                        {group.kitName}
                                        <Badge variant="outline" className="text-[10px]">Items</Badge>
                                      </div>
                                    </TableCell>
                                  </TableRow>
                                  {group.assetItems.map((child) => (
                                    <TableRow key={`${group.kitId}-${child.asset_id}`}>
                                      <TableCell className="pl-8 text-sm">{lineName(child)}</TableCell>
                                      <TableCell className="font-mono text-xs">{child.tag_number ?? '—'}</TableCell>
                                      <TableCell className="text-sm">{child.gig_title ?? '—'}</TableCell>
                                      <TableCell className="text-muted-foreground text-xs">{formatLastScanned(child.scanned_at)}</TableCell>
                                      {canOverride && (
                                        <TableCell>
                                          <Button
                                            size="sm"
                                            variant="ghost"
                                            onClick={() => setOverrideTarget({
                                              gigId: child.gig_id,
                                              gigTitle: child.gig_title ?? '',
                                              kitId: group.kitId,
                                              assetId: child.asset_id ?? undefined,
                                              label: `${group.kitName} — ${child.asset_name ?? 'Item'}`,
                                              lot: lotOf(child),
                                              ...maintenanceOf(child),
                                            })}
                                          >
                                            <Pencil className="h-3.5 w-3.5" />
                                          </Button>
                                        </TableCell>
                                      )}
                                    </TableRow>
                                  ))}
                                  {group.kitLevelItem && (
                                    <TableRow key={`${group.kitId}-whole`}>
                                      <TableCell className="pl-8 text-sm italic text-muted-foreground">Whole kit</TableCell>
                                      <TableCell className="font-mono text-xs">—</TableCell>
                                      <TableCell className="text-sm">{group.kitLevelItem.gig_title ?? '—'}</TableCell>
                                      <TableCell className="text-muted-foreground text-xs">{formatLastScanned(group.kitLevelItem.scanned_at)}</TableCell>
                                      {canOverride && (
                                        <TableCell>
                                          <Button
                                            size="sm"
                                            variant="ghost"
                                            onClick={() => setOverrideTarget({
                                              gigId: group.kitLevelItem!.gig_id,
                                              gigTitle: group.kitLevelItem!.gig_title ?? '',
                                              kitId: group.kitId,
                                              assetIds: group.assetItems.map((i) => i.asset_id!).filter(Boolean),
                                              keepKitRow: true,
                                              label: `${group.kitName} (whole kit)`,
                                            })}
                                          >
                                            <Pencil className="h-3.5 w-3.5" />
                                          </Button>
                                        </TableCell>
                                      )}
                                    </TableRow>
                                  )}
                                </Fragment>
                              );
                            })}
                          </TableBody>
                        </Table>
                      </div>
                    </div>
                  );
                })}
              </div>
            ))
          )}
        </div>
      )}

      {overrideTarget && userId && (
        <ManualTrackingOverrideDialog
          open={true}
          onOpenChange={(open) => { if (!open) setOverrideTarget(null); }}
          organizationId={organizationId}
          gigId={overrideTarget.gigId}
          // The item's own current gig might not be in the "active gigs"
          // list (e.g. a wrapped-up gig outside that window) — make sure
          // it's always a selectable (and pre-selected) option regardless.
          gigs={gigOptions.some((g) => g.id === overrideTarget.gigId)
            ? gigOptions
            : [...gigOptions, { id: overrideTarget.gigId, title: overrideTarget.gigTitle || 'Current gig' }]}
          kitId={overrideTarget.kitId}
          assetId={overrideTarget.assetId}
          isContainerKit={overrideTarget.isContainerKit}
          assetIds={overrideTarget.assetIds}
          keepKitRow={overrideTarget.keepKitRow}
          userId={userId}
          userRole={userRole}
          targetLabel={overrideTarget.label}
          lot={overrideTarget.lot}
          atHome={overrideTarget.atHome}
          maintenance={overrideTarget.maintenance}
          onSuccess={() => { setOverrideTarget(null); fetchItems(); }}
        />
      )}
    </div>
  );
}
