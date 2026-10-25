import type { FieldChange } from './supabase/types';

const isEmpty = (v: unknown) =>
  v === null || v === undefined || v === ''
  || (Array.isArray(v) && v.length === 0)
  || (typeof v === 'object' && v !== null && !Array.isArray(v) && Object.keys(v).length === 0);
/** Empty (null, undefined, '', [] or {}) reads as null; anything else as itself. */
const orNull = (v: unknown) => (isEmpty(v) ? null : v);

const same = (a: unknown, b: unknown) => {
  const x = orNull(a);
  const y = orNull(b);
  return x === y || (typeof x === 'object' && x !== null && typeof y === 'object' && y !== null
    && JSON.stringify(x) === JSON.stringify(y));
};

/**
 * The tracked fields a save changed, for the activity log (#20, one rule for asset, kit and
 * money, Cameron 10-24). Compares the record as saved before with the record as saved after, so
 * the log shows what the database holds, not what the screen sent:
 *  - empty values (null, undefined, '', an empty list or object) are all the same, so clearing an
 *    empty field is no change;
 *  - lists and objects (a kit's tags) compare by their contents;
 *  - from and to are the saved values, with null for empty.
 * Fields come out in the order they're tracked.
 */
export function computeFieldChanges<T extends Record<string, any>>(
  before: Partial<T>,
  after: Partial<T>,
  trackedFields: readonly (keyof T)[]
): FieldChange[] {
  return trackedFields
    .filter(f => !same(before[f], after[f]))
    .map(f => ({
      field: f as string,
      from: orNull(before[f]),
      to: orNull(after[f]),
    }));
}
