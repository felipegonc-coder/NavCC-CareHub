import { describe, expect, it } from 'vitest';
import { EditHistory, type AddedRow, type Step } from './history';

const edit = (rowId: string, before: unknown, after: unknown): Step => ({
  values: [{ rowId, propertyId: 'prop-cost', before, after }],
  added: [],
});
const added = (rowId: string | null): AddedRow => ({
  input: { title: 'Fit new tap' },
  sectionKey: '',
  rowId,
  undone: false,
});

describe('EditHistory', () => {
  it('undoes the last change first and redoes it again', () => {
    const history = new EditHistory();
    const first = edit('row-sink', '180', '200');
    const second = edit('row-heater', '1450', null);
    history.record(first);
    history.record(second);
    expect(history.undo()).toBe(second);
    expect(history.undo()).toBe(first);
    expect(history.undo()).toBeUndefined();
    expect(history.redo()).toBe(first);
    expect(history.redo()).toBe(second);
    expect(history.redo()).toBeUndefined();
  });

  it('keeps the last 20 changes, and a new change ends redo', () => {
    const history = new EditHistory();
    for (let i = 0; i < 25; i++) history.record(edit(`row-${i}`, null, i));
    let count = 0;
    while (history.undo()) count += 1;
    expect(count).toBe(20);
    history.redo();
    history.record(edit('row-new', null, 1));
    expect(history.redo()).toBeUndefined();
  });

  it('leaves out steps that change nothing', () => {
    const history = new EditHistory();
    history.record({ values: [], added: [] });
    expect(history.undo()).toBeUndefined();
  });

  it('follows rows made again by redo', () => {
    const history = new EditHistory();
    history.rename('row-new', 'row-new-2');
    history.rename('row-new-2', 'row-new-3');
    expect(history.idOf('row-new')).toBe('row-new-3');
    expect(history.idOf('row-sink')).toBe('row-sink');
    history.rename('row-new-3', 'row-new');
    expect(['row-new', 'row-new-2', 'row-new-3']).toContain(history.idOf('row-new'));
  });

  it('forgets rows moved to Trash, and steps left with nothing', () => {
    const history = new EditHistory();
    const paste: Step = {
      values: [
        { rowId: 'row-sink', propertyId: 'prop-cost', before: '180', after: '200' },
        { rowId: 'row-heater', propertyId: 'prop-cost', before: '1450', after: '1500' },
      ],
      added: [added('row-new')],
    };
    history.record(edit('row-heater', null, '1'));
    history.record(paste);
    history.forget(new Set(['row-heater', 'row-new']));
    const left = history.undo();
    expect(left?.values.map((v) => v.rowId)).toEqual(['row-sink']);
    expect(left?.added).toEqual([]);
    expect(history.undo()).toBeUndefined();
  });

  it('clear empties it', () => {
    const history = new EditHistory();
    history.record(edit('row-sink', '180', '200'));
    history.clear();
    expect(history.undo()).toBeUndefined();
  });
});
