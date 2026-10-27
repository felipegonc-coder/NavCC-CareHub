import { describe, expect, it } from 'vitest';
import {
  COALESCE_MS,
  HISTORY_LIMIT,
  canRedo,
  canUndo,
  createHistory,
  pushHistory,
  redoHistory,
  undoHistory,
} from './history';

describe('undo and redo history', () => {
  it('undoes and redoes edits in order', () => {
    let h = createHistory('a');
    expect(canUndo(h)).toBe(false);
    h = pushHistory(h, 'b');
    h = pushHistory(h, 'c');
    h = undoHistory(h);
    expect(h.present).toBe('b');
    expect(canRedo(h)).toBe(true);
    h = undoHistory(h);
    expect(h.present).toBe('a');
    expect(undoHistory(h)).toBe(h);
    h = redoHistory(redoHistory(h));
    expect(h.present).toBe('c');
    expect(redoHistory(h)).toBe(h);
  });

  it('ignores an edit that keeps the same value', () => {
    const h = createHistory({ title: 'Welcome' });
    expect(pushHistory(h, h.present)).toBe(h);
  });

  it('drops redo steps after a new edit', () => {
    const h = pushHistory(undoHistory(pushHistory(createHistory(1), 2)), 3);
    expect(h.present).toBe(3);
    expect(canRedo(h)).toBe(false);
    expect(undoHistory(h).present).toBe(1);
  });

  it('merges quick edits to the same field into one step', () => {
    let h = createHistory('');
    h = pushHistory(h, 'H', { group: 'text:b1', at: 1_000 });
    h = pushHistory(h, 'Hi', { group: 'text:b1', at: 1_000 + COALESCE_MS - 1 });
    h = pushHistory(h, 'Hi!', { group: 'text:b1', at: 1_000 + COALESCE_MS * 2 });
    h = pushHistory(h, 'Hi!?', { group: 'text:b2', at: 1_000 + COALESCE_MS * 2 + 1 });
    expect(h.past).toEqual(['', 'Hi', 'Hi!']);
    h = undoHistory(h);
    // Undo ends the group, so the next edit is a new step.
    h = pushHistory(h, 'Hi!!', { group: 'text:b1', at: 1_000 + COALESCE_MS * 2 + 2 });
    expect(h.past).toEqual(['', 'Hi', 'Hi!']);
  });

  it('keeps at most the last 100 steps', () => {
    let h = createHistory(0);
    for (let i = 1; i <= HISTORY_LIMIT + 20; i++) h = pushHistory(h, i);
    expect(h.past).toHaveLength(HISTORY_LIMIT);
    expect(h.past[0]).toBe(20);
  });
});
