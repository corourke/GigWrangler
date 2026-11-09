import { renderWithQuery as render } from '../../../test/renderWithQuery';
import { describe, it, expect, vi } from 'vitest';
import { useState } from 'react';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import UnitOrLotSection, { type FormUnitRow, type UnitOrLot } from './UnitOrLotSection';
import ItemSection from './ItemSection';
import { emptyItemDraft, type ItemDraft, type ItemOption } from './itemDraft';
import InsuranceSection from './InsuranceSection';
import { unitRowProblems } from '../../../utils/lineUnits';

vi.mock('../../../services/purchaseCategory.service', () => ({
  getTypeUsage: vi.fn().mockResolvedValue([{ type: 'Speaker, Powered', count: 4 }]),
}));

function Units({ start = 1, locked = false, initial }: { start?: number; locked?: boolean; initial?: FormUnitRow[] }) {
  const [kind, setKind] = useState<UnitOrLot>('units');
  const [qty, setQty] = useState(start);
  const [rows, setRows] = useState<FormUnitRow[]>(initial ?? Array.from({ length: start }, () => ({ serial_number: '', tag_number: '' })));
  return (
    <>
      <UnitOrLotSection kind={kind} onKindChange={setKind} quantity={qty} onQuantityChange={setQty} quantityLocked={locked}
        rows={rows} onRowsChange={setRows} problems={unitRowProblems(rows)} />
      <output data-testid="rows">{JSON.stringify(rows)}</output>
    </>
  );
}
const rowsOut = () => JSON.parse(screen.getByTestId('rows').textContent!) as FormUnitRow[];

describe('UnitOrLotSection (#183)', () => {
  it('shows one serial/tag row per unit, following the quantity', async () => {
    const ue = userEvent.setup();
    render(<Units />);
    const qty = screen.getByLabelText('Quantity');
    await ue.clear(qty);
    await ue.type(qty, '4');
    expect(screen.getAllByLabelText(/^Serial number, unit/)).toHaveLength(4);
    expect(screen.getByText('4 units')).toBeInTheDocument();
  });

  it('names a unit with neither a serial nor a tag', () => {
    render(<Units start={2} initial={[{ serial_number: 'A', tag_number: '' }, { serial_number: '', tag_number: '' }]} />);
    expect(screen.getByText('Unit 2 needs a serial number or a tag (either will do).')).toBeInTheDocument();
  });

  it('numbers tags in sequence from the first one', async () => {
    const ue = userEvent.setup();
    render(<Units start={3} />);
    await ue.click(screen.getByRole('button', { name: 'Number tags' }));
    await ue.type(screen.getByLabelText('First tag'), 'DSL-0141');
    await ue.click(screen.getByRole('button', { name: 'Number 3 tags' }));
    expect(rowsOut().map((r) => r.tag_number)).toEqual(['DSL-0141', 'DSL-0142', 'DSL-0143']);
  });

  it('fills serials pasted as a column', async () => {
    const ue = userEvent.setup();
    render(<Units start={2} />);
    await ue.click(screen.getByRole('button', { name: 'Paste serials' }));
    await ue.type(screen.getByLabelText('Serial numbers'), 'IT1{enter}IT2');
    await ue.click(screen.getByRole('button', { name: 'Fill serials' }));
    expect(rowsOut().map((r) => r.serial_number)).toEqual(['IT1', 'IT2']);
  });

  it('takes scans: Enter moves to the next unit’s serial', async () => {
    const ue = userEvent.setup();
    render(<Units start={2} />);
    await ue.click(screen.getByRole('button', { name: /Scan/ }));
    expect(screen.getByLabelText('Serial number, unit 1')).toHaveFocus();
    await ue.keyboard('SN1{Enter}SN2{Enter}');
    expect(rowsOut().map((r) => r.serial_number)).toEqual(['SN1', 'SN2']);
  });

  it('a lot has a quantity and no serial or tag', async () => {
    const ue = userEvent.setup();
    render(<Units />);
    await ue.click(screen.getByRole('radio', { name: /Lot/ }));
    expect(screen.getByLabelText('Serial Number')).toBeDisabled();
    expect(screen.getByLabelText('Inventory Tag ID')).toBeDisabled();
    expect(screen.queryByLabelText(/^Serial number/)).not.toBeInTheDocument();
  });

  it('a quantity set elsewhere can’t be changed here', () => {
    render(<Units start={6} locked />);
    expect(screen.getByLabelText('Quantity')).toBeDisabled();
  });
});

