import { describe, it, expect } from 'vitest';
import { toStaffSlotsForm } from './staffSlotsForm';

// A14: the staffing form's mapping from the loaded gig, out of the 1,000-line section.
describe('toStaffSlotsForm', () => {
  const gig = {
    start: '2026-05-01T20:00:00Z', end: '2026-05-01T23:00:00Z', timezone: 'UTC',
    staff_slots: [
      { id: 's1', organization_id: 'org-1', role: 'A1', count: 2, notes: null, staff_assignments: [
        { id: 'a1', user_id: 'u1', user: { first_name: 'Jo', last_name: 'Lee' }, status: 'Confirmed', rate: 40, rate_unit: 'hour', fee: null, notes: null, completed_at: null, units_completed: null },
      ] },
      { id: 's2', organization_id: 'org-2', role: 'LD', count: 1, staff_assignments: [] },
    ],
  };

  it("keeps this organization's slots, pads open assignments up to the count, and lists the loaded ids", () => {
    const out = toStaffSlotsForm(gig, 'org-1');
    expect(out.gigTimes).toEqual({ start: gig.start, end: gig.end, timezone: 'UTC' });
    expect(out.slots).toHaveLength(1);
    const [slot] = out.slots;
    expect(slot).toMatchObject({ id: 's1', role: 'A1', count: 2, notes: '' });
    expect(slot.assignments[0]).toMatchObject({ id: 'a1', user_name: 'Jo Lee', compensation_type: 'rate', amount: '40', rate_unit: 'hour' });
    expect(slot.assignments).toHaveLength(2);
    expect(slot.assignments[1]).toMatchObject({ user_id: '', status: 'Open' });
    expect(slot.assignments[1].id).toMatch(/^temp-/);
    expect(out.loadedIds).toEqual(['s1', 'a1']);
  });

  it('reads a fee as a fee', () => {
    const fee = { ...gig, staff_slots: [{ ...gig.staff_slots[0], staff_assignments: [{ ...gig.staff_slots[0].staff_assignments[0], rate: null, fee: 250 }] }] };
    expect(toStaffSlotsForm(fee, 'org-1').slots[0].assignments[0]).toMatchObject({ compensation_type: 'fee', amount: '250' });
  });
});
