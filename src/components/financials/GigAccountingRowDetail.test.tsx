import { renderWithQuery as render } from '../../test/renderWithQuery';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen } from '@testing-library/react';
import GigAccountingRowDetail from './GigAccountingRowDetail';
import { getGigFinancials } from '../../services/gig.service';

vi.mock('../../services/gig.service', () => ({ getGigFinancials: vi.fn() }));

const gig = { gigId: 'gig-1' } as any;
const renderIn = () => render(<table><tbody><GigAccountingRowDetail gig={gig} organizationId="org-1" /></tbody></table>);

describe('GigAccountingRowDetail: paid dates (B17)', () => {
  let originalTZ: string | undefined;
  beforeEach(() => { originalTZ = process.env.TZ; process.env.TZ = 'America/Los_Angeles'; });
  afterEach(() => { process.env.TZ = originalTZ; });

  it('shows the paid day as entered, wherever the viewer is', async () => {
    vi.mocked(getGigFinancials).mockResolvedValue([
      { id: 'f1', direction: 'in', stage: 'paid', amount: 500, amount_settled: 500, date: '2025-12-30',
        paid_at: '2026-01-01T00:00:00+00:00', description: 'Balance' },
    ] as any);
    renderIn();
    expect(await screen.findByText(/Jan 1, 2026/)).toBeInTheDocument();
    expect(screen.queryByText(/Dec 31, 2025/)).not.toBeInTheDocument();
  });
});

// Round C: amounts show cents, like the rest of the money screens.
describe('GigAccountingRowDetail: amounts', () => {
  it('shows cents', async () => {
    vi.mocked(getGigFinancials).mockResolvedValue([
      { id: 'f1', direction: 'in', stage: 'paid', amount: 123.45, amount_settled: 123.45, date: '2026-03-02',
        paid_at: '2026-03-02T12:00:00+00:00', description: 'Deposit' },
      { id: 'f2', direction: 'out', stage: 'accepted', amount: 40.5, amount_settled: null, date: '2026-03-03', description: 'Cables' },
    ] as any);
    renderIn();
    expect((await screen.findAllByText(/\$123\.45/)).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/\$40\.50/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/\$123(?!\.)/)).not.toBeInTheDocument();
  });
});
