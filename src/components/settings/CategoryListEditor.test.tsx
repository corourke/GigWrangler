import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CategoryListEditor, { TypeWritingRules } from './CategoryListEditor';
import * as svc from '../../services/purchaseCategory.service';

vi.mock('../../services/purchaseCategory.service', () => ({
  listCategories: vi.fn(),
  addCategory: vi.fn(async (_k: string, org: string | null, f: any) => ({ id: 'new', organization_id: org, active: true, ...f })),
  updateCategory: vi.fn(async () => {}),
  getScheduleCLines: vi.fn(async () => [{ code: '22', label: 'Supplies' }, { code: '27b', label: 'Other expenses (Part V)' }]),
  getCategoryUsage: vi.fn(async () => ({ supplies: 3 })),
}));

const expenseRows = [
  { id: 'e1', organization_id: 'org-1', name: 'Supplies', schedule_c_line: '22', sort_order: 10, active: true },
  { id: 'e2', organization_id: 'org-1', name: 'Training', schedule_c_line: '27b', sort_order: 20, active: false },
];

describe('CategoryListEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(svc.listCategories).mockResolvedValue(expenseRows as any);
  });

  it('lists the categories with their Schedule C line, use and on/off state', async () => {
    render(<CategoryListEditor kind="expense" organizationId="org-1" canEdit />);
    expect(await screen.findByDisplayValue('Supplies')).toBeInTheDocument();
    expect((screen.getByRole('combobox', { name: 'Schedule C line: Training' }) as HTMLSelectElement).value).toBe('27b');
    expect(screen.getByRole('switch', { name: 'Use Supplies' })).toBeChecked();
    expect(screen.getByRole('switch', { name: 'Use Training' })).not.toBeChecked();
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('a category in use can\'t be renamed; an unused one can', async () => {
    render(<CategoryListEditor kind="expense" organizationId="org-1" canEdit />);
    const supplies = await screen.findByRole('textbox', { name: 'Name: Supplies' });
    expect(supplies).toBeDisabled();
    const training = screen.getByRole('textbox', { name: 'Name: Training' });
    await userEvent.clear(training);
    await userEvent.type(training, 'Training and education');
    await userEvent.tab();
    expect(svc.updateCategory).toHaveBeenCalledWith('expense', 'e2', { name: 'Training and education' });
  });

  it('turns a category off and on', async () => {
    render(<CategoryListEditor kind="expense" organizationId="org-1" canEdit />);
    await userEvent.click(await screen.findByRole('switch', { name: 'Use Supplies' }));
    expect(svc.updateCategory).toHaveBeenCalledWith('expense', 'e1', { active: false });
  });

  it('adds a category at the end, with its line', async () => {
    render(<CategoryListEditor kind="expense" organizationId="org-1" canEdit />);
    await userEvent.type(await screen.findByRole('textbox', { name: 'New category name' }), 'Postage');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'New category Schedule C line' }), '27b');
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(svc.addCategory).toHaveBeenCalledWith('expense', 'org-1', { name: 'Postage', schedule_c_line: '27b', sort_order: 30 }));
    expect(await screen.findByDisplayValue('Postage')).toBeInTheDocument();
  });

  it('offers line 4, cost of goods sold, when the lines include it (#321)', async () => {
    vi.mocked(svc.getScheduleCLines).mockResolvedValueOnce([
      { code: '4', label: 'Cost of goods sold (Part III)' }, { code: '22', label: 'Supplies' },
    ]);
    render(<CategoryListEditor kind="expense" organizationId="org-1" canEdit />);
    const pick = await screen.findByRole('combobox', { name: 'New category Schedule C line' });
    await waitFor(() => expect(within(pick).getByRole('option', { name: '4: Cost of goods sold (Part III)' })).toBeInTheDocument());
    await userEvent.type(screen.getByRole('textbox', { name: 'New category name' }), 'Cost of goods sold (resale)');
    await userEvent.selectOptions(pick, '4');
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(svc.addCategory).toHaveBeenCalledWith('expense', 'org-1', { name: 'Cost of goods sold (resale)', schedule_c_line: '4', sort_order: 30 }));
  });

  it('is read-only without edit rights', async () => {
    render(<CategoryListEditor kind="expense" organizationId="org-1" canEdit={false} />);
    expect(await screen.findByRole('textbox', { name: 'Name: Training' })).toBeDisabled();
    expect(screen.getByRole('switch', { name: 'Use Training' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Add' })).not.toBeInTheDocument();
  });

  it('equipment categories come with the rules for writing types, and no Schedule C line', async () => {
    vi.mocked(svc.listCategories).mockResolvedValue([{ id: 'q1', organization_id: 'org-1', name: 'Audio', sort_order: 10, active: true }] as any);
    render(<CategoryListEditor kind="equipment" organizationId="org-1" canEdit />);
    expect(await screen.findByDisplayValue('Audio')).toBeInTheDocument();
    expect(screen.getByText('How the types are written')).toBeInTheDocument();
    expect(screen.getByText(/The first word says what it is/)).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: /Schedule C line/ })).not.toBeInTheDocument();
  });

  it('equipment categories have a default recovery period; blank means ask (#125)', async () => {
    vi.mocked(svc.listCategories).mockResolvedValue([
      { id: 'q1', organization_id: 'org-1', name: 'Audio', default_recovery_period: 7, sort_order: 10, active: true },
      { id: 'q2', organization_id: 'org-1', name: 'Networking', default_recovery_period: null, sort_order: 20, active: true },
    ] as any);
    render(<CategoryListEditor kind="equipment" organizationId="org-1" canEdit />);
    const audio = await screen.findByRole('combobox', { name: 'Recovery period: Audio' }) as HTMLSelectElement;
    expect(audio.value).toBe('7');
    const networking = screen.getByRole('combobox', { name: 'Recovery period: Networking' }) as HTMLSelectElement;
    expect(networking.value).toBe('');
    await userEvent.selectOptions(networking, '5');
    expect(svc.updateCategory).toHaveBeenCalledWith('equipment', 'q2', { default_recovery_period: 5 });
    await userEvent.selectOptions(audio, '');
    expect(svc.updateCategory).toHaveBeenCalledWith('equipment', 'q1', { default_recovery_period: null });

    await userEvent.type(screen.getByRole('textbox', { name: 'New category name' }), 'Computers');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'New category recovery period' }), '5');
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(svc.addCategory).toHaveBeenCalledWith('equipment', 'org-1', { name: 'Computers', default_recovery_period: 5, sort_order: 30 }));
  });

  it('the starter set has no usage counts', async () => {
    render(<CategoryListEditor kind="expense" organizationId={null} canEdit />);
    await screen.findByDisplayValue('Supplies');
    expect(svc.listCategories).toHaveBeenCalledWith('expense', null);
    expect(svc.getCategoryUsage).not.toHaveBeenCalled();
    expect(screen.getByRole('textbox', { name: 'Name: Supplies' })).toBeEnabled();
  });

  it('the type rules describe the suggestions the app already gives (issue #188)', () => {
    render(<TypeWritingRules />);
    expect(screen.getByText(/suggests the types already used in that category/i)).toBeInTheDocument();
    expect(screen.queryByText(/will offer/i)).not.toBeInTheDocument();
  });
});
