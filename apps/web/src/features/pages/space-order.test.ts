import { describe, expect, it } from 'vitest';
import { orderSpaces, placeSpace, stepSpace } from './space-order';

// Fictional spaces, in the server's order.
const spaces = [{ id: 'general' }, { id: 'care' }, { id: 'billing' }, { id: 'leads' }];
const ids = spaces.map((space) => space.id);

describe('orderSpaces', () => {
  it("keeps the server's order until the person picks one", () => {
    expect(orderSpaces(spaces, []).map((space) => space.id)).toEqual(ids);
  });

  it("follows the person's order, then adds spaces it doesn't name", () => {
    const order = ['billing', 'gone', 'general'];
    expect(orderSpaces(spaces, order).map((space) => space.id)).toEqual([
      'billing',
      'general',
      'care',
      'leads',
    ]);
  });
});

describe('placeSpace', () => {
  it('puts a space above or below another', () => {
    expect(placeSpace(ids, 'leads', 'care', 'before')).toEqual([
      'general',
      'leads',
      'care',
      'billing',
    ]);
    expect(placeSpace(ids, 'general', 'billing', 'after')).toEqual([
      'care',
      'billing',
      'general',
      'leads',
    ]);
  });

  it('gives null when nothing would change', () => {
    expect(placeSpace(ids, 'care', 'care', 'before')).toBeNull();
    expect(placeSpace(ids, 'care', 'billing', 'before')).toBeNull();
    expect(placeSpace(ids, 'care', 'general', 'after')).toBeNull();
    expect(placeSpace(ids, 'care', 'gone', 'after')).toBeNull();
  });
});

describe('stepSpace', () => {
  it('moves a space one place up or down', () => {
    expect(stepSpace(ids, 'care', -1)).toEqual(['care', 'general', 'billing', 'leads']);
    expect(stepSpace(ids, 'care', 1)).toEqual(['general', 'billing', 'care', 'leads']);
  });

  it('gives null at either end', () => {
    expect(stepSpace(ids, 'general', -1)).toBeNull();
    expect(stepSpace(ids, 'leads', 1)).toBeNull();
    expect(stepSpace(ids, 'gone', 1)).toBeNull();
  });
});
