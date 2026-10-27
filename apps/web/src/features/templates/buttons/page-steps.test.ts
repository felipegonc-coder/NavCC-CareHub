import type { PageStep } from '@carehub/extras/templates/buttons';
import { describe, expect, it } from 'vitest';
import { OTHER_PAGE_ID, PAGE_ID } from './fixtures';
import { doPageSteps, NOT_ON_PAGE, type PageStepDeps } from './page-steps';

const notes = { type: 'paragraph', content: [{ type: 'text', text: 'Call notes' }] };

/** A page that logs what the steps do; `insertWorks: false` is a button that's gone. */
function fakePage({ insertWorks = true } = {}) {
  const log: string[] = [];
  const deps: PageStepDeps = {
    insertBlocks: (where, blocks) => {
      if (!insertWorks) return null;
      log.push(`insert ${blocks.length} ${where}`);
      return () => {
        log.push(`take out ${where}`);
        return true;
      };
    },
    openPage: (pageId, openIn) => log.push(`open ${pageId} in ${openIn}`),
    openLink: (url) => log.push(`link ${url}`),
  };
  return { log, deps };
}

describe('doPageSteps', () => {
  it('does the steps in order and opens a page in this tab last', () => {
    const { log, deps } = fakePage();
    const steps: PageStep[] = [
      { index: 0, kind: 'open_page', pageId: PAGE_ID, openIn: 'this_tab' },
      { index: 1, kind: 'insert_blocks', where: 'below', blocks: [notes] },
      { index: 2, kind: 'open_link', url: 'https://example.org/intake' },
      { index: 4, kind: 'open_page', pageId: OTHER_PAGE_ID, openIn: 'new_tab' },
    ];
    const result = doPageSteps(steps, deps);
    expect(log).toEqual([
      'insert 1 below',
      'link https://example.org/intake',
      `open ${OTHER_PAGE_ID} in new_tab`,
      `open ${PAGE_ID} in this_tab`,
    ]);
    expect(result.failure).toBeNull();
    expect(result.changed).toBe(true);
    expect(result.undo).toHaveLength(1);
  });

  it('stops at blocks it can’t insert, with the step’s number', () => {
    const { log, deps } = fakePage({ insertWorks: false });
    const result = doPageSteps(
      [
        { index: 1, kind: 'insert_blocks', where: 'above', blocks: [notes] },
        { index: 2, kind: 'open_page', pageId: PAGE_ID, openIn: 'this_tab' },
      ],
      deps,
    );
    expect(result.failure).toEqual({ step: 2, message: NOT_ON_PAGE });
    expect(result.changed).toBe(false);
    expect(log).toEqual([]);
  });

  it('takes out the newest blocks first', () => {
    const { log, deps } = fakePage();
    const result = doPageSteps(
      [
        { index: 0, kind: 'insert_blocks', where: 'above', blocks: [notes] },
        { index: 1, kind: 'insert_blocks', where: 'below', blocks: [notes, notes] },
      ],
      deps,
    );
    for (const step of result.undo) step();
    expect(log).toEqual(['insert 1 above', 'insert 2 below', 'take out below', 'take out above']);
  });

  it('skips Insert blocks with nothing to insert', () => {
    const { log, deps } = fakePage({ insertWorks: false });
    const result = doPageSteps(
      [{ index: 0, kind: 'insert_blocks', where: 'below', blocks: [] }],
      deps,
    );
    expect(result).toEqual({ failure: null, undo: [], changed: false });
    expect(log).toEqual([]);
  });
});
