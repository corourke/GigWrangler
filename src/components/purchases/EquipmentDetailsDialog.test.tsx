import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import EquipmentDetailsDialog, { type EquipmentDetails } from './EquipmentDetailsDialog';
import { emptyItemDraft, type ItemOption } from '../equipment/form/itemDraft';

const getTypeUsage = vi.fn(async (_org: string, category: string) =>
  category === 'Power'
    ? [{ type: 'Distribution, PowerCon', count: 1 }, { type: 'Distribution, PowerCon Breakout', count: 1 }, { type: 'Conditioner, Rack', count: 2 }]
    : [{ type: 'Cable, XLR', count: 7 }]);
vi.mock('../../services/purchaseCategory.service', () => ({ getTypeUsage: (...a: any[]) => getTypeUsage(...(a as [string, string])) }));

const items: ItemOption[] = [
  { id: 'xlr25', manufacturer_model: 'XLR Cable, 25 ft', category: 'Audio', type: 'Cable, XLR' },
  { id: 'spot', manufacturer_model: 'Chauvet Intimidator Spot 360', category: 'Lighting' },
];
const start: EquipmentDetails = {
  item: emptyItemDraft({ manufacturer_model: 'PowerCON breakout box', category: 'Power' }),
  kind: 'units', units: [], replacement_value: '69.99', insured: false,
};

const open = (props: Partial<React.ComponentProps<typeof EquipmentDetailsDialog>> = {}) => {
  const onSave = vi.fn();
  const onOpenChange = vi.fn();
  render(
    <EquipmentDetailsDialog open onOpenChange={onOpenChange} organizationId="org-1" itemName="PowerCON breakout box"
      quantity={1} categories={['Audio', 'Lighting', 'Power']} items={items} value={start} onSave={onSave} {...props} />,
  );
  return { onSave, onOpenChange };
};
const dialog = () => within(screen.getByRole('dialog'));

