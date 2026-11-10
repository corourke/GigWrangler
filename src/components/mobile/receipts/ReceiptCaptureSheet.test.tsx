import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, fireEvent, within } from '@testing-library/react';
import { renderWithQuery as render } from '../../../test/renderWithQuery';
import ReceiptCaptureSheet from './ReceiptCaptureSheet';
import { enqueueInvoice, scanQueuedInvoice, listMyRecentReceipts, discardQueuedInvoice } from '../../../services/purchaseScanQueue.service';
import { prepareReceiptFile } from '../../../utils/receiptImage';
import { toast } from 'sonner';

vi.mock('../../../services/purchaseScanQueue.service', () => ({
  enqueueInvoice: vi.fn(),
  scanQueuedInvoice: vi.fn(),
  listMyRecentReceipts: vi.fn(),
  discardQueuedInvoice: vi.fn(),
}));
vi.mock('../../../utils/receiptImage', () => ({ prepareReceiptFile: vi.fn(async (f: File) => f) }));
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));

const offline = vi.hoisted(() => ({ value: false }));
vi.mock('../useIsOffline', () => ({ useIsOffline: () => offline.value }));

const item = (over: Record<string, unknown> = {}) => ({
  id: 'q1', organization_id: 'org-1', attachment_id: 'att-1', file_name: 'receipt-1.jpg', status: 'queued',
  scanned_data: null, error: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  gig_id: null, created_by: 'user-1', gigs: null, ...over,
});

const props = { open: true, onOpenChange: vi.fn(), organizationId: 'org-1', userId: 'user-1' };
const photo = (name = 'IMG_1.jpg') => new File(['x'], name, { type: 'image/jpeg' });

beforeEach(() => {
  vi.clearAllMocks();
  offline.value = false;
  vi.mocked(listMyRecentReceipts).mockResolvedValue([]);
  vi.mocked(enqueueInvoice).mockImplementation(async (_org, file: File, gigId?: string) => item({ id: `q-${file.name}`, file_name: file.name, gig_id: gigId ?? null }) as any);
  vi.mocked(scanQueuedInvoice).mockResolvedValue({});
});

describe('ReceiptCaptureSheet', () => {
  it('opens the camera, offering only what the scan reads, and lets you choose several files', () => {
    render(<ReceiptCaptureSheet {...props} />);
    const camera = screen.getByTestId('receipt-camera-input');
    expect(camera).toHaveAttribute('accept', 'image/jpeg,image/png,image/webp,image/gif,application/pdf');
    expect(camera).toHaveAttribute('capture', 'environment');
    const picker = screen.getByTestId('receipt-file-input');
    expect(picker).toHaveAttribute('multiple');
    expect(picker).not.toHaveAttribute('capture');
  });

  it('prepares each photo, queues it and starts its scan; then says Queued', async () => {
    render(<ReceiptCaptureSheet {...props} />);
    fireEvent.change(screen.getByTestId('receipt-file-input'), { target: { files: [photo('a.jpg'), photo('b.jpg')] } });
    expect(await screen.findByText('Queued 2 receipts')).toBeInTheDocument();
    expect(prepareReceiptFile).toHaveBeenCalledTimes(2);
    expect(enqueueInvoice).toHaveBeenCalledWith('org-1', expect.objectContaining({ name: 'a.jpg' }), undefined);
    expect(scanQueuedInvoice).toHaveBeenCalledWith('q-a.jpg');
    expect(scanQueuedInvoice).toHaveBeenCalledWith('q-b.jpg');
  });

  it('on a gig, queues the receipt with the gig', async () => {
    render(<ReceiptCaptureSheet {...props} gigId="gig-1" gigTitle="Spring Show" />);
    expect(screen.getByText(/as a cost of Spring Show/)).toBeInTheDocument();
    fireEvent.change(screen.getByTestId('receipt-camera-input'), { target: { files: [photo()] } });
    expect(await screen.findByText('Queued 1 receipt')).toBeInTheDocument();
    expect(enqueueInvoice).toHaveBeenCalledWith('org-1', expect.anything(), 'gig-1');
  });

  it('a scan that fails to start still leaves the receipt queued', async () => {
    vi.mocked(scanQueuedInvoice).mockRejectedValueOnce(new Error('Scan failed'));
    render(<ReceiptCaptureSheet {...props} />);
    fireEvent.change(screen.getByTestId('receipt-file-input'), { target: { files: [photo()] } });
    expect(await screen.findByText('Queued 1 receipt')).toBeInTheDocument();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('says which file could not be added and queues the rest', async () => {
    vi.mocked(prepareReceiptFile).mockRejectedValueOnce(new Error("notes.docx isn't a photo or a PDF."));
    render(<ReceiptCaptureSheet {...props} />);
    fireEvent.change(screen.getByTestId('receipt-file-input'), { target: { files: [new File(['x'], 'notes.docx'), photo()] } });
    expect(await screen.findByText('Queued 1 receipt')).toBeInTheDocument();
    expect(toast.error).toHaveBeenCalledWith("notes.docx isn't a photo or a PDF.");
    expect(enqueueInvoice).toHaveBeenCalledTimes(1);
  });

  it('lists what I queued in the last 7 days, with the gig and status, and no review', async () => {
    vi.mocked(listMyRecentReceipts).mockResolvedValue([
      item({ id: 'q1', file_name: 'r1.jpg', status: 'ready', gig_id: 'gig-1', gigs: { title: 'Spring Show' } }),
      item({ id: 'q2', file_name: 'r2.jpg', status: 'scanning' }),
      item({ id: 'q3', file_name: 'r3.jpg', status: 'failed', error: 'Unreadable' }),
    ] as any);
    render(<ReceiptCaptureSheet {...props} />);
    const list = await screen.findByRole('list', { name: 'Receipts queued in the last 7 days' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows).toHaveLength(3);
    expect(within(rows[0]).getByText('Ready to review on desktop')).toBeInTheDocument();
    expect(within(rows[0]).getByText(/Spring Show/)).toBeInTheDocument();
    expect(within(rows[1]).getByText('Scanning…')).toBeInTheDocument();
    expect(within(rows[2]).getByText('Failed')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /review/i })).not.toBeInTheDocument();
    expect(listMyRecentReceipts).toHaveBeenCalledWith('org-1', 'user-1');
  });

  it('removes a mistaken receipt after confirming, but not one being scanned', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    vi.mocked(discardQueuedInvoice).mockResolvedValue(undefined);
    vi.mocked(listMyRecentReceipts).mockResolvedValue([
      item({ id: 'q1', file_name: 'r1.jpg', status: 'queued' }),
      item({ id: 'q2', file_name: 'r2.jpg', status: 'scanning' }),
    ] as any);
    render(<ReceiptCaptureSheet {...props} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Remove r1.jpg' }));
    expect(screen.queryByRole('button', { name: 'Remove r2.jpg' })).not.toBeInTheDocument();
    await waitFor(() => expect(discardQueuedInvoice).toHaveBeenCalledWith(expect.objectContaining({ attachment_id: 'att-1' })));
  });

  it('offline: says so and turns the buttons off', () => {
    offline.value = true;
    render(<ReceiptCaptureSheet {...props} />);
    expect(screen.getByText("You're offline. Connect to send receipts.")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Take photo/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Choose file/ })).toBeDisabled();
  });
});
