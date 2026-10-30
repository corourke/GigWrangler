import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ManifestReport, PackingList } from './InventoryReports';
import type { PackingListRow } from '../../services/inventoryManagement.service';

vi.mock('../../services/inventoryManagement.service', () => ({
  getGigsForReportPicker: vi.fn().mockResolvedValue([{ id: 'gig-1', title: 'Test Gig', start: '2026-07-12T19:00:00Z', timezone: 'America/Los_Angeles' }]),
  getInventoryConflictFlags: vi.fn().mockResolvedValue(new Set()),
  getManifestReport: vi.fn().mockResolvedValue([]),
  getPackingListReport: vi.fn(),
}));

// Real Radix Select doesn't drive well under jsdom; stand in a plain version
// that still round-trips a selection through onValueChange, so choosing a gig
// actually changes PackingListTab's state (same shape as the existing
// LocationExplorer.test.tsx select mock, extended to support selecting).
vi.mock('../ui/select', () => {
  let currentOnValueChange: (v: string) => void = () => {};
  return {
    Select: ({ children, onValueChange }: any) => {
      currentOnValueChange = onValueChange;
      return <div>{children}</div>;
    },
    SelectTrigger: ({ children, 'aria-label': ariaLabel }: any) => (
      <button role="combobox" aria-label={ariaLabel}>{children}</button>
    ),
    SelectValue: ({ placeholder }: any) => <span>{placeholder}</span>,
    SelectContent: ({ children }: any) => <div>{children}</div>,
    SelectItem: ({ children, value }: any) => (
      <div role="option" onClick={() => currentOnValueChange(value)}>{children}</div>
    ),
  };
});

import { getGigsForReportPicker, getPackingListReport } from '../../services/inventoryManagement.service';

const blank = { status: null, location: null, scanned_at: null, scanned_by_name: null, notes: null, has_conflict: false };
const lighting = { group_kit_id: 'kit-lighting', group_kit_name: 'Lighting Kit', group_is_container: false, group_tag_number: null };
const PACKING_ROWS: PackingListRow[] = [
  {
    kit_id: 'kit-lighting', kit_name: 'Lighting Kit', is_container: false,
    asset_id: 'asset-par', asset_name: 'LED Par', tag_number: 'PAR-1', quantity: 4, ...lighting, ...blank,
  },
  {
    kit_id: 'kit-lighting', kit_name: 'Lighting Kit', is_container: false,
    asset_id: 'asset-cable', asset_name: 'XLR Cable', tag_number: null, quantity: 3, ...lighting, ...blank,
  },
  {
    kit_id: 'kit-case', kit_name: 'Road Case', is_container: true,
    asset_id: null, asset_name: null, tag_number: 'RC-1', quantity: 1,
    group_kit_id: 'kit-case', group_kit_name: 'Road Case', group_is_container: true, group_tag_number: 'RC-1', ...blank,
  },
];

// Issue #81, as Cameron listed it on 2026-09-28: kits A to Z, a kit's contents
// indented under it, a container on its own a single line.
const EXPECTED_81 = `
All Mic Stands (Items)
  Boom Stands 1 (Container)
  Boom Stands 2 (Container)
  Low Profile Boom Stands (Container)
  Atlas Straight Microphone Stand
Microphone Case (Container)
Network Cable Bag (Container)
Power Box (Container)
RCF Speakers (Items)
  RCF NX-932A Speaker, w/Cover
  RCF NX-932A Speaker, w/Cover
  RCF SUB-8003 Subwoofer, w/Casters and Cover
  RCF SUB-8003 Subwoofer, w/Casters and Cover
  RCF PowerCon Speaker Power Cable
  RCF TrueCon Speaker Power Cable
  Speaker Poles
SndEng Case (Container)
Stage Box Rack DS16 (Container)
Stage Snakes (Items)
  Seismic Audio - SASH-8x20 - 8 Channel XLR Send Sub Snake Cable - 20 Feet
  Seismic Audio - SASH-8x35 - 8 Channel XLR Send Sub Snake Cable - 35 Feet
WING Console (Container)
XLR Cable Box (Container)
`.trim().split('\n');

