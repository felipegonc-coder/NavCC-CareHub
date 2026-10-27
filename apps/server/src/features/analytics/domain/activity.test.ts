import { describe, expect, it } from 'vitest';
import {
  ACTIVITY_KINDS,
  COUNT_ONCE_MS,
  countOnceWindow,
  isRecorded,
  type ActivityContext,
} from './activity';

const person: ActivityContext = { actor: 'person', privateSpace: false, inTrash: false };

describe('counting once', () => {
  it('AN-01, AN-02: views count once per 30 minutes and edits once per 10 minutes', () => {
    expect(COUNT_ONCE_MS).toEqual({ view: 30 * 60_000, edit: 10 * 60_000 });
    expect(countOnceWindow('view')).toBe(30 * 60_000);
    expect(countOnceWindow('edit')).toBe(10 * 60_000);
  });

  it('counts every create, delete and restore', () => {
    expect(countOnceWindow('create')).toBe(0);
    expect(countOnceWindow('delete')).toBe(0);
    expect(countOnceWindow('restore')).toBe(0);
  });
});

describe('isRecorded', () => {
  it('records what people do in team spaces', () => {
    for (const kind of ACTIVITY_KINDS) expect(isRecorded(kind, person)).toBe(true);
  });

  it('AN-09: never records automations or imports', () => {
    for (const kind of ACTIVITY_KINDS) {
      expect(isRecorded(kind, { ...person, actor: 'automation' })).toBe(false);
      expect(isRecorded(kind, { ...person, actor: 'import' })).toBe(false);
    }
  });

  it('AN-03: records nothing in private spaces', () => {
    for (const kind of ACTIVITY_KINDS) {
      expect(isRecorded(kind, { ...person, privateSpace: true })).toBe(false);
      expect(isRecorded(kind, { ...person, privateSpace: true, inTrash: true })).toBe(false);
    }
  });

  it('records only restores of pages in the Trash', () => {
    const inTrash = { ...person, inTrash: true };
    expect(ACTIVITY_KINDS.filter((kind) => isRecorded(kind, inTrash))).toEqual(['restore']);
  });
});
