import { describe, expect, it } from 'vitest';
import { blockAnchorId, blockIdFromHash, courseHref, lessonHref, linkTarget } from './links';
import { helpDesk } from './test-course';

describe('linkTarget', () => {
  it('opens https addresses in a new tab and mailto addresses in place', () => {
    expect(linkTarget(helpDesk, { kind: 'url', url: 'https://help.example.com/refunds' })).toEqual({
      kind: 'external',
      href: 'https://help.example.com/refunds',
      newTab: true,
    });
    expect(linkTarget(helpDesk, { kind: 'url', url: 'mailto:desk@example.com' })).toEqual({
      kind: 'external',
      href: 'mailto:desk@example.com',
      newTab: false,
    });
  });

  it("refuses addresses that aren't https or mailto, in plain words", () => {
    for (const url of [
      'javascript:alert(1)',
      'http://example.com',
      'https://someone@example.com',
      'data:text/html,hi',
    ]) {
      expect(linkTarget(helpDesk, { kind: 'url', url })).toEqual({
        kind: 'broken',
        reason: "This link can't be opened because its address isn't valid.",
      });
    }
  });

  it('sends Care Hub page links to /p/<pageId>', () => {
    expect(linkTarget(helpDesk, { kind: 'page', pageId: 'kb:refunds.v2' })).toEqual({
      kind: 'page',
      href: '/p/kb%3Arefunds.v2',
      pageId: 'kb:refunds.v2',
    });
  });

  it('goes to a lesson and block in this course', () => {
    expect(linkTarget(helpDesk, { kind: 'lesson', lessonId: 'l-esc', blockId: 'b-esc-p' })).toEqual(
      {
        kind: 'lesson',
        href: '/learning/courses/c-help-desk/lessons/l-esc#block-b-esc-p',
        lessonId: 'l-esc',
        blockId: 'b-esc-p',
        lessonTitle: 'Escalations',
      },
    );
    expect(linkTarget(helpDesk, { kind: 'lesson', lessonId: 'l-refunds' })).toEqual({
      kind: 'lesson',
      href: '/learning/courses/c-help-desk/lessons/l-refunds',
      lessonId: 'l-refunds',
      lessonTitle: 'Résumé of the refund policy',
    });
  });

  it('still opens the lesson when the linked block is gone or the lesson is a quiz', () => {
    const gone = linkTarget(helpDesk, { kind: 'lesson', lessonId: 'l-esc', blockId: 'b-removed' });
    expect(gone).toEqual({
      kind: 'lesson',
      href: '/learning/courses/c-help-desk/lessons/l-esc',
      lessonId: 'l-esc',
      lessonTitle: 'Escalations',
    });
    expect(
      linkTarget(helpDesk, { kind: 'lesson', lessonId: 'l-quiz', blockId: 'b-esc-p' }),
    ).toMatchObject({
      href: '/learning/courses/c-help-desk/lessons/l-quiz',
    });
  });

  it('marks a link to a lesson that is no longer in the course as broken', () => {
    expect(linkTarget(helpDesk, { kind: 'lesson', lessonId: 'l-old' })).toEqual({
      kind: 'broken',
      reason: 'This link goes to a lesson that is no longer in this course.',
    });
  });

  it('sends button file targets to the core files address, in a new tab', () => {
    expect(linkTarget(helpDesk, { kind: 'file', fileId: 'f-guide' })).toEqual({
      kind: 'file',
      href: '/api/files/f-guide',
      fileId: 'f-guide',
      newTab: true,
    });
    expect(linkTarget(helpDesk, { kind: 'file', fileId: 'f 1/2' })).toMatchObject({
      href: '/api/files/f%201%2F2',
    });
  });
});

describe('course and lesson addresses', () => {
  it('builds player addresses and block anchors', () => {
    expect(courseHref('c-help-desk')).toBe('/learning/courses/c-help-desk');
    expect(lessonHref('c-help-desk', 'l-esc')).toBe('/learning/courses/c-help-desk/lessons/l-esc');
    expect(lessonHref('c-help-desk', 'l-esc', 'b_1')).toBe(
      '/learning/courses/c-help-desk/lessons/l-esc#block-b_1',
    );
    expect(blockAnchorId('b-esc-p')).toBe('block-b-esc-p');
  });

  it('reads the block id back from a URL fragment', () => {
    expect(blockIdFromHash('#block-b-esc-p')).toBe('b-esc-p');
    expect(blockIdFromHash('block-b_1')).toBe('b_1');
    expect(blockIdFromHash('#top')).toBeNull();
    expect(blockIdFromHash('#block-')).toBeNull();
    expect(blockIdFromHash('#block-a%20b')).toBeNull();
    expect(blockIdFromHash('#block-%E0%A4%A')).toBeNull();
    expect(blockIdFromHash('')).toBeNull();
  });
});