/** The report rows the service returns for that gig, kits in no particular order. */
function rowsFor81(): PackingListRow[] {
  const slug = (n: string) => n.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const group = (name: string, container: boolean) =>
    ({ group_kit_id: `kit-${slug(name)}`, group_kit_name: name, group_is_container: container, group_tag_number: null });
  const container = (name: string) =>
    ({ kit_id: `kit-${slug(name)}`, kit_name: name, is_container: true, asset_id: null, asset_name: null, tag_number: null, quantity: 1, ...blank });
  const kits: [string, string[]][] = [];
  let current: [string, string[]] | null = null;
  for (const line of EXPECTED_81) {
    if (line.startsWith('  ')) current![1].push(line.trim());
    else kits.push((current = [line, []]));
  }
  const rows = kits.flatMap(([line, contents]) => {
    const name = line.replace(/ \((Items|Container)\)$/, '');
    if (line.endsWith('(Container)')) return [{ ...container(name), ...group(name, true) }];
    return contents.map((item, i) => item.endsWith('(Container)')
      ? { ...container(item.replace(' (Container)', '')), ...group(name, false) }
      : {
          kit_id: `kit-${slug(name)}`, kit_name: name, is_container: false, asset_id: `asset-${slug(name)}-${i}`, asset_name: item,
          tag_number: null, quantity: 1, ...blank, ...group(name, false),
        });
  });
  // Scramble the kits: the report sorts them, not the service.
  const order = ['kit-stage-snakes', 'kit-xlr-cable-box', 'kit-rcf-speakers', 'kit-power-box', 'kit-all-mic-stands'];
  return [...rows].sort((x, y) => (order.indexOf(y.group_kit_id) - order.indexOf(x.group_kit_id)));
}

/** The report body as an indented list: "Name (Type)", contents two spaces in. */
function packingTree(): string[] {
  const body = screen.getAllByRole('rowgroup')[1];
  return within(body).getAllByRole('row').map((row) => {
    const indent = row.getAttribute('data-depth') === '1' ? '  ' : '';
    const name = row.querySelector('[data-item-name]')?.textContent ?? '';
    const kind = row.querySelector('[data-kit-kind]')?.textContent;
    return `${indent}${name}${kind ? ` (${kind})` : ''}`;
  });
}

const TEST_GIG = { id: 'gig-1', title: 'Test Gig', start: '2026-07-12T19:00:00Z', timezone: 'America/Los_Angeles' };

async function renderPackingListTab(props: Partial<React.ComponentProps<typeof PackingList>> = {}) {
  render(<PackingList organizationId="org-1" organizationName="Test Org" gig={TEST_GIG as any} {...props} />);
}

describe('PackingList (one gig, on the gig page since #39)', () => {
  it('lists the given gig with no gig picker', async () => {
    (getPackingListReport as any).mockResolvedValue(PACKING_ROWS);
    await renderPackingListTab();
    await waitFor(() => expect(getPackingListReport).toHaveBeenLastCalledWith('org-1', 'gig-1'));
    expect(screen.queryByRole('combobox', { name: 'Select gig' })).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: 'Show all gigs' })).not.toBeInTheDocument();
  });

  it('tells the caller when the rows have loaded, so a print can wait for them', async () => {
    (getPackingListReport as any).mockResolvedValue(PACKING_ROWS);
    const onLoaded = vi.fn();
    await renderPackingListTab({ onLoaded });
    await waitFor(() => expect(onLoaded).toHaveBeenCalledTimes(1));
  });

  it('hides its own Print button when the page prints it', async () => {
    (getPackingListReport as any).mockResolvedValue(PACKING_ROWS);
    await renderPackingListTab({ hidePrintButton: true });
    await screen.findByText('LED Par');
    expect(screen.queryByRole('button', { name: /print/i })).not.toBeInTheDocument();
  });

  it('renders every kit group inside a single table, not one table per kit', async () => {
    (getPackingListReport as any).mockResolvedValue(PACKING_ROWS);
    await renderPackingListTab();

    await waitFor(() => expect(screen.getByText('LED Par')).toBeInTheDocument());
    expect(screen.getAllByRole('table')).toHaveLength(1);
  });

  it('shows the component quantity for each item', async () => {
    (getPackingListReport as any).mockResolvedValue(PACKING_ROWS);
    await renderPackingListTab();

    const parRow = (await screen.findByText('LED Par')).closest('tr')!;
    expect(within(parRow).getByText('4')).toBeInTheDocument();

    const cableRow = screen.getByText('XLR Cable').closest('tr')!;
    expect(within(cableRow).getByText('3')).toBeInTheDocument();
  });

  it('lists kits A to Z with their contents indented, each container once (#81)', async () => {
    (getPackingListReport as any).mockResolvedValue(rowsFor81());
    await renderPackingListTab();

    await waitFor(() => expect(screen.getByText('Speaker Poles')).toBeInTheDocument());
    expect(packingTree()).toEqual(EXPECTED_81);
  });

  it('gives each kit line a checkbox but no scan status for an Items kit (#81)', async () => {
    (getPackingListReport as any).mockResolvedValue(rowsFor81());
    await renderPackingListTab();

    const kitLine = (await screen.findByText('RCF Speakers')).closest('tr')!;
    expect(within(kitLine).getByRole('checkbox', { name: 'Verified: RCF Speakers' })).toBeInTheDocument();
    expect(within(kitLine).queryByText('Not scanned')).not.toBeInTheDocument();
    const powerBox = screen.getByText('Power Box').closest('tr')!;
    expect(within(powerBox).getByText('Not scanned')).toBeInTheDocument();
  });

  it('prints a header with the gig, its date and the kit and line counts (#12)', async () => {
    (getPackingListReport as any).mockResolvedValue(rowsFor81());
    await renderPackingListTab();

    await waitFor(() => expect(screen.getByText('Speaker Poles')).toBeInTheDocument());
    const header = screen.getByTestId('packing-print-header');
    expect(header).toHaveTextContent('Packing list · Test Org');
    expect(header).toHaveTextContent('Test Gig');
    expect(header).toHaveTextContent('Sun, Jul 12, 2026');
    // #245 item 4: kits and pieces, not kit headings counted as lines.
    expect(header).not.toHaveTextContent('lines');
  });
});

