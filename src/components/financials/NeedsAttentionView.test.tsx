import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import NeedsAttentionView from './NeedsAttentionView';
import type { NeedsAttentionReport } from '../../utils/taxSummaryReports';

const report = (key: 'no-cost' | 'no-category'): NeedsAttentionReport => ({
  total: 1,
  groups: [{ key, title: key === 'no-cost' ? 'Equipment with no cost' : 'Expensed with no expense category',
    rows: [{ id: 'a1', item: 'Gift mic', date: '2026-06-01', amount: null, problem: 'No cost', assetId: 'a1' }] }],
});

describe('Needs attention: equipment with no cost (11-03)', () => {
  it('tells the user a truly free item can be set to $0 to clear it', () => {
    render(<NeedsAttentionView report={report('no-cost')} year={2026} />);
    expect(screen.getByText(/If an item really cost nothing, set its cost to \$0/)).toBeInTheDocument();
  });

  it('says so only under that group', () => {
    render(<NeedsAttentionView report={report('no-category')} year={2026} />);
    expect(screen.queryByText(/set its cost to \$0/)).not.toBeInTheDocument();
  });
});