describe('EquipmentDetailsDialog (#183)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('has the same three sections as Add Item, and no Kits field', () => {
    open();
    for (const name of ['What it is', 'Unit or lot', 'Insurance']) expect(dialog().getByRole('region', { name })).toBeInTheDocument();
    expect(dialog().queryByText('Kits')).not.toBeInTheDocument();
    expect(dialog().getByLabelText('Insurance Class')).toBeInTheDocument();
  });

  it('shows one serial/tag row per unit on the line; the quantity comes from the line', () => {
    open({ quantity: 6 });
    expect(dialog().getAllByLabelText(/^Serial number, unit/)).toHaveLength(6);
    expect(dialog().getByLabelText('Quantity')).toBeDisabled();
    expect(dialog().getByText('From the purchase line. Change it on the line.')).toBeInTheDocument();
    expect(dialog().getByText('Each, copied to all 6 units')).toBeInTheDocument();
  });

  it('Done saves the item, a serial or tag per unit, and the value; Cancel saves nothing', async () => {
    const ue = userEvent.setup();
    const { onSave } = open({ quantity: 2 });
    await ue.type(dialog().getByLabelText('Inventory tag, unit 1'), 'DSL-0141');
    await ue.type(dialog().getByLabelText('Serial number, unit 2'), 'IT2');
    await ue.click(dialog().getByRole('button', { name: 'Done' }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'units',
      units: [{ serial_number: '', tag_number: 'DSL-0141' }, { serial_number: 'IT2', tag_number: '' }],
      replacement_value: '69.99',
      item: expect.objectContaining({ mode: 'new', manufacturer_model: 'PowerCON breakout box', category: 'Power' }),
    }));
  });

  it('won’t finish while a unit has neither a serial nor a tag', async () => {
    const ue = userEvent.setup();
    const { onSave } = open({ quantity: 2 });
    await ue.type(dialog().getByLabelText('Inventory tag, unit 1'), 'DSL-0141');
    await ue.click(dialog().getByRole('button', { name: 'Done' }));
    expect(onSave).not.toHaveBeenCalled();
    expect(dialog().getByText('Unit 2 needs a serial number or a tag (either will do).')).toBeInTheDocument();
  });

  it('keeps a lot as a lot of the line’s quantity', async () => {
    const ue = userEvent.setup();
    const { onSave } = open({ quantity: 30 });
    await ue.click(dialog().getByRole('radio', { name: /Lot/ }));
    expect(dialog().getByLabelText('Quantity')).toHaveValue(30);
    await ue.click(dialog().getByRole('button', { name: 'Done' }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ kind: 'lot' }));
  });

  it('can use an item we already have', async () => {
    const ue = userEvent.setup();
    const { onSave } = open({ value: { ...start, kind: 'lot' } });
    await ue.click(dialog().getByRole('radio', { name: /An item we already have/ }));
    await ue.selectOptions(dialog().getByLabelText('Item'), 'xlr25');
    await ue.click(dialog().getByRole('button', { name: 'Done' }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ item: expect.objectContaining({ mode: 'existing', existing: items[0] }) }));
  });

  it('a used type is chosen from the keyboard: arrows move through the list, Enter picks (A19)', async () => {
    const ue = userEvent.setup();
    open();
    const field = dialog().getByRole('combobox', { name: 'Type' });
    await ue.click(field);
    const list = await screen.findByRole('listbox', { name: 'Types used in Power' });
    const [first, second] = within(list).getAllByRole('option');
    await ue.keyboard('{ArrowDown}');
    expect(field).toHaveAttribute('aria-activedescendant', first.id);
    await ue.keyboard('{ArrowDown}');
    expect(field).toHaveAttribute('aria-activedescendant', second.id);
    const chosen = second.querySelector('span')!.textContent!;
    await ue.keyboard('{Enter}');
    expect(field).toHaveValue(chosen);
    expect(screen.queryByRole('listbox', { name: 'Types used in Power' })).not.toBeInTheDocument();
  });

  it('suggests the types used in the item’s category', async () => {
    const ue = userEvent.setup();
    open();
    await ue.click(dialog().getByRole('combobox', { name: 'Type' }));
    const list = await screen.findByRole('listbox', { name: 'Types used in Power' });
    expect(within(list).getAllByRole('option')).toHaveLength(3);
  });

  it('a saved line keeps its item and its units, and adds rows for more', () => {
    open({
      saved: true, quantity: 3,
      value: { ...start, item: emptyItemDraft({ mode: 'existing', existing: items[1] }),
        units: [{ id: 'u1', serial_number: 'S1', tag_number: '' }, { id: 'u2', serial_number: '', tag_number: 'T2' }] },
    });
    expect(dialog().getByText('Chauvet Intimidator Spot 360')).toBeInTheDocument();
    expect(dialog().queryByRole('button', { name: 'Change item' })).not.toBeInTheDocument();
    expect(dialog().getByLabelText('Serial number, unit 1')).toHaveValue('S1');
    expect(dialog().getByLabelText('Inventory tag, unit 2')).toHaveValue('T2');
    expect(dialog().getByLabelText('Serial number, unit 3')).toHaveValue('');
  });

  it('a saved line keeps Unit or Lot as saved', () => {
    open({ saved: true, quantity: 2, value: { ...start, units: [{ id: 'u1', serial_number: 'S1', tag_number: '' }, { id: 'u2', serial_number: 'S2', tag_number: '' }] } });
    expect(dialog().getByRole('radio', { name: /Lot/ })).toBeDisabled();
  });

  it('a long item name truncates instead of widening the pop-up', () => {
    open({ itemName: 'A very long item name '.repeat(10) });
    expect(screen.getByText(/A very long item name/)).toHaveClass('truncate');
  });

  describe('recovery period (#125)', () => {
    it('is not asked for an expensed line', () => {
      open();
      expect(dialog().queryByLabelText('Recovery period')).not.toBeInTheDocument();
    });

    it('a depreciated line shows its category’s default', () => {
      open({ depreciated: true, categoryPeriods: { power: 7 } as any });
      expect(dialog().getByLabelText('Recovery period')).toHaveValue('7');
      expect(dialog().getByText('The default for Power. Shown because the line is depreciated.')).toBeInTheDocument();
    });

    it('asks when the category has no default, and Done waits for an answer', async () => {
      const ue = userEvent.setup();
      const { onSave } = open({ depreciated: true, value: { ...start, kind: 'lot' } });
      expect(dialog().getByRole('button', { name: 'Done' })).toBeDisabled();
      await ue.selectOptions(dialog().getByLabelText('Recovery period'), '5');
      await ue.click(dialog().getByRole('button', { name: 'Done' }));
      expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ recovery_period: 5 }));
    });

    it('a filed year keeps its period', () => {
      open({ depreciated: true, periodLocked: true, value: { ...start, recovery_period: 5 } });
      expect(dialog().getByLabelText('Recovery period')).toBeDisabled();
    });
  });
});