// #185 (mockup screen 6): "any" lines with progress and the units under them, counted lines,
// lots, containers listing their contents, a pieces summary, and print blanks.
describe('PackingList: any lines, counted lines and pieces (#185)', () => {
  const pa = { group_kit_id: 'kit-pa', group_kit_name: 'Main PA', group_is_container: false, group_tag_number: null };
  const ROWS: PackingListRow[] = [
    { kit_id: 'kit-pa', kit_name: 'Main PA', is_container: false, kind: 'any', item_id: 'item-k12', asset_id: null,
      asset_name: 'QSC K12.2', tag_number: null, quantity: 2, packed: 1, counted: false,
      packed_units: [{ asset_id: 'k1', tag_number: 'DSL-0101', serial_number: 'S1', quantity: 1 }], ...pa, ...blank },
    { kit_id: 'kit-pa', kit_name: 'Main PA', is_container: false, kind: 'any', item_id: 'item-xlr', asset_id: null,
      asset_name: 'XLR Cable, 50 ft', tag_number: null, quantity: 10, packed: 7, counted: true, packed_units: [], ...pa, ...blank },
    { kit_id: 'kit-pa', kit_name: 'Main PA', is_container: false, kind: 'lot', lot_of: 6, asset_id: 'stands',
      asset_name: 'Speaker Stand', tag_number: null, quantity: 2, packed: 0, ...pa, ...blank },
    { kit_id: 'kit-case', kit_name: 'Mic Case', is_container: true, kind: 'container', asset_id: null, asset_name: null,
      tag_number: 'MC-1', quantity: 1, packed: 1, contents: ['8 × Shure SM58', '2 × Radial DI'],
      group_kit_id: 'kit-case', group_kit_name: 'Mic Case', group_is_container: true, group_tag_number: 'MC-1', ...blank, status: 'Checked Out' },
  ];

  it('an "any" line shows its progress and the units packed for it', async () => {
    (getPackingListReport as any).mockResolvedValue(ROWS);
    await renderPackingListTab();
    const row = (await screen.findByText('QSC K12.2')).closest('tr')!;
    expect(within(row).getByText('Any')).toBeInTheDocument();
    expect(within(row).getByText('1 of 2')).toBeInTheDocument();
    expect(within(row).getByText('DSL-0101')).toBeInTheDocument();
  });

  // #186 step 4: what maintenance takes from a line.
  it('a line whose record is in maintenance says so; a short "any" line counts its item in maintenance', async () => {
    (getPackingListReport as any).mockResolvedValue(ROWS.map((r) =>
      r.asset_id === 'stands' ? { ...r, in_maintenance: 6 } : r.item_id === 'item-xlr' ? { ...r, in_maintenance: 2 } : r));
    await renderPackingListTab();
    const stands = (await screen.findByText('Speaker Stand')).closest('tr')!;
    expect(within(stands).getByText('In maintenance')).toBeInTheDocument();
    const xlr = screen.getByText('XLR Cable, 50 ft').closest('tr')!;
    expect(within(xlr).getByText('7 counted · 3 short · 2 in maintenance')).toBeInTheDocument();
    const k12 = screen.getByText('QSC K12.2').closest('tr')!;
    expect(within(k12).queryByText(/in maintenance/i)).not.toBeInTheDocument();
  });

  it('a counted line says how many were counted and how many are short', async () => {
    (getPackingListReport as any).mockResolvedValue(ROWS);
    await renderPackingListTab();
    const row = (await screen.findByText('XLR Cable, 50 ft')).closest('tr')!;
    expect(within(row).getByText('7 counted · 3 short')).toBeInTheDocument();
  });

  it('a lot line says how many the lot holds; a container lists what it holds', async () => {
    (getPackingListReport as any).mockResolvedValue(ROWS);
    await renderPackingListTab();
    expect(await screen.findByText('Speaker Stand')).toBeInTheDocument();
    expect(screen.getByText('from a lot of 6')).toBeInTheDocument();
    expect(screen.getByText('8 × Shure SM58 · 2 × Radial DI')).toBeInTheDocument();
  });

  // #249: a long contents line wraps instead of widening the Name column; #245 item 5: indented.
  it('a container\'s contents line wraps and is indented under it', async () => {
    (getPackingListReport as any).mockResolvedValue(ROWS);
    await renderPackingListTab();
    const contents = await screen.findByText('8 × Shure SM58 · 2 × Radial DI');
    expect(contents.className).toMatch(/\bwhitespace-normal\b/);
    expect(contents.className).toMatch(/\bpl-6\b/);
  });

  // #245 item 1: a partly packed lot says how many, as "any" lines do; a full one doesn't need to.
  it('a partly packed lot line says how many of it are packed', async () => {
    const lot = (packed: number, asset_id: string, asset_name: string) => ({ kit_id: 'kit-pa', kit_name: 'Main PA', is_container: false, kind: 'lot' as const,
      lot_of: 12, asset_id, asset_name, tag_number: null, quantity: 6, packed, ...pa, ...blank, status: 'Checked Out' });
    (getPackingListReport as any).mockResolvedValue([lot(4, 'dmx', 'DMX Cable'), lot(6, 'edison', 'Edison Cord')]);
    await renderPackingListTab();
    const part = (await screen.findByText('DMX Cable')).closest('tr')!;
    expect(within(part).getByText('4 of 6')).toBeInTheDocument();
    expect(within(part).getByText('Checked Out')).toBeInTheDocument();
    const full = screen.getByText('Edison Cord').closest('tr')!;
    expect(within(full).queryByText(/of 6/)).not.toBeInTheDocument();
  });

  it('sums pieces and packed pieces, and prints write-in blanks for scanned lines and a count box for counted ones', async () => {
    (getPackingListReport as any).mockResolvedValue(ROWS);
    await renderPackingListTab();
    expect(await screen.findByText('15 pieces · 9 packed')).toBeInTheDocument();
    const k12 = screen.getByText('QSC K12.2').closest('tr')!;
    expect(within(k12).getAllByTestId('write-in')).toHaveLength(2);
    const xlr = screen.getByText('XLR Cable, 50 ft').closest('tr')!;
    expect(within(xlr).getByTestId('count-box')).toBeInTheDocument();
  });
});

