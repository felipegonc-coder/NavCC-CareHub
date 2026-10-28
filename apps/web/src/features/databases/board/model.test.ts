import { describe, expect, it } from 'vitest';
import type { FileRef, Property, View } from '@carehub/databases';
import {
  fixtureRow,
  jobsDatabase,
  jobsProperties,
  jobsRows,
  PRIORITY,
  PROPS,
  queryRow,
  STATUS,
  testViewer,
  VIEWS,
} from '../test-utils';
import { BOARD_TEXT } from './messages';
import {
  beforeRowAt,
  boardColumns,
  boardLanes,
  canMoveTo,
  cardPicture,
  cardProperties,
  hasValue,
  laneValues,
  rowPlace,
  shownGroups,
  stepAlong,
  stepPicked,
  withGroupShown,
  type BoardGrid,
  type LineGrid,
  type Picked,
} from './model';

const properties = jobsProperties();
const ctx = {
  properties,
  viewer: testViewer(),
  userName: () => undefined,
};
const rows = jobsRows().map(queryRow);
const row = (id: string) => {
  const found = rows.find((r) => r.id === id);
  if (!found) throw new Error(`No row ${id}`);
  return found;
};
const property = (id: string): Property => {
  const found = properties.find((p) => p.id === id);
  if (!found) throw new Error(`No property ${id}`);
  return found;
};
const board = (): View => {
  const view = jobsDatabase().views.find((v) => v.id === VIEWS.board);
  if (!view) throw new Error('The fixture needs a board view.');
  return view;
};
const photo: FileRef = { id: 'file-sink', name: 'leak.jpg', size: 2048, mime: 'image/jpeg' };
const invoice: FileRef = {
  id: 'file-pdf',
  name: 'invoice.pdf',
  size: 900,
  mime: 'application/pdf',
};

describe('cardProperties', () => {
  it("lists the view's visible properties in its order, without the title", () => {
    const view = {
      properties: [
        { propertyId: PROPS.name, visible: true },
        { propertyId: PROPS.due, visible: true },
        { propertyId: PROPS.priority, visible: true },
        { propertyId: PROPS.cost, visible: false },
        { propertyId: 'prop-gone', visible: true },
      ],
    };
    const ids = properties.map((p) => p.id);
    expect(cardProperties(view, properties, ids).map((p) => p.id)).toEqual([
      PROPS.due,
      PROPS.priority,
    ]);
    // Properties the viewer can't see stay off the card.
    const seen = ids.filter((id) => id !== PROPS.due);
    expect(cardProperties(view, properties, seen).map((p) => p.id)).toEqual([PROPS.priority]);
  });
});

describe('hasValue', () => {
  it('skips empty values; a checkbox always shows', () => {
    expect(hasValue(property(PROPS.paid), { value: false })).toBe(true);
    expect(hasValue(property(PROPS.priority), { value: null })).toBe(false);
    expect(hasValue(property(PROPS.technician), { value: [] })).toBe(false);
    expect(hasValue(property(PROPS.cost), { value: '180' })).toBe(true);
    expect(hasValue(property(PROPS.notes), { value: null, computed: { kind: 'empty' } })).toBe(
      false,
    );
    expect(
      hasValue(property(PROPS.notes), { value: null, computed: { kind: 'number', value: 0 } }),
    ).toBe(true);
  });
});

