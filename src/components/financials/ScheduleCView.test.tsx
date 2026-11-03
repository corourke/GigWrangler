import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import ScheduleCView from './ScheduleCView';
import type { ScheduleCSummary } from '../../utils/taxSummaryReports';
import type { Line13 } from '../../utils/scheduleCDepreciation';

// #337 PR 3: line 13 on the Schedule C summary. Every amount is invented.
const report: ScheduleCSummary = {
  receipts: 10000, costOfGoodsSold: 0, costOfGoodsSoldLabel: 'Cost of goods sold (Part III)', grossProfit: 10000,
  lines: [{ line: '22', label: 'Supplies', total: 40, miles: null }], noCategory: 0, notDeducted: 0,
  mileage: { line9: { trips: 0, miles: 0, recorded: 0, atIrsRate: 0 }, elsewhere: { trips: 0, miles: 0, recorded: 0, lines: [] } },
  totalExpenses: 40, net: 9960, depreciationCategorized: { count: 0, total: 0, gigOnly: true },
};
const filed: Line13 = {
  source: 'Form 4562 line 22', amount: 2100, netAfter: 7860, gap: null, unexplained: 18,
  line17Check: { entered: 1653, fromYearsEntered: 1653 },
  rows: [{ label: 'Line 17: equipment from earlier years', amount: 1653 }, { label: 'Line 19(g): 2025 equipment, 7-year HY', amount: 429 }],
};
const estimated: Line13 = {
  source: 'Estimated', amount: 1749, netAfter: 8211, gap: null, unexplained: 0, line17Check: null,
  rows: [{ label: 'Line 17: 2024 equipment, 7-year HY ($10,000 × 17.49%)', amount: 1749, note: 'From your purchases; no Form 4562 entered for 2024' }],
};
const notEntered: Line13 = { source: 'Not entered', amount: null, netAfter: null, gap: null, unexplained: 0, line17Check: null, rows: [] };

const table = () => screen.getByRole('table', { name: 'Schedule C summary' });
const row = (label: string | RegExp) => within(table()).getByText(label).closest('tr')!;

describe('ScheduleCView: line 13', () => {
  it('a filed year: line 22 from Form 4562, its breakdown, the checks, and the net after depreciation', () => {
    render(<ScheduleCView report={report} year={2025} line13={filed} disposalsCount={0} />);
    expect(row('Line 13: Depreciation and section 179')).toHaveTextContent('From Form 4562, line 22');
    expect(row('Line 13: Depreciation and section 179')).toHaveTextContent('$2,100.00');
    expect(row('Line 17: equipment from earlier years')).toHaveTextContent('$1,653.00');
    expect(screen.getByText(/Line 17 check: the years entered give \$1,653, matching your return/)).toBeInTheDocument();
    expect(screen.getByText(/Line 22 includes \$18 from lines not entered here \(15, 16, 20\)/)).toBeInTheDocument();
    expect(row('Net after depreciation')).toHaveTextContent('$7,860.00');
    expect(screen.getByText("It's for your reference: the figure your tax program calculates is what gets filed.")).toBeInTheDocument();
  });

  it('an open year: "Estimated", with the breakdown and a note on rows built from purchases', () => {
    render(<ScheduleCView report={report} year={2026} line13={estimated} disposalsCount={0} />);
    expect(row('Line 13: Depreciation and section 179')).toHaveTextContent('Estimated');
    expect(row(/Line 17: 2024 equipment/)).toHaveTextContent('From your purchases; no Form 4562 entered for 2024');
    expect(screen.getByText(/Disposals of equipment not recorded here aren't seen/)).toBeInTheDocument();
  });

  it('names the part of line 17 not broken down by year', () => {
    render(<ScheduleCView report={report} year={2026} line13={{ ...estimated, gap: { year: 2025, amount: 412, appYears: [] } }} disposalsCount={0} />);
    expect(screen.getByText("Earlier equipment not entered: $412 of line 17 on your 2025 return isn't broken down by year, so it isn't carried forward.")).toBeInTheDocument();
  });

  it('when purchases explain more than the filed line 17, says so instead of a negative amount', () => {
    render(<ScheduleCView report={report} year={2026} line13={{ ...estimated, gap: { year: 2025, amount: -1449, appYears: [2023, 2024] } }} disposalsCount={0} />);
    expect(screen.getByText("Your purchases from 2023 and 2024 come to $1,449 more than line 17 on your 2025 return. Enter those years' Form 4562 figures so the estimate uses what was filed.")).toBeInTheDocument();
    expect(screen.queryByText(/Earlier equipment not entered/)).not.toBeInTheDocument();
  });

  it('a year not entered: no amount, no net after depreciation, and where to enter it', () => {
    render(<ScheduleCView report={report} year={2023} line13={notEntered} disposalsCount={0} />);
    expect(row('Line 13: Depreciation and section 179')).toHaveTextContent('Not entered');
    expect(screen.getByText('Add your Form 4562 figures under Filed tax years below.')).toBeInTheDocument();
    expect(within(table()).queryByText('Net after depreciation')).not.toBeInTheDocument();
  });

  it('warns about expenses categorized as Depreciation, which aren\'t added', () => {
    render(<ScheduleCView report={{ ...report, depreciationCategorized: { count: 2, total: 450.5, gigOnly: true } }} year={2026} line13={estimated} disposalsCount={0} />);
    expect(screen.getByText("Also categorized as Depreciation: 2 gig expenses ($450.50). Check these aren't counted twice; they aren't added to line 13.")).toBeInTheDocument();
  });

  it('a single expense of any kind', () => {
    render(<ScheduleCView report={{ ...report, depreciationCategorized: { count: 1, total: 99, gigOnly: false } }} year={2026} line13={estimated} disposalsCount={0} />);
    expect(screen.getByText("Also categorized as Depreciation: 1 expense ($99.00). Check these aren't counted twice; they aren't added to line 13.")).toBeInTheDocument();
  });

  it('points to the disposals: one item, several, or none', () => {
    const { rerender } = render(<ScheduleCView report={report} year={2026} line13={estimated} disposalsCount={1} />);
    expect(screen.getByText('1 item disposed of in 2026: see Assets → Disposals (Form 4797)')).toBeInTheDocument();
    rerender(<ScheduleCView report={report} year={2026} line13={estimated} disposalsCount={3} />);
    expect(screen.getByText('3 items disposed of in 2026: see Assets → Disposals (Form 4797)')).toBeInTheDocument();
    rerender(<ScheduleCView report={report} year={2026} line13={estimated} disposalsCount={0} />);
    expect(screen.queryByText(/disposed of in 2026/)).not.toBeInTheDocument();
  });
});
