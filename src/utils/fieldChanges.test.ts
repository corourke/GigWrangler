import { describe, it, expect } from 'vitest';
import { computeFieldChanges } from './fieldChanges';

// #20: one rule for asset, kit and money (Cameron 10-24): saved record before vs saved record
// after; no entry for empty-to-empty or unchanged values; from/to are the saved values.
describe('computeFieldChanges', () => {
  const fields = ['name', 'tags', 'price', 'notes'] as const;
  const changes = (before: Record<string, unknown>, after: Record<string, unknown>) =>
    computeFieldChanges<Record<string, unknown>>(before, after, fields);

  it('lists the tracked fields that changed, with from and to, in tracked order', () => {
    expect(changes({ name: 'Old', price: 5, notes: 'a' }, { name: 'New', price: 5, notes: 'b' }))
      .toEqual([{ field: 'name', from: 'Old', to: 'New' }, { field: 'notes', from: 'a', to: 'b' }]);
  });

  it('untracked fields never count', () => {
    expect(changes({ name: 'A', other: 1 }, { name: 'A', other: 2 })).toEqual([]);
  });

  it('null, undefined and empty text are the same: clearing an empty field is no change', () => {
    expect(changes({ notes: null }, { notes: '' })).toEqual([]);
    expect(changes({ notes: '' }, { notes: null })).toEqual([]);
    expect(changes({}, { notes: null })).toEqual([]);
  });

  it('an empty list or object is empty too (kit tags null -> [])', () => {
    expect(changes({ tags: null }, { tags: [] })).toEqual([]);
    expect(changes({ tags: [] }, { tags: null })).toEqual([]);
    expect(changes({ tags: {} }, { tags: undefined })).toEqual([]);
    expect(changes({ tags: [] }, { tags: ['a'] })).toEqual([{ field: 'tags', from: null, to: ['a'] }]);
    expect(changes({ tags: ['a'] }, { tags: [] })).toEqual([{ field: 'tags', from: ['a'], to: null }]);
  });

  it('from and to read null for empty', () => {
    expect(changes({ notes: '' }, { notes: 'x' })).toEqual([{ field: 'notes', from: null, to: 'x' }]);
    expect(changes({ notes: 'x' }, { notes: '' })).toEqual([{ field: 'notes', from: 'x', to: null }]);
  });

  it('lists and objects compare by their contents (kit tags)', () => {
    expect(changes({ tags: ['a', 'b'] }, { tags: ['a', 'b'] })).toEqual([]);
    expect(changes({ tags: ['a'] }, { tags: ['a', 'b'] })).toEqual([{ field: 'tags', from: ['a'], to: ['a', 'b'] }]);
  });

  it('the same saved value is no change', () => {
    expect(changes({ price: 5 }, { price: 5 })).toEqual([]);
  });
});
