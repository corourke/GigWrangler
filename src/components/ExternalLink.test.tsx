import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import ExternalLink from './ExternalLink';
import OrganizationDetailsDialog from './gig/view/OrganizationDetailsDialog';

describe('ExternalLink', () => {
  it('links an http(s) address, in a new tab without an opener', () => {
    render(<ExternalLink url="https://example.com/a" />);
    const a = screen.getByRole('link', { name: 'https://example.com/a' });
    expect(a).toHaveAttribute('href', 'https://example.com/a');
    expect(a).toHaveAttribute('target', '_blank');
    expect(a).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('shows anything else as text, not a link', () => {
    render(<ExternalLink url="javascript:alert(1)" />);
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.getByText('javascript:alert(1)')).toBeInTheDocument();
  });

  it('shows its own label when given one', () => {
    render(<ExternalLink url="https://example.com" label="example.com" />);
    expect(screen.getByRole('link', { name: 'example.com' })).toHaveAttribute('href', 'https://example.com/');
  });
});

describe('a stored organization website', () => {
  it('is a link only when it is http(s)', () => {
    const { rerender } = render(<OrganizationDetailsDialog organization={{ name: 'Org', url: 'https://example.com' }} onClose={() => {}} />);
    expect(screen.getByRole('link', { name: 'https://example.com' })).toHaveAttribute('href', 'https://example.com/');
    rerender(<OrganizationDetailsDialog organization={{ name: 'Org', url: 'javascript:alert(1)' }} onClose={() => {}} />);
    expect(screen.queryByRole('link', { name: /javascript/ })).not.toBeInTheDocument();
    expect(screen.getByText('javascript:alert(1)')).toBeInTheDocument();
  });
});
