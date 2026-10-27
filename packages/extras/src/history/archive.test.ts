import { describe, expect, it } from 'vitest';
import {
  archivedText,
  archiveDoneText,
  archiveQuestion,
  archiveTitle,
  subPagesText,
} from './index';

const TZ = 'America/Denver';

describe('Archive wording', () => {
  it('HT-14: the banner says who archived the page and on which day', () => {
    const sam = { id: 'u-sam', name: 'Sam Ortiz' };
    expect(archivedText({ by: sam, at: '2026-10-20T21:15:00Z' }, TZ)).toBe(
      'Archived by Sam Ortiz on Oct 20, 2026',
    );
    // Late in the evening in Denver is already the next day in UTC.
    expect(archivedText({ by: sam, at: '2026-10-21T04:30:00Z' }, TZ)).toBe(
      'Archived by Sam Ortiz on Oct 20, 2026',
    );
    expect(archivedText({ by: null, at: '2026-10-20T21:15:00Z' }, TZ)).toBe(
      'Archived on Oct 20, 2026',
    );
  });

  it('HT-14: archiving and unarchiving say how many sub-pages go along', () => {
    expect(subPagesText(1)).toBe('1 sub-page');
    expect(subPagesText(1240)).toBe('1,240 sub-pages');
    expect(archiveTitle('Policies')).toBe('Archive “Policies”?');
    expect(archiveTitle('  ')).toBe('Archive “Untitled”?');
    expect(archiveQuestion(12)).toBe(
      'The page and its 12 sub-pages turn read-only and leave the sidebar and search. Links still open them, and Unarchive puts everything back.',
    );
    expect(archiveQuestion(0)).toBe(
      'The page turns read-only and leaves the sidebar and search. Links still open it, and Unarchive puts it back.',
    );
    const change = { pageId: 'p-1', title: 'Policies', subPages: 12 };
    expect(archiveDoneText(change, true)).toBe('Archived “Policies” and its 12 sub-pages.');
    expect(archiveDoneText({ ...change, subPages: 1 }, false)).toBe(
      'Unarchived “Policies” and its 1 sub-page.',
    );
    expect(archiveDoneText({ ...change, subPages: 0 }, false)).toBe('Unarchived “Policies”.');
  });
});