const items: ItemOption[] = [
  { id: 'trio', manufacturer_model: 'Chauvet Intimidator Spot 360', category: 'Lighting', type: 'Light Fixture, Moving Head' },
  { id: 'k12', manufacturer_model: 'QSC K12.2', category: 'Audio', type: 'Speaker, Powered', insurance_class: 'Class B' },
];
function Item({ initial = emptyItemDraft(), fixed = false }: { initial?: ItemDraft; fixed?: boolean }) {
  const [d, setD] = useState(initial);
  return (
    <>
      <ItemSection organizationId="org-1" value={d} onChange={setD} categories={['Audio', 'Lighting']} items={items} fixed={fixed} />
      <output data-testid="draft">{JSON.stringify(d)}</output>
    </>
  );
}
const draftOut = () => JSON.parse(screen.getByTestId('draft').textContent!) as ItemDraft;

describe('ItemSection (#183)', () => {
  it('a new item takes its model, category, type, insurance class and description', async () => {
    const ue = userEvent.setup();
    render(<Item />);
    await ue.type(screen.getByLabelText(/Manufacturer and Model/), 'Shure ULXD2');
    await ue.selectOptions(screen.getByLabelText(/Category/), 'Audio');
    await ue.type(screen.getByLabelText('Insurance Class'), 'Class B');
    await ue.type(screen.getByLabelText('Description'), 'Handheld');
    expect(draftOut()).toMatchObject({ mode: 'new', manufacturer_model: 'Shure ULXD2', category: 'Audio', insurance_class: 'Class B', description: 'Handheld' });
  });

  it('suggests close items we already have, and picking one uses it', async () => {
    const ue = userEvent.setup();
    render(<Item />);
    await ue.type(screen.getByLabelText(/Manufacturer and Model/), 'Chauvet Intimidator Trio');
    const hint = screen.getByText(/Close to items you already have/);
    await ue.click(within(hint).getByRole('button', { name: 'Chauvet Intimidator Spot 360' }));
    expect(draftOut()).toMatchObject({ mode: 'existing', existing: { id: 'trio' } });
  });

  it('picks an item we already have', async () => {
    const ue = userEvent.setup();
    render(<Item />);
    await ue.click(screen.getByRole('radio', { name: /An item we already have/ }));
    await ue.selectOptions(screen.getByLabelText('Item'), 'k12');
    expect(draftOut()).toMatchObject({ mode: 'existing', existing: { id: 'k12' } });
  });

  it('a fixed item shows as a box, with Change item', async () => {
    const ue = userEvent.setup();
    render(<Item fixed initial={emptyItemDraft({ mode: 'existing', existing: items[1] })} />);
    expect(screen.getByText('QSC K12.2')).toBeInTheDocument();
    expect(screen.getByText('Audio · Speaker, Powered · Class B')).toBeInTheDocument();
    await ue.click(screen.getByRole('button', { name: 'Change item' }));
    expect(screen.getByLabelText('Item')).toBeInTheDocument();
  });
});

describe('InsuranceSection (#183)', () => {
  it('says the value is copied to each unit', () => {
    render(<InsuranceSection replacementValue="1099" onReplacementValueChange={() => {}} insured={false} onInsuredChange={() => {}} count={4} />);
    expect(screen.getByText('Each, copied to all 4 units')).toBeInTheDocument();
    expect(screen.getByLabelText('These units have been added to an insurance policy.')).toBeInTheDocument();
  });
});
