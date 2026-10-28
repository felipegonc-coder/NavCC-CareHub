import { describe, expect, it } from 'vitest';
import { UNKNOWN_ERROR_MESSAGE, type ButtonRunAnswer } from '../api';
import { pressToast } from './press';

function run(change: Partial<ButtonRunAnswer> = {}): ButtonRunAnswer {
  return { status: 'done', runId: 'run-1', message: null, undoUntil: null, open: [], ...change };
}

const UNTIL = '2026-10-28T15:00:08.000Z';

describe('pressToast', () => {
  it('says Done with Undo when the run changed something', () => {
    expect(pressToast(run({ message: 'Done · Undo', undoUntil: UNTIL }))).toEqual({
      message: 'Done',
      undo: true,
    });
    expect(pressToast(run({ message: 'Done · 3 skipped · Undo', undoUntil: UNTIL }))).toEqual({
      message: 'Done · 3 skipped',
      undo: true,
    });
    expect(pressToast(run({ undoUntil: UNTIL }))).toEqual({ message: 'Done', undo: true });
  });

  it('says nothing for a run that changed nothing, and counts what it skipped', () => {
    expect(pressToast(run())).toBeNull();
    expect(pressToast(run({ message: '3 skipped' }))).toEqual({
      message: '3 skipped',
      undo: false,
    });
  });

  it("gives a failure in the server's words, with Undo for the steps before it", () => {
    const message = "Couldn't finish step 2: Tickets is in Trash.";
    expect(pressToast(run({ status: 'failed', message }))).toEqual({ message, undo: false });
    expect(pressToast(run({ status: 'failed', message, undoUntil: UNTIL }))).toEqual({
      message,
      undo: true,
    });
    expect(pressToast(run({ status: 'failed' }))).toEqual({
      message: UNKNOWN_ERROR_MESSAGE,
      undo: false,
    });
  });
});