// #185 PR 2: what was added at pack-out. A kit added there says so; units and lots added on
// their own are one group, after the kits A to Z.
// #245 follow-ups: the print header's counts, the Columns choice from the page, and a unit
// that has moved on.
describe('PackingList: #245 follow-ups', () => {
  const pa = { group_kit_id: 'kit-pa', group_kit_name: 'Main PA', group_is_container: false, group_tag_number: null };
  const unit = (asset_id: string, packed: number, extra: Partial<PackingListRow> = {}): PackingListRow => ({ kit_id: 'kit-pa', kit_name: 'Main PA',
    is_container: false, kind: 'unit', asset_id, asset_name: asset_id, tag_number: null, quantity: 1, packed, ...pa, ...blank, ...extra });
  const lot: PackingListRow = { kit_id: 'kit-pa', kit_name: 'Main PA', is_container: false, kind: 'lot', lot_of: 12, asset_id: 'dmx',
    asset_name: 'DMX Cable', tag_number: null, quantity: 6, packed: 4, ...pa, ...blank, status: 'Checked Out' };
  const loose: PackingListRow = { kit_id: 'loose:gig-1', kit_name: 'Added at pack-out', is_container: false, kind: 'unit', asset_id: 'pd20',
    asset_name: 'PD-20', tag_number: null, quantity: 1, packed: 1, group_kit_id: 'loose:gig-1', group_kit_name: 'Added at pack-out',
    group_is_container: false, group_tag_number: null, group_is_loose: true, ...blank, status: 'Checked Out' };
  const caseRow: PackingListRow = { kit_id: 'kit-case', kit_name: 'Mic Case', is_container: true, kind: 'container', asset_id: null,
    asset_name: null, tag_number: 'MC-1', quantity: 1, packed: 0, contents: [], group_kit_id: 'kit-case', group_kit_name: 'Mic Case',
    group_is_container: true, group_tag_number: 'MC-1', ...blank };

  it('the print header counts kits and pieces, as the summary does; the pack-out group isn\'t a kit', async () => {
    (getPackingListReport as any).mockResolvedValue([unit('amp', 1, { status: 'Checked Out' }), lot, caseRow, loose]);
    await renderPackingListTab();
    await screen.findByText('DMX Cable');
    expect(screen.getByText('9 pieces · 6 packed')).toBeInTheDocument();
    // Cameron, 10-11: kits and pieces only, no packed count.
    const header = screen.getByTestId('packing-print-header');
    expect(header).toHaveTextContent('2 kits · 9 pieces');
    expect(header).not.toHaveTextContent('packed');
  });

  it('counts one kit and one piece in the singular', async () => {
    (getPackingListReport as any).mockResolvedValue([unit('amp', 1, { status: 'Checked Out' })]);
    await renderPackingListTab();
    expect(await screen.findByText('1 piece · 1 packed')).toBeInTheDocument();
    expect(screen.getByTestId('packing-print-header')).toHaveTextContent('1 kit · 1 piece');
  });

  it('a unit since moved to another gig reads Not scanned and isn\'t packed here', async () => {
    (getPackingListReport as any).mockResolvedValue([unit('moved', 0)]);
    await renderPackingListTab();
    const row = (await screen.findByText('moved')).closest('tr')!;
    expect(within(row).getByText('Not scanned')).toBeInTheDocument();
    expect(screen.getByText('1 pieces · 0 packed')).toBeInTheDocument();
  });

  // Cameron, 10-11: the Columns choice is remembered per browser, for every packing list.
  it('remembers its Columns choice in this browser', async () => {
    localStorage.clear();
    (getPackingListReport as any).mockResolvedValue([unit('amp', 1, { status: 'Checked Out' })]);
    const user = userEvent.setup();
    const { unmount } = render(<PackingList organizationId="org-1" organizationName="Test Org" gig={TEST_GIG as any} />);
    await screen.findByText('amp');
    await user.click(screen.getByRole('button', { name: /columns/i }));
    await user.click(screen.getByLabelText('Notes'));
    unmount();
    await renderPackingListTab();
    await screen.findByText('amp');
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).not.toContain('Notes');
    localStorage.clear();
  });

  it('shows the columns it is given, and reports a change, so the page can print the same ones', async () => {
    (getPackingListReport as any).mockResolvedValue([unit('amp', 1, { status: 'Checked Out' })]);
    const onColumnsChange = vi.fn();
    const user = userEvent.setup();
    await renderPackingListTab({ columns: new Set(['status', 'location']), onColumnsChange } as any);
    await screen.findByText('amp');
    const headers = screen.getAllByRole('columnheader').map((h) => h.textContent);
    expect(headers).toEqual(['✓', 'Name', 'Tag #', 'Qty', 'Status', 'Location']);
    await user.click(screen.getByRole('button', { name: /columns/i }));
    await user.click(screen.getByLabelText('Location'));
    expect(onColumnsChange).toHaveBeenCalledWith(new Set(['status']));
  });
});

