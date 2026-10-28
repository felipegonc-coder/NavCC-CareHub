import { describe, expect, it } from 'vitest';
import { LIMITS, type Property, type Sort } from '@carehub/databases';
import { jobsProperties, PROPS } from '../fixtures';
import {
  addSort,
  canAddSort,
  changeSort,
  dropIndex,
  moveSort,
  removeSort,
  sortableProperties,
} from './sort-model';

const props = jobsProperties();
const files: Property = {
  id: 'prop-photos',
  name: 'Photos',
  description: '',
  rowPage: 'always',
  config: { type: 'files' },
};
const due: Sort = { propertyId: PROPS.due, direction: 'asc' };
const cost: Sort = { propertyId: PROPS.cost, direction: 'desc' };
const name: Sort = { propertyId: PROPS.name, direction: 'asc' };

describe('sorts', () => {
  it('sorts only by properties that can sort and that the viewer sees', () => {
    expect(sortableProperties([...props, files]).map((p) => p.id)).toEqual(props.map((p) => p.id));
    expect(sortableProperties(props, [PROPS.cost]).map((p) => p.id)).toEqual([PROPS.cost]);
  });

  it('adds an ascending sort on the first property not sorted yet', () => {
    expect(addSort([], props)).toEqual([name]);
    expect(addSort([name], props)).toEqual([name, { propertyId: PROPS.status, direction: 'asc' }]);
  });

  it('stops at 10 sorts or when every property is sorted', () => {
    const one = props.slice(0, 1);
    expect(canAddSort([name], one)).toBe(false);
    expect(addSort([name], one)).toEqual([name]);
    const many = Array.from({ length: LIMITS.sorts + 2 }, (_, i): Property => ({
      ...files,
      id: `p${i}`,
      config: { type: 'text' },
    }));
    let sorts: Sort[] = [];
    for (let i = 0; i < LIMITS.sorts + 2; i++) sorts = addSort(sorts, many);
    expect(sorts).toHaveLength(LIMITS.sorts);
  });

  it('moves, changes and removes sorts', () => {
    expect(moveSort([name, due, cost], 2, 0)).toEqual([cost, name, due]);
    expect(moveSort([name, due, cost], 0, 2)).toEqual([due, cost, name]);
    expect(moveSort([name, due], 5, 0)).toEqual([name, due]);
    expect(changeSort([name, due], 1, { direction: 'desc' })).toEqual([
      name,
      { ...due, direction: 'desc' },
    ]);
    expect(removeSort([name, due, cost], 1)).toEqual([name, cost]);
  });

  it('drops a dragged sort where the pointer is', () => {
    const middles = [10, 30, 50];
    expect(dropIndex(middles, 0, 2)).toBe(0);
    expect(dropIndex(middles, 35, 0)).toBe(1);
    expect(dropIndex(middles, 99, 0)).toBe(2);
    expect(dropIndex(middles, 20, 1)).toBe(1);
  });
});
