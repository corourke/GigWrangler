import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { format } from 'date-fns';
import { formatInTimeZone } from '../../utils/dateUtils';
import { AlertTriangle, Printer, SlidersHorizontal } from 'lucide-react';
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
import { Button } from '../ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '../ui/popover';
import { Checkbox } from '../ui/checkbox';
import { Label } from '../ui/label';
import { LocationCombobox } from './LocationCombobox';
import { TrackingStatusBadge } from './TrackingStatusBadge';
import { LineExtras } from './LineExtras';
import { piecesOf } from './piecesOf';
import { packedPieces } from '../../utils/packingSummary';
import { loadPackingColumns, savePackingColumns, type PackingColumn } from '../../utils/packingColumns';
import {
  getGigsForReportPicker,
  getManifestReport,
  getPackingListReport,
  getInventoryConflictFlags,
} from '../../services/inventoryManagement.service';
import type {
  GigOption,
  ManifestLine,
  PackingListRow,
} from '../../services/inventoryManagement.service';
import { plural } from '../../utils/plural';

interface InventoryReportsProps {
  organizationId: string;
  organizationName: string;
}

function formatScanned(isoString: string | null | undefined): string {
  if (!isoString) return '—';
  try {
    return format(new Date(isoString), 'MMM d, h:mm a');
  } catch {
    return isoString;
  }
}

function ConflictBadge() {
  return (
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
  );
}

function KitTypeBadge({ isContainer }: { isContainer: boolean }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span data-kit-kind className="text-[10px] font-normal text-muted-foreground border rounded px-1.5 py-0.5 cursor-help shrink-0">
          {isContainer ? 'Container' : 'Items'}
        </span>
      </TooltipTrigger>
      <TooltipContent>
        {isContainer
          ? 'Container kit: tracked as a single physical unit'
          : 'Items kit: each asset inside is tracked individually'}
      </TooltipContent>
    </Tooltip>
  );
}

export function PrintHeader({
  organizationName,
  reportTitle,
  subtitle,
}: {
  organizationName: string;
  reportTitle: string;
  subtitle?: string;
}) {
  return (
    <div className="print-only hidden mb-4">
      <div className="text-lg font-bold">{organizationName}</div>
      <div className="text-base font-semibold">{reportTitle}</div>
      {subtitle && <div className="text-sm text-gray-600">{subtitle}</div>}
      <div className="text-xs text-gray-500 mt-1">
        Generated {format(new Date(), 'PPPp')}
      </div>
    </div>
  );
}

type ManifestColumn = 'status' | 'gig' | 'scanned_at' | 'scanned_by' | 'notes';
const MANIFEST_COLUMNS: { key: ManifestColumn; label: string }[] = [
  { key: 'status', label: 'Status' },
  { key: 'gig', label: 'Gig' },
  { key: 'scanned_at', label: 'Last Scanned' },
  { key: 'scanned_by', label: 'Scanned By' },
  { key: 'notes', label: 'Notes' },
];

// The pickers list gigs within ±30 days unless Show all gigs is checked
// (#109). A gig already selected stays in its picker when the list changes
// and no longer holds it, so unchecking the box doesn't blank the report.
function useGigsWithSelected(gigs: GigOption[], selectedId: string): GigOption[] {
  const seen = useRef(new Map<string, GigOption>());
  for (const gig of gigs) seen.current.set(gig.id, gig);
  return useMemo(() => {
    const selected = seen.current.get(selectedId);
    if (!selected || gigs.some((g) => g.id === selectedId)) return gigs;
    return [...gigs, selected];
  }, [gigs, selectedId]);
}

function ShowAllGigsCheckbox({ id, checked, onChange }: { id: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center gap-2 h-9">
      <Checkbox id={id} checked={checked} onCheckedChange={(v) => onChange(v === true)} />
      <Label htmlFor={id} className="text-sm font-normal whitespace-nowrap">Show all gigs</Label>
    </div>
  );
}

/**
 * One line of the manifest (#327): a kit or case (depth 0) or something in it (depth 1), and
 * the "Not in a kit" heading over what isn't in one.
 */
