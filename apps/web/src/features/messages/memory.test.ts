import { beforeEach, describe, expect, it } from 'vitest';
import { draftOf, forgetViewer, keepDraft, noteViewer, onForget } from './memory';

let forgotten = 0;
onForget(() => {
  forgotten += 1;
});

beforeEach(() => {
  forgetViewer();
  forgotten = 0;
});

describe('what Messages keeps in memory', () => {
  it('keeps a draft per chat, and an empty composer removes it', () => {
    keepDraft('c-1', 'See you at');
    keepDraft('c-2', 'Thanks');
    keepDraft('c-2', '');
    expect(draftOf('c-1')).toBe('See you at');
    expect(draftOf('c-2')).toBe('');
  });

  it('forgets the drafts and the unsent messages at sign-out', () => {
    keepDraft('c-1', 'See you at');
    forgetViewer();
    expect(draftOf('c-1')).toBe('');
    expect(forgotten).toBe(1);
  });

  it('forgets them when someone else signs in, and only then', () => {
    noteViewer('u-avery');
    keepDraft('c-1', 'See you at');
    noteViewer('u-avery');
    expect(draftOf('c-1')).toBe('See you at');
    expect(forgotten).toBe(0);

    noteViewer('u-blake');
    expect(draftOf('c-1')).toBe('');
    expect(forgotten).toBe(1);
  });
});