describe('cardPicture', () => {
  it('takes the first picture of a Files property', () => {
    const withFiles = queryRow(
      fixtureRow('row-photos', 'Photos', 9, { 'prop-files': [invoice, photo] }),
    );
    expect(cardPicture(withFiles, { kind: 'files', propertyId: 'prop-files' })).toEqual({
      src: '/api/files/file-sink',
      name: 'leak.jpg',
    });
    const link: FileRef = {
      id: 'file-link',
      name: 'Heater',
      size: 0,
      mime: '',
      url: 'https://example.com/heater.png?v=2',
    };
    const linked = queryRow(fixtureRow('row-link', 'Link', 10, { 'prop-files': [link] }));
    expect(cardPicture(linked, { kind: 'files', propertyId: 'prop-files' })?.src).toBe(
      'https://example.com/heater.png?v=2',
    );
    const none = queryRow(fixtureRow('row-pdf', 'Invoice', 11, { 'prop-files': [invoice] }));
    expect(cardPicture(none, { kind: 'files', propertyId: 'prop-files' })).toBeNull();
    expect(cardPicture(withFiles, { kind: 'none' })).toBeNull();
  });

  it('shows the page cover and the first picture in the content once rows carry them', () => {
    const withCover = {
      ...row('row-sink'),
      cover: photo,
      contentPicture: { ...photo, id: 'file-2' },
    };
    expect(cardPicture(withCover, { kind: 'cover' })?.src).toBe('/api/files/file-sink');
    expect(cardPicture(withCover, { kind: 'content' })?.src).toBe('/api/files/file-2');
    expect(cardPicture(row('row-sink'), { kind: 'cover' })).toBeNull();
  });
});

describe('moves', () => {
  it('asks to write the group and lane a card lands in', () => {
    expect(rowPlace({ groupKey: 'a' }, { groupKey: 'b' }, 'row-x')).toEqual({
      beforeRowId: 'row-x',
      fromGroupKey: 'a',
      toGroupKey: 'b',
    });
    expect(
      rowPlace({ groupKey: 'a', laneKey: 'x' }, { groupKey: 'a', laneKey: 'y' }, null),
    ).toEqual({
      beforeRowId: null,
      fromGroupKey: 'a',
      toGroupKey: 'a',
      fromSubGroupKey: 'x',
      toSubGroupKey: 'y',
    });
  });

  it("offers only columns that can take the card's value", () => {
    const view = board();
    const from = { groupKey: STATUS.notStarted };
    expect(canMoveTo(row('row-heater'), view, from, { groupKey: STATUS.done }, ctx)).toBe(true);
    expect(canMoveTo(row('row-heater'), view, from, from, ctx)).toBe(true);
    const byDate = { ...view, grouping: { propertyId: PROPS.due, dateBucket: 'day' as const } };
    expect(
      canMoveTo(
        row('row-heater'),
        byDate,
        { groupKey: '2026-11-02' },
        { groupKey: '2026-11-03' },
        ctx,
      ),
    ).toBe(false);
  });

  it('finds the card a move lands before, leaving out the moving one', () => {
    const column = [row('row-heater'), row('row-drain'), row('row-sink')];
    expect(beforeRowAt(column, 'row-heater', 0)).toBe('row-drain');
    expect(beforeRowAt(column, 'row-heater', 2)).toBeNull();
  });

  it("fills in a lane's value for a new card made in it", () => {
    const view = { ...board(), subGrouping: { propertyId: PROPS.priority } };
    expect(laneValues(view, PRIORITY.low, ctx)).toEqual({ [PROPS.priority]: PRIORITY.low });
    expect(laneValues(view, '__empty__', ctx)).toBeUndefined();
    expect(laneValues(board(), PRIORITY.low, ctx)).toBeUndefined();
  });
});