interface ManifestDisplayLine {
  key: string;
  depth: 0 | 1;
  name: string;
  /** What was scanned; absent for an Items kit with no row of its own, and for the heading. */
  item?: ManifestLine;
  /** A kit or case line. */
  kitId?: string;
  isContainer?: boolean;
  tag?: string | null;
  notInKit?: boolean;
}

const byName = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'base' });

/** Kits and cases A to Z, each with what's in it, then what isn't in a kit (#327), as the packing list lists a gig. */
function manifestLines(items: ManifestLine[]): ManifestDisplayLine[] {
  const groups = new Map<string, ManifestLine[]>();
  for (const item of items) groups.set(item.kit_id, [...(groups.get(item.kit_id) ?? []), item]);
  const children = (list: ManifestLine[]) => list.filter((i) => i.asset_id)
    .sort((a, b) => byName(a.asset_name ?? '', b.asset_name ?? '') || byName(a.tag_number ?? '', b.tag_number ?? ''))
    .map((i, n): ManifestDisplayLine => ({ key: `${i.kit_id}-${i.asset_id}-${n}`, depth: 1, name: i.asset_name ?? '—', item: i }));
  const kits = [...groups.entries()].filter(([kitId]) => kitId !== '')
    .map(([kitId, list]) => ({ kitId, list, first: list[0] }))
    .sort((a, b) => byName(a.first.kit_name ?? '', b.first.kit_name ?? ''));
  const loose = groups.get('') ?? [];
  return [
    ...kits.flatMap(({ kitId, list, first }) => [
      { key: `${kitId}-kit`, depth: 0 as const, name: first.kit_name ?? '—', item: list.find((i) => !i.asset_id), kitId,
        isContainer: first.is_container, tag: first.kit_tag_number ?? null },
      ...children(list),
    ]),
    ...(loose.length ? [{ key: 'not-in-a-kit', depth: 0 as const, name: 'Not in a kit', notInKit: true }, ...children(loose)] : []),
  ];
}

/** Pieces a line stands for: a unit 1, a lot line its N, a case 1. An Items kit's own row isn't a piece. */
const manifestPieces = (line: ManifestDisplayLine) =>
  !line.item || (line.depth === 0 && !line.isContainer) ? 0 : piecesOf(line.item);

