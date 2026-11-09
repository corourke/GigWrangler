import { renderWithQuery as render } from '../test/renderWithQuery';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast } from 'sonner';
import AttachmentManager from './AttachmentManager';
import { getAttachmentUrl } from '../services/attachment.service';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock('../services/attachment.service', () => ({
  uploadAttachment: vi.fn(),
  linkAttachmentToEntity: vi.fn(),
  unlinkAttachmentFromEntity: vi.fn(),
  getEntityAttachments: vi.fn().mockResolvedValue([
    { id: 'att-1', entity_attachment_id: 'ea-1', file_name: 'Stage plot.pdf', file_path: 'org-1/stage-plot.pdf', file_size: 2048, mime_type: 'application/pdf', created_at: '2026-09-28T00:00:00Z' },
  ]),
  getAttachmentUrl: vi.fn(),
}));

const SIGNED_URL = 'https://storage.example/signed/stage-plot.pdf?token=abc';

/** A tab as window.open returns it. */
const makeTab = () => ({ opener: window as unknown, location: { replace: vi.fn() }, close: vi.fn() });

// Browsers return null from window.open when the features ask for noopener,
// even though they do open the tab (HTML spec, "window open steps").
function browserLikeOpen(tab: ReturnType<typeof makeTab>) {
  return vi.fn((_url?: string | URL, _target?: string, features?: string) =>
    (features ?? '').includes('noopener') ? null : (tab as unknown as Window));
}

async function clickOpen() {
  const user = userEvent.setup();
  render(<AttachmentManager organizationId="org-1" entityType="gig" entityId="gig-1" />);
  await user.click(await screen.findByTitle('Open'));
}

describe('AttachmentManager: opening an attachment (#84)', () => {
  let openSpy: ReturnType<typeof browserLikeOpen>;
  let tab: ReturnType<typeof makeTab>;

  beforeEach(() => {
    vi.clearAllMocks();
    tab = makeTab();
    openSpy = browserLikeOpen(tab);
    vi.stubGlobal('open', openSpy);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('sends the tab it opened to the signed URL, cut off from this page', async () => {
    vi.mocked(getAttachmentUrl).mockResolvedValue(SIGNED_URL);
    await clickOpen();

    await waitFor(() => expect(tab.location.replace).toHaveBeenCalledWith(SIGNED_URL));
    expect(tab.opener).toBeNull();
    expect(openSpy).toHaveBeenCalledTimes(1);
    expect(getAttachmentUrl).toHaveBeenCalledWith('org-1/stage-plot.pdf');
  });

  it('closes the blank tab and says so when the file cannot be fetched', async () => {
    vi.mocked(getAttachmentUrl).mockRejectedValue(new Error('storage down'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await clickOpen();

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Failed to open attachment'));
    expect(tab.close).toHaveBeenCalled();
  });

  it('falls back to a link click when the browser blocks the tab', async () => {
    vi.stubGlobal('open', vi.fn(() => null));
    vi.mocked(getAttachmentUrl).mockResolvedValue(SIGNED_URL);
    const clicked: string[] = [];
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push(this.href);
    });
    await clickOpen();

    await waitFor(() => expect(clicked).toEqual([SIGNED_URL]));
    click.mockRestore();
  });
});