describe('stepPicked', () => {
  const columns = { a: [row('row-heater'), row('row-drain')], b: [row('row-sink')], c: [] };
  const grid = (allowed = (key: string) => key !== 'x'): BoardGrid => ({
    columns: ['a', 'x', 'b', 'c'],
    lanes: [undefined],
    rowsIn: (slot) => columns[slot.groupKey as keyof typeof columns] ?? [],
    allowed: (slot) => allowed(slot.groupKey),
  });
  const picked: Picked = {
    rowId: 'row-drain',
    from: { groupKey: 'a' },
    fromIndex: 1,
    to: { groupKey: 'a' },
    index: 1,
  };

  it('moves up and down in a column, and stops at its ends', () => {
    expect(stepPicked(picked, 'ArrowUp', grid())?.index).toBe(0);
    expect(stepPicked(picked, 'ArrowDown', grid())).toBeNull();
    expect(stepPicked({ ...picked, index: 0 }, 'ArrowUp', grid())).toBeNull();
  });

  it("goes left and right to the next column that takes it, skipping ones that don't", () => {
    expect(stepPicked(picked, 'ArrowRight', grid())).toMatchObject({
      to: { groupKey: 'b' },
      index: 1,
    });
    expect(stepPicked({ ...picked, to: { groupKey: 'b' } }, 'ArrowRight', grid())).toMatchObject({
      to: { groupKey: 'c' },
      index: 0,
    });
    expect(stepPicked(picked, 'ArrowLeft', grid())).toBeNull();
  });

  it('moves into the lane below at the bottom of a column', () => {
    const lanes: BoardGrid = { ...grid(), lanes: ['high', 'low'], rowsIn: () => [] };
    const top: Picked = {
      ...picked,
      from: { groupKey: 'a', laneKey: 'high' },
      to: { groupKey: 'a', laneKey: 'high' },
      index: 0,
    };
    expect(stepPicked(top, 'ArrowDown', lanes)).toMatchObject({
      to: { groupKey: 'a', laneKey: 'low' },
      index: 0,
    });
    expect(stepPicked(top, 'ArrowUp', lanes)).toBeNull();
  });
});

describe('stepAlong', () => {
  // A gallery three cards to a line: group a has five, x takes nothing, b has one.
  const tap = queryRow(fixtureRow('row-tap', 'Fit outdoor tap', 9));
  const groups = {
    a: [...['row-sink', 'row-heater', 'row-boiler', 'row-drain'].map(row), tap],
    b: [row('row-sink')],
  };
  const grid = (patch: Partial<LineGrid> = {}): LineGrid => ({
    slots: ['a', 'x', 'b'],
    perLine: 3,
    sideways: true,
    rowsIn: (slot) => groups[slot.groupKey as keyof typeof groups] ?? [],
    allowed: (slot) => slot.groupKey !== 'x',
    ...patch,
  });
  const picked: Picked = {
    rowId: 'row-drain',
    from: { groupKey: 'a' },
    fromIndex: 3,
    to: { groupKey: 'a' },
    index: 3,
  };

  it('moves one place sideways and a line up or down', () => {
    expect(stepAlong(picked, 'ArrowLeft', grid())?.index).toBe(2);
    expect(stepAlong(picked, 'ArrowRight', grid())?.index).toBe(4);
    expect(stepAlong(picked, 'ArrowUp', grid())?.index).toBe(0);
    expect(stepAlong({ ...picked, index: 1 }, 'ArrowDown', grid())?.index).toBe(4);
  });

  it('goes on to the next group that takes it past either end', () => {
    expect(stepAlong({ ...picked, index: 4 }, 'ArrowRight', grid())).toMatchObject({
      to: { groupKey: 'b' },
      index: 0,
    });
    expect(stepAlong(picked, 'ArrowDown', grid())).toMatchObject({ to: { groupKey: 'b' } });
    const inB: Picked = { ...picked, to: { groupKey: 'b' }, index: 0 };
    expect(stepAlong(inB, 'ArrowLeft', grid())).toMatchObject({ to: { groupKey: 'a' }, index: 4 });
    expect(stepAlong({ ...picked, index: 0 }, 'ArrowLeft', grid())).toBeNull();
  });

  it('only moves up and down in a list', () => {
    const list = grid({ perLine: 1, sideways: false });
    expect(stepAlong(picked, 'ArrowLeft', list)).toBeNull();
    expect(stepAlong(picked, 'ArrowUp', list)?.index).toBe(2);
    expect(stepAlong({ ...picked, index: 4 }, 'ArrowDown', list)).toMatchObject({
      to: { groupKey: 'b' },
      index: 0,
    });
  });
});

