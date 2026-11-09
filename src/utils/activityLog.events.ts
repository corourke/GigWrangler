import type { ActivityLogContext } from './supabase/types';
import { format } from 'date-fns';
import { stageLabel, type FinStage } from './moneyFlow';
import { plural } from './plural';

interface EventTypeConfig {
  label: string;
  entityType: string;
  calendarIndicator: boolean;
  contextKeys: (keyof ActivityLogContext)[];
  format: (ctx: ActivityLogContext) => string;
}

function formatDate(dateStr: string | undefined): string {
  if (!dateStr) return '?';
  try {
    return format(new Date(dateStr), 'dd MMM yyyy HH:mm');
  } catch {
    return dateStr;
  }
}

const money = (n: number | string) =>
  `$${Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const pieces = (n: number) => `${n} ${n === 1 ? 'piece' : 'pieces'}`;

const FINANCIAL_FIELD_LABELS: Record<string, string> = {
  amount: 'Amount',
  amount_settled: 'Amount paid',
  date: 'Date',
  due_date: 'Due',
  paid_at: 'Paid on',
  description: 'Description',
  category: 'Category',
  counterparty_id: 'Counterparty',
  external_entity_name: 'Payee / payer',
  reference_number: 'Reference',
  notes: 'Notes',
};

function financialName(ctx: ActivityLogContext): string {
  return ctx.description || (ctx.direction === 'out' ? 'Money out' : 'Money in');
}

function financialStage(ctx: ActivityLogContext): string {
  return ctx.direction && ctx.stage ? stageLabel(ctx.direction, ctx.stage) : (ctx.stage ?? '');
}

function financialChanges(ctx: ActivityLogContext): string {
  return (ctx.field_changes ?? [])
    .map((c) => {
      if (c.field === 'stage' && ctx.direction) {
        return `${stageLabel(ctx.direction, c.from as FinStage)} → ${stageLabel(ctx.direction, c.to as FinStage)}`;
      }
      if (c.field === 'amount' || c.field === 'amount_settled') {
        const f = (v: unknown) => (v == null ? '—' : money(v as number));
        return `${FINANCIAL_FIELD_LABELS[c.field]} ${f(c.from)} → ${f(c.to)}`;
      }
      if (c.field === 'notes' || c.field === 'counterparty_id') return FINANCIAL_FIELD_LABELS[c.field];
      return `${FINANCIAL_FIELD_LABELS[c.field] ?? c.field} ${c.from ?? '—'} → ${c.to ?? '—'}`;
    })
    .join('; ');
}

const ASSET_FIELD_LABELS: Record<string, string> = {
  manufacturer_model: 'Model',
  serial_number: 'Serial Number',
  category: 'Category',
  sub_category: 'Sub-category',
  type: 'Type',
  description: 'Description',
  vendor: 'Vendor',
  item_price: 'Item Price',
  item_cost: 'Item Cost',
  replacement_value: 'Replacement Value',
  acquisition_date: 'Acquisition Date',
  retired_on: 'Retired On',
  tag_number: 'Tag Number',
};

const KIT_FIELD_LABELS: Record<string, string> = {
  name: 'Name',
  category: 'Category',
  description: 'Description',
  tags: 'Tags',
  rental_value: 'Rental Value',
  tag_number: 'Tag Number',
  is_container: 'Container',
};

export const ACTIVITY_EVENTS = {
  'gig.created': {
    label: 'Gig Created',
    entityType: 'gig',
    calendarIndicator: false,
    contextKeys: ['gig_title', 'copied_from', 'copied'],
    // A duplicate says what came with it (B10 stores the counts).
    format: (ctx) => {
      const c = ctx.copied;
      if (!ctx.copied_from || !c) return 'Gig created';
      return `Gig duplicated: ${plural(c.staff_slots ?? 0, 'staff slot')}, ${plural(c.kits ?? 0, 'kit')} and ${plural(c.schedule_entries ?? 0, 'schedule entry', 'schedule entries')} copied`;
    },
  },
  'gig.notes_updated': {
    label: 'Notes Updated',
    entityType: 'gig',
    calendarIndicator: false,
    contextKeys: ['gig_title', 'notes_changed'],
    format: () => 'Gig notes updated',
  },
  'gig.status_changed': {
    label: 'Status Changed',
    entityType: 'gig',
    calendarIndicator: true,
    contextKeys: ['gig_title', 'from_status', 'to_status'],
    format: (ctx) => `Status changed from ${ctx.from_status} to ${ctx.to_status}`,
  },
  'gig.rescheduled': {
    label: 'Rescheduled',
    entityType: 'gig',
    calendarIndicator: true,
    contextKeys: ['gig_title', 'from', 'to'],
    format: (ctx) =>
      `Rescheduled from ${formatDate(ctx.from?.start)} to ${formatDate(ctx.to?.start)}`,
  },
  'gig.renamed': {
    label: 'Renamed',
    entityType: 'gig',
    calendarIndicator: false,
    contextKeys: ['from_title', 'to_title'],
    format: (ctx) => `Renamed from '${ctx.from_title}' to '${ctx.to_title}'`,
  },
  'participant.added': {
    label: 'Participant Added',
    entityType: 'participant',
    calendarIndicator: false,
    contextKeys: ['gig_title', 'organization_name', 'role'],
    format: (ctx) => `${ctx.organization_name} added as ${ctx.role} participant`,
  },
  'participant.removed': {
    label: 'Participant Removed',
    entityType: 'participant',
    calendarIndicator: false,
    contextKeys: ['gig_title', 'organization_name', 'role', 'left'],
    // Logged by the database; `left` when the organization's own member removed it (#175).
    format: (ctx) => ctx.left
      ? `${ctx.organization_name} left the gig`
      : `${ctx.organization_name} removed as ${ctx.role} participant`,
  },
  // Logged by the database, once per organization (#175).
  'participant.inactivated': {
    label: 'Participant Inactive',
    entityType: 'participant',
    calendarIndicator: false,
    contextKeys: ['gig_title', 'organization_name'],
    format: (ctx) => `${ctx.organization_name} marked Inactive on the gig`,
  },
  'participant.reactivated': {
    label: 'Participant Reactivated',
    entityType: 'participant',
    calendarIndicator: false,
    contextKeys: ['gig_title', 'organization_name'],
    format: (ctx) => `${ctx.organization_name} reactivated on the gig`,
  },
  'staffing.updated': {
    label: 'Staffing Updated',
    entityType: 'staffing',
    calendarIndicator: false,
    contextKeys: ['gig_title', 'changes', 'change_count'],
    format: (ctx) => {
      if (!ctx.changes?.length) return 'Staffing updated';
      const summary = ctx.changes
        .map((c) => {
          if (c.type === 'slot_added') return `${c.role} slot added`;
          if (c.type === 'slot_removed') return `${c.role} slot removed`;
          if (c.type === 'assigned') return `${c.user_name} assigned as ${c.role}`;
          if (c.type === 'unassigned') return `${c.user_name} unassigned from ${c.role}`;
          return c.type;
        })
        .join('; ');
      return `Staffing updated: ${summary}`;
    },
  },
  'financial.added': {
    label: 'Financial Record Added',
    entityType: 'financial',
    calendarIndicator: false,
    contextKeys: ['gig_title', 'financial_changes', 'change_count', 'direction', 'stage', 'amount', 'description'],
    format: (ctx) => {
      // Before the 2026-10 redesign one event covered several rows.
      if (ctx.financial_changes?.length) {
        const summary = ctx.financial_changes
          .map((c) => `${c.fin_type}: $${c.amount.toFixed(2)}`)
          .join('; ');
        return `Added ${summary}`;
      }
      if (!ctx.direction) return 'Financial record added';
      return `Added ${financialName(ctx)} · ${financialStage(ctx)}${ctx.amount != null ? ` · ${money(ctx.amount)}` : ''}`;
    },
  },
  'financial.updated': {
    label: 'Financial Record Updated',
    entityType: 'financial',
    calendarIndicator: false,
    contextKeys: ['gig_title', 'direction', 'stage', 'amount', 'description', 'field_changes'],
    format: (ctx) => `${financialName(ctx)} updated: ${financialChanges(ctx)}`,
  },
  'financial.paid': {
    label: 'Financial Record Paid',
    entityType: 'financial',
    calendarIndicator: false,
    contextKeys: ['gig_title', 'direction', 'stage', 'amount', 'amount_settled', 'description', 'field_changes'],
    format: (ctx) =>
      `${financialName(ctx)} ${ctx.direction === 'out' ? 'paid' : 'received'}: ${money(ctx.amount_settled ?? ctx.amount ?? 0)}`,
  },
  'financial.removed': {
    label: 'Financial Record Removed',
    entityType: 'financial',
    calendarIndicator: false,
    contextKeys: ['gig_title', 'direction', 'stage', 'amount', 'description'],
    format: (ctx) => `Removed ${financialName(ctx)}${ctx.amount != null ? ` · ${money(ctx.amount)}` : ''}`,
  },
  'financial.converted': {
    label: 'Financial Record Converted',
    entityType: 'financial',
    calendarIndicator: false,
    contextKeys: ['gig_title', 'direction', 'stage', 'amount', 'description', 'sources'],
    format: (ctx) => {
      const from = (ctx.sources ?? [])
        .map((s) => `${s.type} ${money(s.amount)} (${s.date})`)
        .join(', ');
      return `${financialName(ctx)} converted to ${financialStage(ctx)}${from ? ` from ${from}` : ''}`;
    },
  },
  'schedule_entry.added': {
    label: 'Schedule Entry Added',
    entityType: 'schedule_entry',
    calendarIndicator: false,
    contextKeys: ['gig_title', 'schedule_changes', 'change_count'],
    format: (ctx) => {
      if (!ctx.schedule_changes?.length) return 'Schedule entry added';
      const summary = ctx.schedule_changes
        .map((c) => `${c.label || c.activity_type} at ${formatDate(c.start_time)}`)
        .join('; ');
      return `Added ${summary}`;
    },
  },
  'staffing.status_changed': {
    label: 'Staffing Status Changed',
    entityType: 'staffing',
    calendarIndicator: false,
    contextKeys: ['gig_title', 'user_name', 'role', 'from_status', 'to_status'],
    format: (ctx) =>
      `${ctx.user_name}'s ${ctx.role} status changed from ${ctx.from_status} to ${ctx.to_status}`,
  },
  'kit_assignment.added': {
    label: 'Kit Assigned',
    entityType: 'kit_assignment',
    calendarIndicator: false,
    contextKeys: ['gig_title', 'kit_name'],
    format: (ctx) => `${ctx.kit_name} kit assigned`,
  },
  'kit_assignment.removed': {
    label: 'Kit Removed',
    entityType: 'kit_assignment',
    calendarIndicator: false,
    contextKeys: ['gig_title', 'kit_name'],
    format: (ctx) => `${ctx.kit_name} kit removed`,
  },
  'asset.created': {
    label: 'Asset Created',
    entityType: 'asset',
    calendarIndicator: false,
    contextKeys: ['asset_model', 'category'],
    format: () => 'Asset created',
  },
  'asset.updated': {
    label: 'Asset Updated',
    entityType: 'asset',
    calendarIndicator: false,
    contextKeys: ['asset_model', 'category', 'field_changes'],
    format: (ctx) => {
      if (!ctx.field_changes?.length) return 'Asset updated';
      const labels = ctx.field_changes
        .map((c) => ASSET_FIELD_LABELS[c.field] ?? c.field)
        .join(', ');
      return `Asset updated: ${labels}`;
    },
  },
  'asset.status_changed': {
    label: 'Asset Status Changed',
    entityType: 'asset',
    calendarIndicator: false,
    contextKeys: ['asset_model', 'category', 'from_status', 'to_status'],
    format: (ctx) => `Status changed from ${ctx.from_status} to ${ctx.to_status}`,
  },
  // write_off_pieces / undo_write_off log only quantity, kit_id, note and split_from / merged_from
  // (no gig title or model: the entry sits on the gig's or the equipment's own history).
  'asset.written_off': {
    label: 'Equipment Written Off',
    entityType: 'asset',
    calendarIndicator: false,
    contextKeys: ['quantity', 'note'],
    format: (ctx) => {
      if (!ctx.quantity) return 'Equipment written off as missing';
      const note = ctx.note ? ` (${ctx.note})` : '';
      return `Equipment written off: ${pieces(ctx.quantity)} missing${note}`;
    },
  },
  'asset.write_off_undone': {
    label: 'Write-off Undone',
    entityType: 'asset',
    calendarIndicator: false,
    contextKeys: ['quantity', 'merged_from'],
    format: (ctx) => {
      if (!ctx.quantity) return 'Write-off undone';
      return `Write-off undone: ${pieces(ctx.quantity)} back${ctx.merged_from ? ' in the lot they came from' : ''}`;
    },
  },
  // #186: maintenance, logged by send_to_maintenance / update_maintenance / return_to_service
  // and by a return scan bringing flagged equipment home.
  'asset.maintenance_flagged': {
    label: 'Flagged for Maintenance',
    entityType: 'asset',
    calendarIndicator: false,
    contextKeys: ['quantity', 'location'],
    format: (ctx) => {
      const where = ctx.location ? ` (${ctx.location})` : '';
      const n = Number(ctx.quantity ?? 1);
      return n > 1
        ? `${pieces(n)} flagged to maintenance when they come home${where}`
        : `Flagged to maintenance when it comes home${where}`;
    },
  },
  'asset.sent_to_maintenance': {
    label: 'Sent to Maintenance',
    entityType: 'asset',
    calendarIndicator: false,
    // Part of a lot is logged against the lot, which stays, naming the piece split off.
    contextKeys: ['quantity', 'location', 'split_off'],
    format: (ctx) => {
      const where = ctx.location ? ` (${ctx.location})` : '';
      return ctx.split_off
        ? `${pieces(Number(ctx.quantity ?? 1))} split off and sent to maintenance${where}`
        : `Sent to maintenance${where}`;
    },
  },
  'asset.maintenance_updated': {
    label: 'Maintenance Details Updated',
    entityType: 'asset',
    calendarIndicator: false,
    contextKeys: ['location', 'expected_back'],
    format: (ctx) => `Maintenance details updated${ctx.location ? ` (${ctx.location})` : ''}`,
  },
  'asset.returned_to_service': {
    label: 'Returned to Service',
    entityType: 'asset',
    calendarIndicator: false,
    // A piece merged back is logged against the lot, which stays, naming the piece.
    contextKeys: ['quantity', 'merged_from'],
    format: (ctx) => (ctx.merged_from
      ? `${pieces(Number(ctx.quantity ?? 1))} returned to service, back in this lot`
      : 'Returned to service'),
  },
  'asset.maintenance_cancelled': {
    label: 'Maintenance Flag Cancelled',
    entityType: 'asset',
    calendarIndicator: false,
    contextKeys: [],
    format: () => 'Maintenance flag cancelled',
  },
  'kit.created': {
    label: 'Kit Created',
    entityType: 'kit',
    calendarIndicator: false,
    contextKeys: ['kit_name'],
    format: () => 'Kit created',
  },
  'kit.updated': {
    label: 'Kit Updated',
    entityType: 'kit',
    calendarIndicator: false,
    contextKeys: ['kit_name', 'field_changes'],
    format: (ctx) => {
      if (!ctx.field_changes?.length) return 'Kit updated';
      const labels = ctx.field_changes
        .map((c) => KIT_FIELD_LABELS[c.field] ?? c.field)
        .join(', ');
      return `Kit updated: ${labels}`;
    },
  },
  'kit.asset_added': {
    label: 'Asset Added to Kit',
    entityType: 'kit',
    calendarIndicator: false,
    contextKeys: ['kit_name', 'asset_model', 'quantity'],
    format: (ctx) => `${ctx.quantity}× ${ctx.asset_model} added to kit`,
  },
  'kit.asset_removed': {
    label: 'Asset Removed from Kit',
    entityType: 'kit',
    calendarIndicator: false,
    contextKeys: ['kit_name', 'asset_model'],
    format: (ctx) => `${ctx.asset_model} removed from kit`,
  },
  'kit.subkit_added': {
    label: 'Sub-kit Added to Kit',
    entityType: 'kit',
    calendarIndicator: false,
    contextKeys: ['kit_name', 'subkit_name', 'quantity'],
    format: (ctx) => `${ctx.quantity}× ${ctx.subkit_name} added to kit`,
  },
  'kit.subkit_removed': {
    label: 'Sub-kit Removed from Kit',
    entityType: 'kit',
    calendarIndicator: false,
    contextKeys: ['kit_name', 'subkit_name'],
    format: (ctx) => `${ctx.subkit_name} removed from kit`,
  },
} as const satisfies Record<string, EventTypeConfig>;

export type ActivityEventType = keyof typeof ACTIVITY_EVENTS;

export const CALENDAR_INDICATOR_EVENT_TYPES: ActivityEventType[] = Object.entries(ACTIVITY_EVENTS)
  .filter(([, cfg]) => cfg.calendarIndicator)
  .map(([type]) => type as ActivityEventType);
