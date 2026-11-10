import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ScanInvoiceTab from './ScanInvoiceTab';
import type { ScanQueue } from './useScanQueue';

vi.mock('../../../services/purchaseScanQueue.service', () => ({
  getQueuedInvoiceFile: vi.fn(async () => new File(['x'], 'r.jpg', { type: 'image/jpeg' })),
}));
vi.mock('../../ReviewScannedDataDialog', () => ({
  default: ({ gigId }: any) => <div data-testid="purchase-form">gig: {gigId ?? 'none'}</div>,
}));

const ready = (over: Record<string, unknown> = {}) => ({
  id: 'q1', organization_id: 'org-1', attachment_id: 'att-1', file_name: 'r.jpg', status: 'ready',
  scanned_data: { vendor: 'Store' }, error: null, created_at: '', updated_at: '', gig_id: null, gigs: null, ...over,
});

const queueWith = (items: any[]): ScanQueue => ({
  items, loaded: true, uploading: 0,
  counts: { ready: items.length, scanning: 0, queued: 0, failed: 0 },
  addFiles: vi.fn(), retry: vi.fn(), discard: vi.fn(), saved: vi.fn(),
} as any);

describe('ScanInvoiceTab: receipts captured on a gig (mobile)', () => {
  it('reviews the receipt as a cost of its gig, and can be unlinked', () => {
    render(<ScanInvoiceTab organizationId="org-1" onSaved={vi.fn()}
      queue={queueWith([ready({ gig_id: 'gig-1', gigs: { title: 'Spring Show' } })])} />);
    expect(screen.getByTestId('purchase-form')).toHaveTextContent('gig: gig-1');
    const link = screen.getByRole('checkbox', { name: /Add to the costs of Spring Show/ });
    expect(link).toBeChecked();
    fireEvent.click(link);
    expect(screen.getByTestId('purchase-form')).toHaveTextContent('gig: none');
  });

  it('a receipt without a gig reviews as before', () => {
    render(<ScanInvoiceTab organizationId="org-1" onSaved={vi.fn()} queue={queueWith([ready()])} />);
    expect(screen.getByTestId('purchase-form')).toHaveTextContent('gig: none');
    expect(screen.queryByRole('checkbox', { name: /Add to the costs of/ })).not.toBeInTheDocument();
  });

  it('names the gig on a queue row captured on a gig, so same-named files can be told apart', () => {
    const queued = (id: string, over: Record<string, unknown> = {}) =>
      ready({ id, status: 'queued', scanned_data: null, file_name: 'image.jpg', ...over });
    const queue = queueWith([queued('q1', { gig_id: 'gig-1', gigs: { title: 'Spring Show' } }), queued('q2')]);
    queue.counts = { ready: 0, scanning: 0, queued: 2, failed: 0 };
    render(<ScanInvoiceTab organizationId="org-1" onSaved={vi.fn()} queue={queue} />);
    const rows = screen.getAllByRole('listitem');
    expect(rows[0]).toHaveTextContent('image.jpg for Spring Show');
    expect(rows[1]).not.toHaveTextContent(' for ');
  });
});