function ManifestTab({
  organizationId,
  organizationName,
  gigs: gigList,
  showAllGigs,
  onShowAllGigsChange,
  conflictFlags,
}: {
  organizationId: string;
  organizationName: string;
  gigs: GigOption[];
  showAllGigs: boolean;
  onShowAllGigsChange: (v: boolean) => void;
  conflictFlags: Set<string>;
}) {
  const [location, setLocation] = useState('');
  const [gigFilter, setGigFilter] = useState('all');
  const gigs = useGigsWithSelected(gigList, gigFilter);
  const [rows, setRows] = useState<ManifestLine[]>([]);
  const [loading, setLoading] = useState(false);
  const [visibleColumns, setVisibleColumns] = useState<Set<ManifestColumn>>(
    new Set(['status', 'gig', 'scanned_at', 'scanned_by', 'notes'])
  );
  // Lets a worker physically verify items as they walk the location — tap
  // to check off, tap again to undo. Not persisted: it's a scratchpad for
  // one verification pass, cleared whenever the underlying report changes.
  const [checkedRows, setCheckedRows] = useState<Set<string>>(new Set());
  const toggleChecked = (rowKey: string) => {
    setCheckedRows((prev) => {
      const next = new Set(prev);
      if (next.has(rowKey)) next.delete(rowKey);
      else next.add(rowKey);
      return next;
    });
  };

  const toggleColumn = (col: ManifestColumn) => {
    setVisibleColumns((prev) => {
      const next = new Set(prev);
      if (next.has(col)) next.delete(col);
      else next.add(col);
      return next;
    });
  };

  const fetchManifest = useCallback(async () => {
    if (!location) {
      setRows([]);
      return;
    }
    setLoading(true);
    try {
      const data = await getManifestReport(organizationId, {
        location,
        gigId: gigFilter !== 'all' ? gigFilter : undefined,
      });
      setRows(data);
      setCheckedRows(new Set());
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [organizationId, location, gigFilter]);

  useEffect(() => {
    fetchManifest();
  }, [fetchManifest]);

  const lines = useMemo(() => manifestLines(rows), [rows]);
  const kitCount = lines.filter((l) => l.kitId).length;
  const pieceCount = lines.reduce((n, l) => n + manifestPieces(l), 0);

  const gigTitle = gigs.find((g) => g.id === gigFilter)?.title;

  const show = (col: ManifestColumn) => visibleColumns.has(col);
  const blank = <span className="sr-only">None</span>;

  return (
    <div className="flex flex-col gap-4">
      {/* Printed header (#327), as the packing list's: the place, then its kits and pieces. */}
      <div data-testid="manifest-print-header" className="print-only hidden text-black mb-3">
        <div className="flex justify-between items-start border-b-[3px] border-black pb-2">
          <div className="flex flex-col gap-0.5">
            <div className="text-[8pt] uppercase tracking-[0.1em]">Manifest · {organizationName}</div>
            <div className="text-[16pt] font-bold">{location}</div>
            {gigTitle && <div>{gigTitle}</div>}
          </div>
          <div className="text-right text-[8.5pt]">
            {`${plural(kitCount, 'kit')} · ${plural(pieceCount, 'piece')}`}
            <br />Printed {format(new Date(), 'MMM d, yyyy')}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-3 items-end no-print">
        <div className="flex flex-col gap-1 min-w-[220px] flex-1">
          <label className="text-xs font-medium text-muted-foreground">
            Location <span className="text-red-500">*</span>
          </label>
          <LocationCombobox
            value={location}
            onChange={setLocation}
            organizationId={organizationId}
            placeholder="Select or enter location..."
          />
        </div>
        <div className="flex flex-col gap-1 min-w-[180px]">
          <label className="text-xs font-medium text-muted-foreground">Gig (optional)</label>
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
        <ShowAllGigsCheckbox id="manifest-show-all-gigs" checked={showAllGigs} onChange={onShowAllGigsChange} />
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="gap-2 shrink-0">
              <SlidersHorizontal className="h-4 w-4" />
              Columns
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-48 p-3" align="end">
            <div className="flex flex-col gap-2">
              {MANIFEST_COLUMNS.map((col) => (
                <div key={col.key} className="flex items-center gap-2">
                  <Checkbox
                    id={`manifest-col-${col.key}`}
                    checked={visibleColumns.has(col.key)}
                    onCheckedChange={() => toggleColumn(col.key)}
                  />
                  <Label htmlFor={`manifest-col-${col.key}`} className="text-sm font-normal cursor-pointer">
                    {col.label}
                  </Label>
                </div>
              ))}
            </div>
          </PopoverContent>
        </Popover>
        <Button
          variant="outline"
          size="sm"
          className="gap-2 shrink-0"
          onClick={() => window.print()}
          disabled={!location || rows.length === 0}
        >
          <Printer className="h-4 w-4" />
          Print
        </Button>
      </div>

      {!location && (
        <div className="flex flex-col items-center justify-center py-12 gap-2 border rounded-md bg-muted/20 no-print">
          <p className="text-sm text-muted-foreground">Select a location above to generate the manifest.</p>
        </div>
      )}

      {location && loading && (
        <div className="flex items-center justify-center py-12 no-print">
          <span className="text-sm text-muted-foreground">Loading manifest...</span>
        </div>
      )}

      {location && !loading && (
        <div className="rounded-md border overflow-hidden">
          {lines.length === 0 ? (
            <div className="flex items-center justify-center py-10">
              <span className="text-sm text-muted-foreground">{`Nothing is at ${location} now.`}</span>
            </div>
          ) : (
            <Table className="[&_th]:border [&_td]:border">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8 text-center">✓</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Tag #</TableHead>
                  <TableHead className="text-center">Qty</TableHead>
                  {show('status') && <TableHead>Status</TableHead>}
                  {show('gig') && <TableHead>Gig</TableHead>}
                  {show('scanned_at') && <TableHead>Last Scanned</TableHead>}
                  {show('scanned_by') && <TableHead>Scanned By</TableHead>}
                  {show('notes') && <TableHead>Notes</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {lines.map((line) => {
                  const { item } = line;
                  const isChecked = checkedRows.has(line.key);
                  // A lot has no tag (Cameron, 10-29): its Tag # is blank, not "—".
                  const tag = line.notInKit || item?.lot_of != null ? '' : (line.depth === 0 ? line.tag : item?.tag_number) ?? '—';
                  const pieces = manifestPieces(line);
                  return (
                    <TableRow key={line.key} data-depth={line.depth} className={line.depth === 0 ? 'border-t-2' : undefined}>
                      <TableCell className="text-center">
                        {!line.notInKit && (
                          <Checkbox
                            aria-label={`Verified: ${line.name}`}
                            checked={isChecked}
                            onCheckedChange={() => toggleChecked(line.key)}
                          />
                        )}
                      </TableCell>
                      <TableCell className={`${line.depth === 0 ? 'font-semibold' : ''} ${isChecked ? 'line-through text-muted-foreground' : ''}`}>
                        <div className={`flex items-center gap-2 ${line.depth === 1 ? 'pl-6 relative before:absolute before:left-2 before:top-1/2 before:w-3 before:border-t before:border-border' : ''}`}>
                          <span data-testid="manifest-name">{line.name}</span>
                          {line.kitId && <KitTypeBadge isContainer={!!line.isContainer} />}
                          {line.kitId && conflictFlags.has(line.kitId) && <ConflictBadge />}
                          {item?.asset_id && <LineExtras item={item} />}
                        </div>
                        {(item?.contents?.length ?? 0) > 0 && (
                          <div className="whitespace-normal pl-6 text-xs text-muted-foreground">{item!.contents!.join(' · ')}</div>
                        )}
                      </TableCell>
                      <TableCell>{tag}</TableCell>
                      <TableCell className="text-center">{pieces || ''}</TableCell>
                      {show('status') && (
                        <TableCell>{item ? <TrackingStatusBadge status={item.status} /> : blank}</TableCell>
                      )}
                      {show('gig') && (
                        <TableCell>{item ? item.gig_title ?? '—' : blank}</TableCell>
                      )}
                      {show('scanned_at') && (
                        <TableCell className="text-xs text-muted-foreground">
                          {item ? formatScanned(item.scanned_at) : blank}
                        </TableCell>
                      )}
                      {show('scanned_by') && (
                        <TableCell className="text-xs text-muted-foreground">
                          {item ? item.scanned_by_name ?? '—' : blank}
                        </TableCell>
                      )}
                      {show('notes') && (
                        <TableCell className="text-xs text-muted-foreground">
                          {item ? item.notes ?? '—' : blank}
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </div>
      )}
    </div>
  );
}

const PACKING_COLUMNS: { key: PackingColumn; label: string }[] = [
  { key: 'status', label: 'Status' },
  { key: 'scanned_at', label: 'Last Scanned' },
  { key: 'location', label: 'Location' },
  { key: 'scanned_by', label: 'Scanned By' },
  { key: 'notes', label: 'Notes' },
];

/** One line of the packing list: a kit (depth 0) or something packed in it (depth 1). */
interface PackingLine {
  key: string;
  depth: 0 | 1;
  name: string;
  /** The scannable unit; absent for an Items kit's own line. */
  row?: PackingListRow;
  /** An Items kit's own line: its id and tag. */
  kitId?: string;
  tag?: string | null;
  /** The kit was added at pack-out (#185). */
  addedAtPackOut?: boolean;
  /** The group of units and lots added at pack-out on their own: not a kit. */
  loose?: boolean;
}

/** An "any" line's progress (#185): "1 of 2" when scanned, "7 counted · 3 short" when counted. */
function anyProgress(row: PackingListRow): string {
  const packed = row.packed ?? 0;
  const short = Math.max(0, row.quantity - packed);
  // A short line says how many of the item are in maintenance (#186 step 4).
  const shop = short && row.in_maintenance ? ` · ${row.in_maintenance} in maintenance` : '';
  if (!row.counted) return `${packed} of ${row.quantity}${shop}`;
  return short ? `${packed} counted · ${short} short${shop}` : `${packed} counted`;
}

/** Under a line's name (#185): the units packed for an "any" line, a lot's size, a container's
 *  contents; and, on paper, a write-in blank per piece to scan or a box to count. */
function PackingLineDetail({ row }: { row: PackingListRow }) {
  const scanned = row.kind === 'any' && !row.counted;
  const tags = (row.packed_units ?? []).map((u) => u.tag_number ?? u.serial_number ?? `${u.quantity} from a lot`);
  return (
    <>
      {tags.length > 0 && (
        <div className="mt-0.5 flex flex-wrap gap-1 pl-6 text-xs text-muted-foreground">
          {tags.map((t, i) => <span key={i} className="rounded bg-muted px-1 font-mono">{t}</span>)}
        </div>
      )}
      {row.kind === 'lot' && row.lot_of != null && <div className="pl-6 text-xs text-muted-foreground">{`from a lot of ${row.lot_of}`}</div>}
      {row.kind === 'container' && (row.contents?.length ?? 0) > 0 && (
        // Wraps (#249): one long unbroken line would set the whole Name column's width.
        <div className="whitespace-normal pl-6 text-xs text-muted-foreground">{row.contents!.join(' · ')}</div>
      )}
      {scanned && (
        <div className="print-only hidden pl-6">
          {Array.from({ length: Math.min(row.quantity, 24) }, (_, i) => (
            <span key={i} data-testid="write-in" className="mr-2 inline-block w-16 border-b border-black">&nbsp;</span>
          ))}
        </div>
      )}
      {row.counted && (
        <div data-testid="count-box" className="print-only hidden pl-6">☐ count ______</div>
      )}
    </>
  );
}

function PackingListTab({
  organizationId,
  organizationName,
  gig: fixedGig,
  conflictFlags,
  hidePrintButton,
  onLoaded,
  columns,
  onColumnsChange,
}: {
  organizationId: string;
  organizationName: string;
  /** The columns to show, when the page keeps the choice (#245: the printout matches the screen). */
  columns?: ReadonlySet<PackingColumn>;
  onColumnsChange?: (columns: Set<PackingColumn>) => void;
  /** The gig to list (#39: the packing list lives on the gig page). */
  gig: GigOption;
  conflictFlags: Set<string>;
  /** The gig page prints from its own Print menu. */
  hidePrintButton?: boolean;
  /** Called once the rows have loaded, so a print can wait for them. */
  onLoaded?: () => void;
}) {
  const gigId = fixedGig.id;
  const [rows, setRows] = useState<PackingListRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [ownColumns, setOwnColumns] = useState<ReadonlySet<PackingColumn>>(loadPackingColumns);
  const visibleColumns = columns ?? ownColumns;
  // Lets a worker physically verify items as they pack, tap to check off
  // and tap again to undo. Not persisted: a scratchpad for one pass,
  // cleared whenever the underlying report changes.
  const [checkedRows, setCheckedRows] = useState<Set<string>>(new Set());
  const toggleChecked = (rowKey: string) => {
    setCheckedRows((prev) => {
      const next = new Set(prev);
      if (next.has(rowKey)) next.delete(rowKey);
      else next.add(rowKey);
      return next;
    });
  };

  const toggleColumn = (col: PackingColumn) => {
    const next = new Set(visibleColumns);
    if (next.has(col)) next.delete(col);
    else next.add(col);
    if (onColumnsChange) onColumnsChange(next);
    else {
      setOwnColumns(next);
      savePackingColumns(next);
    }
  };

  const fetchPackingList = useCallback(async () => {
    if (!gigId) {
      setRows([]);
      return;
    }
    setLoading(true);
    try {
      const data = await getPackingListReport(organizationId, gigId);
      setRows(data);
      setCheckedRows(new Set());
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
      setLoaded(true);
    }
  }, [organizationId, gigId]);

  useEffect(() => {
    if (loaded) onLoaded?.();
  }, [loaded, onLoaded]);

  useEffect(() => {
    fetchPackingList();
  }, [fetchPackingList]);

  // The list as packed (#81): one line per kit assigned to the gig, A to Z, with
  // an Items kit's contents (its loose items and the cases packed inside it)
  // indented under it. A container on its own is a single line, since it is
  // checked as one sealed case.
  const packingLines = useMemo(() => {
    const groups = new Map<string, PackingListRow[]>();
    for (const row of rows) {
      const list = groups.get(row.group_kit_id) ?? [];
      list.push(row);
      groups.set(row.group_kit_id, list);
    }
    // What was added at pack-out on its own comes after the kits (#185).
    return Array.from(groups.values())
      .sort((a, b) => Number(!!a[0].group_is_loose) - Number(!!b[0].group_is_loose)
        || a[0].group_kit_name.localeCompare(b[0].group_kit_name, undefined, { sensitivity: 'base' }))
      .flatMap((kitRows): PackingLine[] => {
        const group = kitRows[0];
        if (group.group_is_container) {
          return kitRows.map((row) => ({ key: `${row.kit_id}-kit`, depth: 0, name: row.kit_name ?? '—', row }));
        }
        return [
          { key: `${group.group_kit_id}-kit`, depth: 0, name: group.group_kit_name, kitId: group.group_kit_id, tag: group.group_tag_number,
            addedAtPackOut: !!group.group_added_at_pack_out, loose: !!group.group_is_loose },
          ...kitRows.map((row, i) => ({
            key: `${row.kit_id}-${row.asset_id ?? 'kit'}-${i}`,
            depth: 1 as const,
            name: row.asset_name ?? row.kit_name ?? '—',
            row,
          })),
        ];
      });
  }, [rows]);

  // Pieces, not lines (#185): what the kits ask for, and how many of them are packed.
  // The gig's Equipment card counts each kit the same way (utils/packingSummary).
  const pieces = useMemo(() => rows.reduce((acc, r) => (
    { total: acc.total + r.quantity, packed: acc.packed + packedPieces(r) }
  ), { total: 0, packed: 0 }), [rows]);

  const selectedGig = fixedGig;
  const selectedGigTitle = selectedGig.title;
  const show = (col: PackingColumn) => visibleColumns.has(col);

  return (
    <div className="flex flex-col gap-4">
      {/* Printed header (#12, board 6): the gig and its date, then the kit and line counts. */}
      <div data-testid="packing-print-header" className="print-only hidden text-black mb-3">
        <div className="flex justify-between items-start border-b-[3px] border-black pb-2">
          <div className="flex flex-col gap-0.5">
            <div className="text-[8pt] uppercase tracking-[0.1em]">Packing list · {organizationName}</div>
            <div className="text-[16pt] font-bold">{selectedGigTitle}</div>
            {selectedGig?.start && (
              <div>{formatInTimeZone(selectedGig.start, selectedGig.timezone ?? undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}</div>
            )}
          </div>
          <div className="text-right text-[8.5pt]">
            {/* Kits and pieces (#245, Cameron 10-11): the pack-out group isn't a kit. */}
            {`${plural(new Set(rows.filter((r) => !r.group_is_loose).map((r) => r.group_kit_id)).size, 'kit')} · ${plural(pieces.total, 'piece')}`}
            <br />Printed {format(new Date(), 'MMM d, yyyy')}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-3 items-end justify-end no-print">
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="gap-2 shrink-0">
              <SlidersHorizontal className="h-4 w-4" />
              Columns
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-48 p-3" align="end">
            <div className="flex flex-col gap-2">
              {PACKING_COLUMNS.map((col) => (
                <div key={col.key} className="flex items-center gap-2">
                  <Checkbox
                    id={`packing-col-${col.key}`}
                    checked={visibleColumns.has(col.key)}
                    onCheckedChange={() => toggleColumn(col.key)}
                  />
                  <Label htmlFor={`packing-col-${col.key}`} className="text-sm font-normal cursor-pointer">
                    {col.label}
                  </Label>
                </div>
              ))}
            </div>
          </PopoverContent>
        </Popover>
        {!hidePrintButton && (
          <Button
            variant="outline"
            size="sm"
            className="gap-2 shrink-0"
            onClick={() => window.print()}
            disabled={!gigId || rows.length === 0}
          >
            <Printer className="h-4 w-4" />
            Print
          </Button>
        )}
      </div>

      {!gigId && (
        <div className="flex flex-col items-center justify-center py-12 gap-2 border rounded-md bg-muted/20 no-print">
          <p className="text-sm text-muted-foreground">Select a gig above to generate the packing list.</p>
        </div>
      )}

      {gigId && loading && (
        <div className="flex items-center justify-center py-12 no-print">
          <span className="text-sm text-muted-foreground">Loading packing list...</span>
        </div>
      )}

      {gigId && !loading && rows.length > 0 && (
        <p className="text-sm text-muted-foreground">{`${plural(pieces.total, 'piece')} · ${pieces.packed} packed`}</p>
      )}

      {gigId && !loading && (
        <div className="rounded-md border overflow-hidden">
          {packingLines.length === 0 ? (
            <div className="flex items-center justify-center py-10">
              <span className="text-sm text-muted-foreground">No kits assigned to this gig.</span>
            </div>
          ) : (
            <Table className="[&_th]:border [&_td]:border">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8 text-center">✓</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Tag #</TableHead>
                  <TableHead className="text-center">Qty</TableHead>
                  {show('status') && <TableHead>Status</TableHead>}
                  {show('scanned_at') && <TableHead>Last Scanned</TableHead>}
                  {show('location') && <TableHead>Location</TableHead>}
                  {show('scanned_by') && <TableHead>Scanned By</TableHead>}
                  {show('notes') && <TableHead>Notes</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {packingLines.map((line) => {
                  const { row } = line;
                  const isChecked = checkedRows.has(line.key);
                  // An Items kit line: the kit isn't scanned itself, only what's in it.
                  const blankCell = <span className="sr-only">Not tracked</span>;
                  const isContainer = row ? row.is_container : false;
                  const conflict = conflictFlags.has(row ? row.kit_id : line.kitId!) && (line.depth === 0 || isContainer);
                  return (
                    <TableRow key={line.key} data-depth={line.depth} className={line.depth === 0 ? 'border-t-2' : undefined}>
                      <TableCell className="text-center">
                        <Checkbox
                          aria-label={`Verified: ${line.name}`}
                          checked={isChecked}
                          onCheckedChange={() => toggleChecked(line.key)}
                        />
                      </TableCell>
                      <TableCell className={`${line.depth === 0 ? 'font-semibold' : ''} ${isChecked ? 'line-through text-muted-foreground' : ''}`}>
                        <div className={`flex items-center gap-2 ${line.depth === 1 ? 'pl-6 relative before:absolute before:left-2 before:top-1/2 before:w-3 before:border-t before:border-border' : ''}`}>
                          <span data-item-name>{line.name}</span>
                          {(line.depth === 0 || isContainer) && !line.loose && <KitTypeBadge isContainer={line.depth === 0 ? !line.kitId : true} />}
                          {line.addedAtPackOut && <span className="rounded border border-amber-300 bg-amber-50 px-1.5 text-[11px] font-medium text-amber-800">Added at pack-out</span>}
                          {row?.kind === 'any' && <span className="rounded border border-sky-300 bg-sky-50 px-1.5 text-[11px] font-medium text-sky-800">Any</span>}
                          {row && row.kind !== 'any' && !!row.in_maintenance && (
                            <span className="rounded border border-orange-200 bg-orange-50 px-1.5 text-[11px] font-medium text-orange-700">In maintenance</span>
                          )}
                          {conflict && <ConflictBadge />}
                        </div>
                        {row && <PackingLineDetail row={row} />}
                      </TableCell>
                      <TableCell>{(row ? row.tag_number : line.tag) ?? '—'}</TableCell>
                      <TableCell className="text-center">{row ? row.quantity : 1}</TableCell>
                      {show('status') && (
                        <TableCell>
                          {!row ? blankCell : row.kind === 'any' ? (
                            <span className="text-xs">{anyProgress(row)}</span>
                          ) : row.status ? (
                            <span className="flex items-center gap-1.5">
                              <TrackingStatusBadge status={row.status} />
                              {/* A partly packed lot says how many (#245), as "any" lines do. */}
                              {row.kind === 'lot' && packedPieces(row) > 0 && packedPieces(row) < row.quantity && (
                                <span className="text-xs whitespace-nowrap">{`${packedPieces(row)} of ${row.quantity}`}</span>
                              )}
                            </span>
                          ) : (
                            <span className="text-xs text-muted-foreground">Not scanned</span>
                          )}
                        </TableCell>
                      )}
                      {show('scanned_at') && (
                        <TableCell className="text-xs text-muted-foreground">
                          {row ? formatScanned(row.scanned_at) : blankCell}
                        </TableCell>
                      )}
                      {show('location') && (
                        <TableCell className="text-xs text-muted-foreground">
                          {row ? row.location ?? '—' : blankCell}
                        </TableCell>
                      )}
                      {show('scanned_by') && (
                        <TableCell className="text-xs text-muted-foreground">
                          {row ? row.scanned_by_name ?? '—' : blankCell}
                        </TableCell>
                      )}
                      {show('notes') && (
                        <TableCell className="text-xs text-muted-foreground">
                          {row ? row.notes ?? '—' : blankCell}
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </div>
      )}
    </div>
  );
}

function useConflictFlags(organizationId: string): Set<string> {
  const [conflictFlags, setConflictFlags] = useState<Set<string>>(new Set());
  useEffect(() => {
    getInventoryConflictFlags(organizationId).then(setConflictFlags).catch(() => {});
  }, [organizationId]);
  return conflictFlags;
}

/**
 * The Manifest for one location (#39: opened from Equipment › Locations'
 * "Print manifest"). Its gig filter uses the report picker's window (#109).
 */
export function ManifestReport({ organizationId, organizationName }: InventoryReportsProps) {
  const [gigs, setGigs] = useState<GigOption[]>([]);
  const [showAllGigs, setShowAllGigs] = useState(false);
  const conflictFlags = useConflictFlags(organizationId);

  useEffect(() => {
    let cancelled = false;
    getGigsForReportPicker(organizationId, { showAll: showAllGigs })
      .then((gigsData) => { if (!cancelled) setGigs(gigsData); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [organizationId, showAllGigs]);

  return (
    <ManifestTab
      organizationId={organizationId}
      organizationName={organizationName}
      gigs={gigs}
      showAllGigs={showAllGigs}
      onShowAllGigsChange={setShowAllGigs}
      conflictFlags={conflictFlags}
    />
  );
}

/** One gig's packing list, shown on the gig page's Equipment tab and printed from its Print menu (#39). */
export function PackingList({
  organizationId,
  organizationName,
  gig,
  hidePrintButton,
  onLoaded,
  columns,
  onColumnsChange,
}: InventoryReportsProps & {
  gig: GigOption;
  hidePrintButton?: boolean;
  onLoaded?: () => void;
  columns?: ReadonlySet<PackingColumn>;
  onColumnsChange?: (columns: Set<PackingColumn>) => void;
}) {
  const conflictFlags = useConflictFlags(organizationId);
  return (
    <PackingListTab
      organizationId={organizationId}
      organizationName={organizationName}
      gig={gig}
      conflictFlags={conflictFlags}
      hidePrintButton={hidePrintButton}
      onLoaded={onLoaded}
      columns={columns}
      onColumnsChange={onColumnsChange}
    />
  );
}
