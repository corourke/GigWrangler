// Equipment from a purchase line (#183): a line of N becomes N units, each with its
// own serial number or tag, or one lot of N. The Equipment details pop-up and the
// Add Item page collect a LineEquipment; buildLineUnits turns it into the records
// create_purchase_transaction_v2 and add_purchase_line_units save.

export interface UnitRow {
  serial_number: string;
  tag_number: string;
}

/** An item we already have (its model and category fill the transition columns), or a new one. */
export type ItemChoice =
  | { equipment_item_id: string; manufacturer_model: string; category: string; type?: string | null; insurance_class?: string | null; description?: string | null }
  | { equipment_item_id?: undefined; manufacturer_model: string; category: string; type?: string | null; insurance_class?: string | null; description?: string | null };

export interface LineEquipment {
  item: ItemChoice;
  kind: 'units' | 'lot';
  /** One row per unit (ignored for a lot). */
  units: UnitRow[];
  /** Each; copied to every unit, or to the lot. */
  replacement_value?: number | null;
  insured?: boolean;
  /** Only for a depreciated line; none: the category's default. */
  recovery_period?: number | null;
}

/** One unit or lot as the database functions take it. */
export type LineUnitInput = {
  organization_id: string;
  line_index?: number;
  equipment_item_id?: string;
  manufacturer_model: string;
  category: string;
  type?: string | null;
  insurance_class?: string | null;
  description?: string | null;
  serial_number: string | null;
  tag_number: string | null;
  quantity: number;
  replacement_value?: number | null;
  insurance_policy_added?: boolean;
  recovery_period?: number | null;
};

const blank = (s: string | null | undefined) => !s || s.trim() === '';
const key = (s: string) => s.trim().toUpperCase();

/** Why these unit rows can't be saved: a row with neither, or a serial or tag used twice. */
export function unitRowProblems(rows: readonly UnitRow[]): string[] {
  const problems: string[] = [];
  rows.forEach((r, i) => {
    if (blank(r.serial_number) && blank(r.tag_number)) problems.push(`Unit ${i + 1} needs a serial number or a tag (either will do).`);
  });
  for (const field of ['tag_number', 'serial_number'] as const) {
    const seen = new Map<string, number>();
    rows.forEach((r, i) => {
      const v = r[field];
      if (blank(v)) return;
      const first = seen.get(key(v));
      if (first === undefined) seen.set(key(v), i);
      else problems.push(`Units ${first + 1} and ${i + 1} both have ${field === 'tag_number' ? 'tag' : 'serial'} ${rows[first][field].trim()}.`);
    });
  }
  return problems;
}

/** The unit rows for a new quantity: empty rows added at the end, or rows dropped from it. */
export function resizeUnitRows(rows: readonly UnitRow[], quantity: number): UnitRow[] {
  const n = Number.isFinite(quantity) && quantity >= 1 ? Math.floor(quantity) : 1;
  return Array.from({ length: n }, (_, i) => rows[i] ?? { serial_number: '', tag_number: '' });
}

/** The records one line's equipment makes. Throws if a units line's rows can't be saved. */
export function buildLineUnits(organizationId: string, lineIndex: number, quantity: number, eq: LineEquipment): LineUnitInput[] {
  const picked = eq.item.equipment_item_id;
  const fresh = eq.item as Extract<ItemChoice, { equipment_item_id?: undefined }>;
  const item = picked
    // The item's fields go on the records too, while assets still carries them (#180).
    ? { equipment_item_id: picked, manufacturer_model: eq.item.manufacturer_model, category: eq.item.category,
        type: eq.item.type ?? null, insurance_class: eq.item.insurance_class ?? null, description: eq.item.description ?? null }
    : {
        manufacturer_model: fresh.manufacturer_model.trim(),
        category: fresh.category.trim(),
        type: fresh.type?.trim() || null,
        insurance_class: fresh.insurance_class?.trim() || null,
        description: fresh.description?.trim() || null,
      };
  const shared = {
    organization_id: organizationId,
    line_index: lineIndex,
    ...item,
    replacement_value: eq.replacement_value ?? null,
    ...(eq.insured !== undefined ? { insurance_policy_added: eq.insured } : {}),
    ...(eq.recovery_period != null ? { recovery_period: eq.recovery_period } : {}),
  };

  if (eq.kind === 'lot') {
    return [{ ...shared, serial_number: null, tag_number: null, quantity: Math.max(1, quantity) }];
  }
  if (eq.units.length !== quantity) throw new Error(`This line has ${quantity} units but ${eq.units.length} rows.`);
  const problems = unitRowProblems(eq.units);
  if (problems.length) throw new Error(problems[0]);
  return eq.units.map((r) => ({
    ...shared,
    serial_number: r.serial_number.trim() || null,
    tag_number: r.tag_number.trim() || null,
    quantity: 1,
  }));
}
