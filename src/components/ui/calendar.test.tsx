import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { Calendar } from './calendar';

// The shared date picker (A17): which month it shows, picking a day, the selected day, moving
// between months and days outside the month. Holds across react-day-picker upgrades.
const dayButton = (day: string) => {
  const grid = screen.getByRole('grid');
  const matches = within(grid).getAllByText(day).map((el) => el.closest('button')).filter(Boolean) as HTMLButtonElement[];
  // Outside days repeat numbers; the first match in October 2026 for 15 is inside the month.
  return matches.find((b) => !b.closest('[class*="outside"]') && !b.className.includes('outside')) ?? matches[0];
};

describe('Calendar', () => {
  it('shows the selected date\'s month and marks the selected day', () => {
    render(<Calendar mode="single" selected={new Date(2026, 9, 15)} defaultMonth={new Date(2026, 9, 1)} onSelect={() => {}} />);
    expect(screen.getByText('October 2026')).toBeInTheDocument();
    const selected = dayButton('15');
    expect(selected.getAttribute('aria-selected') === 'true' || selected.closest('[aria-selected="true"]')).toBeTruthy();
  });

  it('calls onSelect with the day picked', () => {
    const onSelect = vi.fn();
    render(<Calendar mode="single" defaultMonth={new Date(2026, 9, 1)} onSelect={onSelect} />);
    fireEvent.click(dayButton('20'));
    expect(onSelect).toHaveBeenCalled();
    const picked = onSelect.mock.calls[0][0] as Date;
    expect([picked.getFullYear(), picked.getMonth(), picked.getDate()]).toEqual([2026, 9, 20]);
  });

  it('moves to the next and previous month', () => {
    render(<Calendar mode="single" defaultMonth={new Date(2026, 9, 1)} onSelect={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /next month/i }));
    expect(screen.getByText('November 2026')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /previous month/i }));
    fireEvent.click(screen.getByRole('button', { name: /previous month/i }));
    expect(screen.getByText('September 2026')).toBeInTheDocument();
  });

  it('shows days from the neighbouring months by default', () => {
    render(<Calendar mode="single" defaultMonth={new Date(2026, 9, 1)} onSelect={() => {}} />);
    // October 2026 starts on a Thursday, so the first week shows late September.
    // Sep 27 to 30 and Oct 27 to 30 are both on screen.
    for (const day of ['27', '28', '29', '30']) {
      expect(within(screen.getByRole('grid')).getAllByText(day)).toHaveLength(2);
    }
  });

  // react-day-picker 9 ignores initialFocus; the app passes autoFocus.
  it('takes focus when opened with autoFocus, so the keyboard can pick a day', () => {
    render(<Calendar mode="single" selected={new Date(2026, 9, 15)} defaultMonth={new Date(2026, 9, 1)} onSelect={() => {}} autoFocus />);
    expect(screen.getByRole('grid').contains(document.activeElement)).toBe(true);
  });
});