describe('PackingList: added at pack-out (#185)', () => {
  const ROWS: PackingListRow[] = [
    { kit_id: 'loose:gig-1', kit_name: 'Added at pack-out', is_container: false, kind: 'unit', asset_id: 'pd20', asset_name: 'PD-20',
      tag_number: 'DSL-0211', quantity: 1, packed: 1, group_kit_id: 'loose:gig-1', group_kit_name: 'Added at pack-out',
      group_is_container: false, group_tag_number: null, group_is_loose: true, ...blank, status: 'Checked Out' },
    { kit_id: 'kit-z', kit_name: 'Zoom Kit', is_container: false, kind: 'unit', asset_id: 'h6', asset_name: 'Zoom H6', tag_number: 'Z-1',
      quantity: 1, packed: 0, group_kit_id: 'kit-z', group_kit_name: 'Zoom Kit', group_is_container: false, group_tag_number: null,
      group_added_at_pack_out: true, ...blank },
    { kit_id: 'kit-b', kit_name: 'Backline', is_container: false, kind: 'unit', asset_id: 'amp', asset_name: 'Amp', tag_number: 'A-1',
      quantity: 1, packed: 0, group_kit_id: 'kit-b', group_kit_name: 'Backline', group_is_container: false, group_tag_number: null, ...blank },
  ];

  it('lists units and lots added on their own last, and says which kits were added at pack-out', async () => {
    (getPackingListReport as any).mockResolvedValue(ROWS);
    await renderPackingListTab();
    await screen.findByText('PD-20');
    expect(packingTree()).toEqual(['Backline (Items)', '  Amp', 'Zoom Kit (Items)', '  Zoom H6', 'Added at pack-out', '  PD-20']);
    const zoom = screen.getByText('Zoom Kit').closest('tr')!;
    expect(within(zoom).getByText('Added at pack-out')).toBeInTheDocument();
    const backline = screen.getByText('Backline').closest('tr')!;
    expect(within(backline).queryByText('Added at pack-out')).not.toBeInTheDocument();
  });
});

