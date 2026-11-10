import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithQuery as render } from '../../../test/renderWithQuery';
import CaptureReceiptButton from './CaptureReceiptButton';

const auth = vi.hoisted(() => ({ role: 'Admin' as string | undefined }));
vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ selectedOrganization: { id: 'org-1' }, user: { id: 'user-1' }, userRole: auth.role }),
}));
vi.mock('./ReceiptCaptureSheet', () => ({
  default: ({ open, gigId }: any) => (open ? <div role="dialog">Capture sheet {gigId ?? 'no gig'}</div> : null),
}));

beforeEach(() => { auth.role = 'Admin'; });

describe('CaptureReceiptButton', () => {
  it.each(['Admin', 'Manager'])('%s sees it, and it opens the capture sheet', async (role) => {
    auth.role = role;
    render(<CaptureReceiptButton />);
    fireEvent.click(screen.getByRole('button', { name: 'Capture receipt' }));
    expect(await screen.findByRole('dialog')).toHaveTextContent('Capture sheet no gig');
  });

  it.each(['Staff', 'Viewer', undefined])('%s does not see it', (role) => {
    auth.role = role;
    render(<CaptureReceiptButton />);
    expect(screen.queryByRole('button', { name: /Capture receipt/ })).not.toBeInTheDocument();
  });

  it('on a gig, captures for that gig', async () => {
    render(<CaptureReceiptButton gigId="gig-1" gigTitle="Spring Show" />);
    fireEvent.click(screen.getByRole('button', { name: 'Capture receipt for this gig' }));
    expect(await screen.findByRole('dialog')).toHaveTextContent('Capture sheet gig-1');
  });
});
