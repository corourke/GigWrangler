import { describe, it, expect } from 'vitest';
import { classifyItem, EQUIPMENT_SUGGESTION_MIN_PRICE } from './classifyItem';

// The scan suggests a line as equipment ("Asset") when it is durable and costs at least $50 a
// piece; consumables never (B18). This is a suggestion to track it, not a tax answer.
describe('classifyItem', () => {
  it('a durable item at $50 or more is suggested as equipment', () => {
    expect(EQUIPMENT_SUGGESTION_MIN_PRICE).toBe(50);
    expect(classifyItem({ is_durable: true, item_price: 50 })).toBe('Asset');
    expect(classifyItem({ is_durable: true, item_price: 1200 })).toBe('Asset');
  });
  it('a durable item under $50 is an expense', () => {
    expect(classifyItem({ is_durable: true, item_price: 49.99 })).toBe('Expense');
  });
  it('a consumable is an expense at any price', () => {
    expect(classifyItem({ is_durable: true, is_consumable: true, item_price: 900 })).toBe('Expense');
  });
  it('an item not marked durable, or with no price, is an expense', () => {
    expect(classifyItem({ item_price: 500 })).toBe('Expense');
    expect(classifyItem({ is_durable: true, item_price: null })).toBe('Expense');
  });
});