describe('columns', () => {
  const group = (key: string, hidden: boolean, count = 0) => ({
    key,
    label: key,
    hidden,
    collapsedKey: key,
    count,
    totals: {},
    rows: [],
    nextCursor: null,
  });

  it('puts hidden groups aside, and Show takes a group off the hidden list', () => {
    const { shown, hidden } = boardColumns([group('a', false), group('b', true)]);
    expect(shown.map((g) => g.key)).toEqual(['a']);
    expect(hidden.map((g) => g.key)).toEqual(['b']);
    expect(withGroupShown({ propertyId: PROPS.status, hidden: ['b', 'c'] }, 'b')).toEqual({
      propertyId: PROPS.status,
      hidden: ['c'],
    });
  });

  it('leaves out groups and lanes without rows when the view hides empty groups', () => {
    const hideEmpty = { propertyId: PROPS.status, hideEmpty: true };
    const groups = [group('a', false, 2), group('b', false), group('c', true), group('d', true, 1)];
    const { shown, hidden } = boardColumns(groups, hideEmpty);
    expect(shown.map((g) => g.key)).toEqual(['a']);
    expect(hidden.map((g) => g.key)).toEqual(['d']);
    expect(boardColumns(groups, { propertyId: PROPS.status }).shown).toHaveLength(2);
    expect(shownGroups(groups, hideEmpty).map((g) => g.key)).toEqual(['a']);
    expect(shownGroups(groups, null).map((g) => g.key)).toEqual(['a', 'b']);
    const lane = (key: string, count: number) => ({
      key,
      label: key,
      hidden: false,
      collapsedKey: key,
      count,
    });
    expect(boardLanes([lane('x', 0), lane('y', 3)], hideEmpty)?.map((l) => l.key)).toEqual(['y']);
    expect(boardLanes([lane('x', 0)], null)).toHaveLength(1);
    expect(boardLanes(null, hideEmpty)).toBeNull();
  });
});

describe('BOARD_TEXT', () => {
  it('says every message in the words people read', () => {
    expect(BOARD_TEXT.moved('Call back Blue Pine Plumbing', 'Done')).toBe(
      "Moved 'Call back Blue Pine Plumbing' to Done",
    );
    expect(BOARD_TEXT.moveTo).toBe('Move to…');
    expect(BOARD_TEXT.newCard).toBe('New');
    expect(BOARD_TEXT.loadMore).toBe('Load more');
    expect(BOARD_TEXT.hiddenGroups).toBe('Hidden groups');
    expect(BOARD_TEXT.hiddenByFilter).toBe('Hidden by filter');
    expect(BOARD_TEXT.showGroup('Done')).toBe('Show Done');
    expect(BOARD_TEXT.cardMenu('Fix kitchen sink leak')).toBe(
      'Card menu for Fix kitchen sink leak',
    );
    expect(BOARD_TEXT.collapse('Done')).toBe('Collapse Done');
    expect(BOARD_TEXT.expand('Done')).toBe('Expand Done');
    expect(BOARD_TEXT.pickedUp('Fix kitchen sink leak')).toBe(
      "Picked up 'Fix kitchen sink leak'. Arrow keys move it, Space drops it, Esc cancels.",
    );
    expect(BOARD_TEXT.movingTo('Done', 2, 3)).toBe('Done, 2 of 3');
    expect(BOARD_TEXT.cancelled('Fix kitchen sink leak')).toBe(
      "Move cancelled. 'Fix kitchen sink leak' is back where it was.",
    );
    expect(BOARD_TEXT.inLane('Done', 'High')).toBe('Done, High');
    expect([BOARD_TEXT.open, BOARD_TEXT.duplicate, BOARD_TEXT.copyLink, BOARD_TEXT.delete]).toEqual(
      ['Open', 'Duplicate', 'Copy link', 'Delete'],
    );
    expect([BOARD_TEXT.linkCopied, BOARD_TEXT.linkNotCopied, BOARD_TEXT.show]).toEqual([
      'Link copied.',
      "Couldn't copy the link.",
      'Show',
    ]);
    expect(BOARD_TEXT.columnMenu('Done')).toBe('Column menu for Done');
    expect([
      BOARD_TEXT.hide,
      BOARD_TEXT.moveLeft,
      BOARD_TEXT.moveRight,
      BOARD_TEXT.calculate,
      BOARD_TEXT.columns,
    ]).toEqual(['Hide', 'Move left', 'Move right', 'Calculate', 'Columns']);
  });
});
