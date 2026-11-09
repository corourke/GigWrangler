import { describe, it, expect } from 'vitest';
import { ACTIVITY_EVENTS, CALENDAR_INDICATOR_EVENT_TYPES, type ActivityEventType } from './activityLog.events';

const EXPECTED_EVENT_TYPES: ActivityEventType[] = [
  'gig.created',
  'gig.notes_updated',
  'gig.status_changed',
  'gig.rescheduled',
  'gig.renamed',
  'participant.added',
  'participant.removed',
  'participant.inactivated',
  'participant.reactivated',
  'staffing.updated',
  'staffing.status_changed',
  'kit_assignment.added',
  'kit_assignment.removed',
  'asset.created',
  'asset.updated',
  'asset.status_changed',
  'asset.written_off',
  'asset.write_off_undone',
  'asset.maintenance_flagged',
  'asset.sent_to_maintenance',
  'asset.maintenance_updated',
  'asset.returned_to_service',
  'asset.maintenance_cancelled',
  'kit.created',
  'kit.updated',
  'kit.asset_added',
  'kit.asset_removed',
  'financial.added',
  'financial.updated',
  'financial.paid',
  'financial.removed',
  'financial.converted',
  'schedule_entry.added',
];

describe('ACTIVITY_EVENTS', () => {
  it('contains exactly 35 event types', () => {
    expect(Object.keys(ACTIVITY_EVENTS)).toHaveLength(35);
  });

  it('contains all expected event type keys', () => {
    for (const key of EXPECTED_EVENT_TYPES) {
      expect(ACTIVITY_EVENTS).toHaveProperty(key);
    }
  });

  it('every entry has label, entityType, calendarIndicator, contextKeys, and format', () => {
    for (const [key, cfg] of Object.entries(ACTIVITY_EVENTS)) {
      expect(cfg.label, `${key}.label`).toBeTruthy();
      expect(cfg.entityType, `${key}.entityType`).toBeTruthy();
      expect(typeof cfg.calendarIndicator, `${key}.calendarIndicator`).toBe('boolean');
      expect(Array.isArray(cfg.contextKeys), `${key}.contextKeys`).toBe(true);
      expect(typeof cfg.format, `${key}.format`).toBe('function');
    }
  });

  it('staffing.updated format with changes array renders each change', () => {
    const cfg = ACTIVITY_EVENTS['staffing.updated'];
    const ctx = {
      context_version: 1,
      actor_display_name: 'Jane',
      actor_org_name: 'Acme',
      gig_title: 'Test Gig',
      changes: [
        { type: 'slot_added' as const, role: 'Audio Engineer' },
        { type: 'assigned' as const, role: 'Audio Engineer', user_name: 'Bob' },
      ],
      change_count: 2,
    };
    const result = cfg.format(ctx);
    expect(result).toContain('Audio Engineer slot added');
    expect(result).toContain('Bob assigned as Audio Engineer');
  });

  it('staffing.updated format with empty changes returns fallback text', () => {
    const cfg = ACTIVITY_EVENTS['staffing.updated'];
    const result = cfg.format({ context_version: 1, actor_display_name: '', actor_org_name: '' });
    expect(result).toBe('Staffing updated');
  });

  it('financial.added format renders each added record', () => {
    const cfg = ACTIVITY_EVENTS['financial.added'];
    const result = cfg.format({
      context_version: 1,
      actor_display_name: '',
      actor_org_name: '',
      financial_changes: [{ amount: 250, fin_type: 'Expense Incurred' }],
      change_count: 1,
    });
    expect(result).toBe('Added Expense Incurred: $250.00');
  });

  it('financial.added format with no changes returns fallback text', () => {
    const cfg = ACTIVITY_EVENTS['financial.added'];
    expect(cfg.format({ context_version: 1, actor_display_name: '', actor_org_name: '' })).toBe('Financial record added');
  });

  const ctx = { context_version: 1, actor_display_name: '', actor_org_name: '' };

  it('financial.added format renders one new-style row', () => {
    expect(ACTIVITY_EVENTS['financial.added'].format({
      ...ctx, direction: 'in', stage: 'quoted', amount: 1800, description: 'Performance fee',
    })).toBe('Added Performance fee · Quoted · $1,800.00');
  });

  it('financial.updated format lists amount and stage changes (St. Raymond)', () => {
    expect(ACTIVITY_EVENTS['financial.updated'].format({
      ...ctx, direction: 'in', stage: 'accepted', amount: 1000, description: 'Performance fee',
      field_changes: [
        { field: 'amount', from: 1800, to: 1000 },
        { field: 'stage', from: 'quoted', to: 'accepted' },
      ],
    })).toBe('Performance fee updated: Amount $1,800.00 → $1,000.00; Quoted → Accepted');
  });

  it('financial.paid format says received for money in, paid for money out', () => {
    expect(ACTIVITY_EVENTS['financial.paid'].format({ ...ctx, direction: 'in', stage: 'paid', amount: 250, amount_settled: 260 }))
      .toBe('Money in received: $260.00');
    expect(ACTIVITY_EVENTS['financial.paid'].format({ ...ctx, direction: 'out', stage: 'paid', amount: 200, description: 'Stage Hand' }))
      .toBe('Stage Hand paid: $200.00');
  });

  it('financial.converted format lists the old rows', () => {
    expect(ACTIVITY_EVENTS['financial.converted'].format({
      ...ctx, direction: 'in', stage: 'accepted', amount: 1000, description: 'All day festival',
      sources: [
        { id: 'a', type: 'Informal Terms', amount: 1800, date: '2026-07-22' },
        { id: 'b', type: 'Bid Accepted', amount: 1000, date: '2026-07-29' },
      ],
    })).toBe('All day festival converted to Accepted from Informal Terms $1,800.00 (2026-07-22), Bid Accepted $1,000.00 (2026-07-29)');
  });

  // #175: the database logs removals, and marks an organization leaving the gig.
  it('participant.removed says an organization left the gig', () => {
    const cfg = ACTIVITY_EVENTS['participant.removed'];
    expect(cfg.format({ ...ctx, organization_name: 'Sound Co', role: 'Sound', left: true })).toBe('Sound Co left the gig');
    expect(cfg.format({ ...ctx, organization_name: 'Sound Co', role: 'Sound', left: false })).toBe('Sound Co removed as Sound participant');
  });

  // #175: the database logs Inactive and Reactivated, once per organization.
  it('participant.inactivated and participant.reactivated read as sentences', () => {
    expect(ACTIVITY_EVENTS['participant.inactivated'].format({ ...ctx, organization_name: 'Sound Co' })).toBe('Sound Co marked Inactive on the gig');
    expect(ACTIVITY_EVENTS['participant.reactivated'].format({ ...ctx, organization_name: 'Sound Co' })).toBe('Sound Co reactivated on the gig');
    expect(ACTIVITY_EVENTS['participant.inactivated'].entityType).toBe('participant');
  });

  it('schedule_entry.added format renders each added entry', () => {
    const cfg = ACTIVITY_EVENTS['schedule_entry.added'];
    const result = cfg.format({
      context_version: 1,
      actor_display_name: '',
      actor_org_name: '',
      schedule_changes: [{ activity_type: 'Load-in', label: null, start_time: '2026-09-20T14:00:00.000Z' }],
      change_count: 1,
    });
    expect(result).toContain('Load-in at');
    expect(result).toContain('20 Sep 2026');
  });

  it('schedule_entry.added format with no changes returns fallback text', () => {
    const cfg = ACTIVITY_EVENTS['schedule_entry.added'];
    expect(cfg.format({ context_version: 1, actor_display_name: '', actor_org_name: '' })).toBe('Schedule entry added');
  });

  it('gig.status_changed format uses from_status and to_status', () => {
    const cfg = ACTIVITY_EVENTS['gig.status_changed'];
    const result = cfg.format({
      context_version: 1,
      actor_display_name: '',
      actor_org_name: '',
      from_status: 'Proposed',
      to_status: 'Booked',
    });
    expect(result).toContain('Proposed');
    expect(result).toContain('Booked');
  });

  it('gig.created format returns "Gig created"', () => {
    const cfg = ACTIVITY_EVENTS['gig.created' as ActivityEventType];
    expect(cfg.format({ context_version: 1, actor_display_name: '', actor_org_name: '' })).toBe('Gig created');
  });

  it('gig.notes_updated format returns "Gig notes updated"', () => {
    const cfg = ACTIVITY_EVENTS['gig.notes_updated' as ActivityEventType];
    expect(cfg.format({ context_version: 1, actor_display_name: '', actor_org_name: '' })).toBe('Gig notes updated');
  });

  it('asset.created format returns "Asset created"', () => {
    const cfg = ACTIVITY_EVENTS['asset.created' as ActivityEventType];
    expect(cfg.format({ context_version: 1, actor_display_name: '', actor_org_name: '' })).toBe('Asset created');
  });

  it('asset.updated format with field_changes renders human-readable fields', () => {
    const cfg = ACTIVITY_EVENTS['asset.updated'];
    const result = cfg.format({
      context_version: 1,
      actor_display_name: '',
      actor_org_name: '',
      field_changes: [
        { field: 'manufacturer_model', from: 'A', to: 'B' },
        { field: 'category', from: 'C', to: 'D' },
      ],
    });
    expect(result).toBe('Asset updated: Model, Category');
  });

  it('asset.updated format with empty field_changes returns fallback', () => {
    const cfg = ACTIVITY_EVENTS['asset.updated'];
    expect(cfg.format({ context_version: 1, actor_display_name: '', actor_org_name: '' })).toBe('Asset updated');
  });

  // #242: write-offs read as sentences in Gig History and on the equipment's own history.
  it('asset.written_off says how many pieces went missing, with the note', () => {
    const cfg = ACTIVITY_EVENTS['asset.written_off'];
    expect(cfg.label).toBe('Equipment Written Off');
    expect(cfg.format({ ...ctx, quantity: 2 })).toBe('Equipment written off: 2 pieces missing');
    expect(cfg.format({ ...ctx, quantity: 1 })).toBe('Equipment written off: 1 piece missing');
    expect(cfg.format({ ...ctx, quantity: 3, note: 'lost at load-out' }))
      .toBe('Equipment written off: 3 pieces missing (lost at load-out)');
  });

  // #186: maintenance, logged by the database functions.
  it('asset.maintenance_flagged says it goes in when it comes home', () => {
    const cfg = ACTIVITY_EVENTS['asset.maintenance_flagged'];
    expect(cfg.label).toBe('Flagged for Maintenance');
    expect(cfg.format({ ...ctx, quantity: 1, location: 'Repair Bench' }))
      .toBe('Flagged to maintenance when it comes home (Repair Bench)');
    expect(cfg.format({ ...ctx, quantity: 3 })).toBe('3 pieces flagged to maintenance when they come home');
    expect(cfg.format(ctx)).toBe('Flagged to maintenance when it comes home');
  });

  it('asset.sent_to_maintenance says where, and when part of a lot split off', () => {
    const cfg = ACTIVITY_EVENTS['asset.sent_to_maintenance'];
    expect(cfg.label).toBe('Sent to Maintenance');
    expect(cfg.format({ ...ctx, quantity: 1, location: 'Repair Bench' })).toBe('Sent to maintenance (Repair Bench)');
    // Logged against the lot, which stays (#186 review).
    expect(cfg.format({ ...ctx, quantity: 2, split_off: 'piece-1' })).toBe('2 pieces split off and sent to maintenance');
    expect(cfg.format(ctx)).toBe('Sent to maintenance');
  });

  it('asset.maintenance_updated, asset.returned_to_service and asset.maintenance_cancelled read well', () => {
    expect(ACTIVITY_EVENTS['asset.maintenance_updated'].format({ ...ctx, location: 'Brightline Lighting' }))
      .toBe('Maintenance details updated (Brightline Lighting)');
    expect(ACTIVITY_EVENTS['asset.maintenance_updated'].format(ctx)).toBe('Maintenance details updated');
    expect(ACTIVITY_EVENTS['asset.returned_to_service'].label).toBe('Returned to Service');
    expect(ACTIVITY_EVENTS['asset.returned_to_service'].format(ctx)).toBe('Returned to service');
    expect(ACTIVITY_EVENTS['asset.returned_to_service'].format({ ...ctx, quantity: 1, merged_from: 'piece-1' }))
      .toBe('1 piece returned to service, back in this lot');
    expect(ACTIVITY_EVENTS['asset.maintenance_cancelled'].format()).toBe('Maintenance flag cancelled');
  });

  it('asset.written_off without a quantity still reads well', () => {
    expect(ACTIVITY_EVENTS['asset.written_off'].format(ctx)).toBe('Equipment written off as missing');
  });

  it('asset.write_off_undone reads on the equipment\'s own history (no gig)', () => {
    const cfg = ACTIVITY_EVENTS['asset.write_off_undone'];
    expect(cfg.label).toBe('Write-off Undone');
    expect(cfg.format({ ...ctx, quantity: 1 })).toBe('Write-off undone: 1 piece back');
    expect(cfg.format({ ...ctx, quantity: 2, merged_from: 'asset-9' })).toBe('Write-off undone: 2 pieces back in the lot they came from');
    expect(cfg.format(ctx)).toBe('Write-off undone');
  });

  it('kit.created format returns "Kit created"', () => {
    const cfg = ACTIVITY_EVENTS['kit.created' as ActivityEventType];
    expect(cfg.format({ context_version: 1, actor_display_name: '', actor_org_name: '' })).toBe('Kit created');
  });

  it('kit.updated format with field_changes renders human-readable fields', () => {
    const cfg = ACTIVITY_EVENTS['kit.updated'];
    const result = cfg.format({
      context_version: 1,
      actor_display_name: '',
      actor_org_name: '',
      field_changes: [
        { field: 'name', from: 'A', to: 'B' },
        { field: 'rental_value', from: 0, to: 100 },
      ],
    });
    expect(result).toBe('Kit updated: Name, Rental Value');
  });

  it('kit.updated format with empty field_changes returns fallback', () => {
    const cfg = ACTIVITY_EVENTS['kit.updated'];
    expect(cfg.format({ context_version: 1, actor_display_name: '', actor_org_name: '' })).toBe('Kit updated');
  });
});

describe('CALENDAR_INDICATOR_EVENT_TYPES', () => {
  it('contains exactly gig.status_changed and gig.rescheduled', () => {
    expect(CALENDAR_INDICATOR_EVENT_TYPES).toHaveLength(2);
    expect(CALENDAR_INDICATOR_EVENT_TYPES).toContain('gig.status_changed');
    expect(CALENDAR_INDICATOR_EVENT_TYPES).toContain('gig.rescheduled');
  });
});

// A duplicated gig's History entry says what was copied (Docs Lead code read, 11-09).
describe('gig.created for a duplicate', () => {
  it('names the copied counts', () => {
    const cfg = ACTIVITY_EVENTS['gig.created' as ActivityEventType];
    expect(cfg.format({ copied_from: 'g0', copied: { staff_slots: 3, kits: 1, schedule_entries: 0 } } as any))
      .toBe('Gig duplicated: 3 staff slots, 1 kit and 0 schedule entries copied');
    expect(cfg.format({} as any)).toBe('Gig created');
  });
});
