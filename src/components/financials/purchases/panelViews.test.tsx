import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import { render } from '../testRender';
import AssetDetailView from './AssetDetailView';
import GigDetailView from './GigDetailView';
import DocumentDetailView from './DocumentDetailView';
import GigCombobox from './GigCombobox';
import { getAsset } from '../../../services/asset.service';
import { getGig, getGigFinancials, getGigOptionsForOrganization } from '../../../services/gig.service';
import { getEntityAttachments, getAttachmentUrl } from '../../../services/attachment.service';
import { toast } from 'sonner';

vi.mock('../../../services/asset.service', () => ({ getAsset: vi.fn() }));
vi.mock('../../../services/gig.service', () => ({ getGig: vi.fn(), getGigFinancials: vi.fn(), getGigOptionsForOrganization: vi.fn() }));
vi.mock('../../../services/attachment.service', () => ({ getEntityAttachments: vi.fn(), getAttachmentUrl: vi.fn() }));
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }) }));

const pending = <T,>() => {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
};

// A10 characterization: the Purchases side panel's views and the gig picker.
describe('Purchases side panel: loading (A10)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('equipment: a spinner, then its details; another record loads that one; a failure says why', async () => {
    const first = pending<any>();
    vi.mocked(getAsset).mockReturnValueOnce(first.promise);
    const { rerender } = render(<AssetDetailView assetId="a1" />);
    expect(screen.getByText('Loading asset details...')).toBeInTheDocument();
    first.resolve({ id: 'a1', manufacturer_model: 'First Model' });
    expect(await screen.findByText('First Model')).toBeInTheDocument();
    vi.mocked(getAsset).mockResolvedValueOnce({ id: 'a2', manufacturer_model: 'Second Model' } as any);
    rerender(<AssetDetailView assetId="a2" />);
    expect(await screen.findByText('Second Model')).toBeInTheDocument();
    vi.mocked(getAsset).mockRejectedValueOnce(new Error('No such record'));
    rerender(<AssetDetailView assetId="a3" />);
    expect(await screen.findByText('No such record')).toBeInTheDocument();
  });

  it('gig: a spinner, then the gig and its money rows; another gig loads that one; a failure says why', async () => {
    const first = pending<any>();
    vi.mocked(getGig).mockReturnValueOnce(first.promise);
    vi.mocked(getGigFinancials).mockResolvedValue([{ id: 'f1', type: 'Expense', amount: 12, paid_at: null }] as any);
    const { rerender } = render(<GigDetailView gigId="g1" organizationId="org-1" />);
    expect(screen.getByText('Loading gig details...')).toBeInTheDocument();
    first.resolve({ id: 'g1', title: 'First Gig', status: 'Booked' });
    expect(await screen.findByText('First Gig')).toBeInTheDocument();
    expect(screen.getByText('$12.00')).toBeInTheDocument();
    expect(getGigFinancials).toHaveBeenCalledWith('g1', 'org-1');
    vi.mocked(getGig).mockResolvedValueOnce({ id: 'g2', title: 'Second Gig' } as any);
    rerender(<GigDetailView gigId="g2" organizationId="org-1" />);
    expect(await screen.findByText('Second Gig')).toBeInTheDocument();
    vi.mocked(getGig).mockRejectedValueOnce(new Error('Gone'));
    rerender(<GigDetailView gigId="g3" organizationId="org-1" />);
    expect(await screen.findByText('Gone')).toBeInTheDocument();
  });

  it('document: the purchase\'s file opens; another purchase shows its own; a failure is reported', async () => {
    vi.mocked(getEntityAttachments).mockImplementation(async (_t: string, id: string) =>
      [{ id: `att-${id}`, file_name: `${id}.png`, file_path: `p/${id}.png` }] as any);
    vi.mocked(getAttachmentUrl).mockImplementation(async (path: string) => `https://files.test/${path}`);
    const { rerender } = render(<DocumentDetailView headerId="h1" />);
    expect(await screen.findByRole('img', { name: 'h1.png' })).toHaveAttribute('src', 'https://files.test/p/h1.png');
    rerender(<DocumentDetailView headerId="h2" />);
    expect(await screen.findByRole('img', { name: 'h2.png' })).toHaveAttribute('src', 'https://files.test/p/h2.png');
    vi.mocked(getEntityAttachments).mockRejectedValueOnce(new Error('offline'));
    rerender(<DocumentDetailView headerId="h3" />);
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Failed to load document'));
  });

  it('gig picker: lists the organization\'s gigs near the date, and the chosen one', async () => {
    vi.mocked(getGigOptionsForOrganization).mockResolvedValue([{ id: 'g1', title: 'Picked Gig', start: null }, { id: 'g2', title: 'Other Gig', start: null }] as any);
    const onChange = vi.fn();
    const { rerender } = render(<GigCombobox organizationId="org-1" value="g1" aroundDate="2026-01-02" onChange={onChange} />);
    expect(await screen.findByText('Picked Gig')).toBeInTheDocument();
    expect(getGigOptionsForOrganization).toHaveBeenCalledWith('org-1', { aroundDate: '2026-01-02', ensureGigId: 'g1' });
    rerender(<GigCombobox organizationId="org-2" value="g2" aroundDate="2026-01-02" onChange={onChange} />);
    expect(await screen.findByText('Other Gig')).toBeInTheDocument();
    expect(getGigOptionsForOrganization).toHaveBeenLastCalledWith('org-2', { aroundDate: '2026-01-02', ensureGigId: 'g2' });
    fireEvent.click(screen.getByRole('combobox'));
    fireEvent.click(await screen.findByText('Picked Gig'));
    expect(onChange).toHaveBeenCalledWith('g1', 'Picked Gig');
  });
});
