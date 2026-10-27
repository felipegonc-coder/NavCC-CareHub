import { describe, expect, it } from 'vitest';
import { galleryUrl, originTitle, readOrigin } from './links';

const pageId = '0b8e7f0e-3d0a-4c1e-8a59-9a7c6f0d4e21';

describe('the gallery address', () => {
  it('names the page it was opened from, and reads it back', () => {
    expect(galleryUrl()).toBe('/templates');
    const url = galleryUrl({ pageId, mode: 'apply' });
    expect(url).toBe(`/templates?to=${pageId}&mode=apply`);
    expect(readOrigin(new URL(url, 'https://carehub.example').searchParams)).toEqual({
      pageId,
      mode: 'apply',
    });
  });

  it('ignores addresses that don’t name a page', () => {
    expect(readOrigin(new URLSearchParams('to=not-a-page'))).toBeNull();
    expect(readOrigin(new URLSearchParams(`to=${pageId}&mode=other`))).toEqual({
      pageId,
      mode: 'page',
    });
  });

  it('takes the opener’s title from the history state', () => {
    expect(originTitle({ title: '  Q4 kickoff ' })).toBe('Q4 kickoff');
    expect(originTitle({ title: '' })).toBeNull();
    expect(originTitle(null)).toBeNull();
  });
});
