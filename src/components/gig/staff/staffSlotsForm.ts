import { z } from 'zod';
import { rateUnit, type RateUnit } from '../view/staffRows';
import type { GigTimes } from '../../../utils/rateEstimate';

// The staffing section's form: its schema, and the form values from a loaded gig (A14: moved
// out of GigStaffSlotsSection).

const staffAssignmentSchema = z.object({
  id: z.string(),
  user_id: z.string(),
  user_name: z.string(),
  status: z.enum(['Open', 'Requested', 'Confirmed', 'Declined']),
  compensation_type: z.enum(['rate', 'fee']),
  rate_unit: z.enum(['hour', 'day', 'half_day']),
  amount: z.string().refine((val) => {
    if (!val.trim()) return true;
    const num = parseFloat(val);
    return !isNaN(num) && num >= 0;
  }, 'Amount must be a positive number'),
  notes: z.string().optional(),
  completed_at: z.string().optional().nullable(),
  units_completed: z.number().optional().nullable(),
});

const staffSlotSchema = z.object({
  id: z.string(),
  organization_id: z.string().optional(),
  role: z.string().min(1, 'Role is required'),
  count: z.number().min(1, 'Count must be at least 1'),
  notes: z.string().optional(),
  assignments: z.array(staffAssignmentSchema),
});

export const staffSlotsFormSchema = z.object({
  slots: z.array(staffSlotSchema),
});

export type StaffSlotsFormData = z.infer<typeof staffSlotsFormSchema>;

export interface StaffAssignmentData {
  id: string;
  user_id: string;
  user_name: string;
  status: 'Open' | 'Requested' | 'Confirmed' | 'Declined';
  compensation_type: 'rate' | 'fee';
  rate_unit: RateUnit;
  amount: string;
  notes: string;
  completed_at?: string | null;
  units_completed?: number | null;
}

/** The new, unassigned seat a slot shows for each person it still needs. */
export const openAssignment = (): StaffAssignmentData => ({
  id: `temp-${Math.random().toString(36).substr(2, 9)}`,
  user_id: '',
  user_name: '',
  status: 'Open',
  compensation_type: 'rate',
  rate_unit: 'hour',
  amount: '',
  notes: '',
  completed_at: null,
  units_completed: null,
});

/**
 * The form values for this organization's staff slots on a loaded gig: each slot's assignments,
 * padded with open seats up to its count (declined ones don't count), plus the gig's times (for
 * a rate's projected cost) and the ids of the slots and assignments loaded (for the baseline).
 */
export function toStaffSlotsForm(gig: any, organizationId: string): {
  gigTimes: GigTimes;
  slots: StaffSlotsFormData['slots'];
  loadedIds: string[];
} {
  const organizationSlots = (gig.staff_slots || []).filter((slot: any) => slot.organization_id === organizationId);
  const slots = organizationSlots.map((slot: any) => {
    const assignments: StaffAssignmentData[] = (slot.staff_assignments || []).map((assignment: any) => ({
      id: assignment.id,
      user_id: assignment.user_id,
      user_name: `${assignment.user?.first_name || ''} ${assignment.user?.last_name || ''}`.trim(),
      status: (assignment.status as any) || 'Open',
      compensation_type: assignment.rate !== null ? 'rate' : 'fee',
      rate_unit: rateUnit(assignment.rate_unit),
      amount: assignment.rate !== null ? assignment.rate.toString() : (assignment.fee !== null ? assignment.fee.toString() : ''),
      notes: assignment.notes || '',
      completed_at: assignment.completed_at,
      units_completed: assignment.units_completed,
    }));
    const count = slot.count || 1;
    const active = assignments.filter((a) => a.status !== 'Declined').length;
    for (let i = active; i < count; i++) assignments.push(openAssignment());
    return {
      id: slot.id,
      organization_id: slot.organization_id,
      role: slot.role,
      count,
      notes: slot.notes || '',
      assignments,
    };
  });
  return {
    gigTimes: { start: gig.start, end: gig.end, timezone: gig.timezone },
    slots,
    loadedIds: organizationSlots.flatMap((slot: any) => [slot.id, ...(slot.staff_assignments || []).map((a: any) => a.id)]),
  };
}
