import { describe, expect, it } from 'vitest';
import { EMPTY_GROUP, type EvalContext, type Grouping, type View } from '@carehub/databases';
import {
  jobsProperties,
  jobsRows,
  PRIORITY,
  PROPS,
  queryRow,
  STATUS,
  testViewer,
} from '../fixtures';
import { moveValues, storedRow } from './moves';

const ctx: EvalContext = {
  properties: jobsProperties(),
  viewer: testViewer(),
  userName: () => undefined,
};

function row(id: string) {
  const found = jobsRows().find((r) => r.id === id);
  if (!found) throw new Error(`No fixture row ${id}.`);
  return queryRow(found);
}

const byStatus: Grouping = { propertyId: PROPS.status };
const byPriority: Grouping = { propertyId: PROPS.priority };
const board: Pick<View, 'grouping' | 'subGrouping'> = { grouping: byStatus, subGrouping: null };

describe('moveValues', () => {
  it("writes the column's option when a card moves to another column", () => {
    const place = { fromGroupKey: STATUS.notStarted, toGroupKey: STATUS.done };
    expect(moveValues(row('row-heater'), board, place, ctx)).toEqual({
      [PROPS.status]: STATUS.done,
    });
  });

  it('writes the lane too on a board with sub-groups', () => {
    const lanes = { grouping: byStatus, subGrouping: byPriority };
    const place = {
      fromGroupKey: STATUS.notStarted,
      toGroupKey: STATUS.inProgress,
      fromSubGroupKey: PRIORITY.high,
      toSubGroupKey: PRIORITY.low,
    };
    expect(moveValues(row('row-heater'), lanes, place, ctx)).toEqual({
      [PROPS.status]: STATUS.inProgress,
      [PROPS.priority]: PRIORITY.low,
    });
  });

  it('clears the value when a card moves to "No value"', () => {
    const place = { fromGroupKey: STATUS.notStarted, toGroupKey: EMPTY_GROUP };
    expect(moveValues(row('row-heater'), board, place, ctx)).toEqual({ [PROPS.status]: null });
  });

  it('writes nothing for a move inside one group', () => {
    const place = { fromGroupKey: STATUS.done, toGroupKey: STATUS.done, beforeRowId: null };
    expect(moveValues(row('row-boiler'), board, place, ctx)).toEqual({});
    expect(moveValues(row('row-boiler'), { grouping: null, subGrouping: null }, {}, ctx)).toEqual(
      {},
    );
  });

  it("is null when the group can't set the value", () => {
    const byDue = { grouping: { propertyId: PROPS.due }, subGrouping: null };
    const place = { fromGroupKey: 'today', toGroupKey: 'tomorrow' };
    expect(moveValues(row('row-sink'), byDue, place, ctx)).toBeNull();
  });

  it("is null when the row isn't loaded", () => {
    const place = { fromGroupKey: STATUS.notStarted, toGroupKey: STATUS.done };
    expect(moveValues(undefined, board, place, ctx)).toBeNull();
  });
});

describe('storedRow', () => {
  it('keeps the values the engine reads', () => {
    const stored = storedRow(row('row-sink'));
    expect(stored.id).toBe('row-sink');
    expect(stored.values[PROPS.status]).toBe(STATUS.inProgress);
  });
});
