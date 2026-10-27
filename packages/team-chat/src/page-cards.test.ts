import { describe, expect, it } from 'vitest';
import {
  cantOpenWarning,
  pageCardDataSchema,
  viewerPageCard,
  viewerPageCardSchema,
} from './page-cards';

const page = {
  id: 'p1',
  kind: 'page',
  title: 'Coaching plan – Q4',
  icon: '📋',
  spaceName: 'Care Team Demo',
};

describe('MS-03 page cards per viewer', () => {
  it('shows the page to people who can open it', () => {
    expect(viewerPageCard('p1', page, true)).toEqual({
      id: 'p1',
      state: 'open',
      kind: 'page',
      title: 'Coaching plan – Q4',
      icon: '📋',
      spaceName: 'Care Team Demo',
    });
  });

  it("sends no title, icon or space to people who can't open it", () => {
    const card = viewerPageCard('p1', page, false);
    expect(card).toEqual({ id: 'p1', state: 'locked' });
    expect(Object.keys(card)).toEqual(['id', 'state']);
    expect(JSON.stringify(card)).not.toContain('Coaching');
  });

  it('shows deleted pages as deleted, to everyone', () => {
    expect(viewerPageCard('p1', null, true)).toEqual({ id: 'p1', state: 'deleted' });
    expect(viewerPageCard('p1', null, false)).toEqual({ id: 'p1', state: 'deleted' });
  });

  it('reads the card API and parses cards on the web', () => {
    expect(pageCardDataSchema.parse({ ...page, icon: null })).toEqual({ ...page, icon: null });
    expect(pageCardDataSchema.safeParse({ id: 'p1', kind: 'page' }).success).toBe(false);
    expect(viewerPageCardSchema.parse({ id: 'p1', state: 'locked' })).toEqual({
      id: 'p1',
      state: 'locked',
    });
    expect(viewerPageCardSchema.safeParse({ id: 'p1', state: 'open' }).success).toBe(false);
  });

  it('warns the sender first', () => {
    expect(cantOpenWarning('Coaching plan – Q4', ['Sam'])).toBe(
      "Sam can't open 'Coaching plan – Q4'.",
    );
    expect(cantOpenWarning('QA form', ['Sam Ortiz', 'Riley Chen'])).toBe(
      "Sam Ortiz and Riley Chen can't open 'QA form'.",
    );
  });
});