describe('ManifestReport — gig picker window (#109)', () => {
  const recent = { id: 'gig-1', title: 'Test Gig', start: '2026-07-12T19:00:00Z', timezone: 'America/Los_Angeles' };
  const old = { id: 'gig-old', title: 'Old Gig', start: '2025-01-10T19:00:00Z', timezone: 'America/Los_Angeles' };

  it('asks for the windowed list first and the full list when Show all gigs is checked', async () => {
    const picker = getGigsForReportPicker as any;
    picker.mockClear();
    picker.mockImplementation((_org: string, opts?: { showAll?: boolean }) =>
      Promise.resolve(opts?.showAll ? [recent, old] : [recent]));
    const user = userEvent.setup();
    render(<ManifestReport organizationId="org-1" organizationName="Test Org" />);
    await waitFor(() => expect(picker).toHaveBeenCalled());

    expect(picker).toHaveBeenLastCalledWith('org-1', { showAll: false });
    expect(screen.queryByRole('option', { name: 'Old Gig' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('checkbox', { name: 'Show all gigs' }));

    expect(picker).toHaveBeenLastCalledWith('org-1', { showAll: true });
    expect(await screen.findByRole('option', { name: 'Old Gig' })).toBeInTheDocument();
  });

  it('keeps the selected gig in the list after Show all gigs is unchecked', async () => {
    const picker = getGigsForReportPicker as any;
    picker.mockImplementation((_org: string, opts?: { showAll?: boolean }) =>
      Promise.resolve(opts?.showAll ? [recent, old] : [recent]));
    const user = userEvent.setup();
    render(<ManifestReport organizationId="org-1" organizationName="Test Org" />);
    await user.click(await screen.findByRole('checkbox', { name: 'Show all gigs' }));
    await user.click(await screen.findByRole('option', { name: 'Old Gig' }));

    await user.click(screen.getByRole('checkbox', { name: 'Show all gigs' }));

    await waitFor(() => expect(picker).toHaveBeenLastCalledWith('org-1', { showAll: false }));
    expect(screen.getByRole('option', { name: 'Old Gig' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Test Gig' })).toBeInTheDocument();
  });
});
