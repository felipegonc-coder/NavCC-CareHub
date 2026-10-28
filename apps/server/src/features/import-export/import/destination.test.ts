import type { AccessLevel } from '@carehub/shared';
import { afterEach, describe, expect, it } from 'vitest';
import type { Db } from '../../../db';
import { HIDDEN_TITLE, checkDestination, destinationTitle } from './destination';
import { bindImportPorts } from './ports';

const db = {} as Db;
const workspaceId = '00000000-0000-4000-8000-000000000100';
const spaceId = '00000000-0000-4000-8000-000000000101';
const pageId = '00000000-0000-4000-8000-000000000102';
const userId = '00000000-0000-4000-8000-000000000103';

let unbind: (() => void) | null = null;
afterEach(() => {
  unbind?.();
  unbind = null;
});

function fake(options: { level?: AccessLevel | null; title?: string; create?: boolean }) {
  const { level = null, title = 'Care team', create = true } = options;
  unbind = bindImportPorts({
    pageAccess: async () => (level === null ? null : { workspaceId, level, title }),
    privateSpace: async () => ({ workspaceId, spaceId }),
    canCreatePages: async () => create,
  });
}

describe('checkDestination', () => {
  it('takes a page the person can edit, or their Private space', async () => {
    fake({ level: 'edit' });
    expect(await checkDestination(db, userId, pageId)).toEqual({
      ok: true,
      target: { workspaceId, pageId, spaceId: null },
      title: 'Care team',
    });
    expect(await checkDestination(db, userId, null)).toEqual({
      ok: true,
      target: { workspaceId, pageId: null, spaceId },
      title: 'Private',
    });
  });

  it("hides pages the person can't open and refuses the rest", async () => {
    fake({ level: null });
    expect(await checkDestination(db, userId, pageId)).toEqual({ ok: false, code: 'not_found' });
    unbind?.();
    fake({ level: 'none' });
    expect(await checkDestination(db, userId, pageId)).toEqual({ ok: false, code: 'not_found' });
    for (const level of ['view', 'comment', 'edit_content'] as const) {
      unbind?.();
      fake({ level });
      expect(await checkDestination(db, userId, pageId)).toEqual({ ok: false, code: 'forbidden' });
    }
  });

  it('refuses people who may not create pages', async () => {
    fake({ level: 'full', create: false });
    expect(await checkDestination(db, userId, pageId)).toEqual({ ok: false, code: 'forbidden' });
    expect(await checkDestination(db, userId, null)).toEqual({ ok: false, code: 'forbidden' });
  });

  it('refuses everything while the stand-ins are there', async () => {
    expect(await checkDestination(db, userId, pageId)).toEqual({ ok: false, code: 'not_found' });
    expect(await checkDestination(db, userId, null)).toEqual({ ok: false, code: 'forbidden' });
  });
});

describe('destinationTitle', () => {
  it('names the page as the person sees it now', async () => {
    expect(await destinationTitle(db, userId, null)).toBe('Private');
    fake({ level: 'view', title: '  ' });
    expect(await destinationTitle(db, userId, pageId)).toBe('Untitled');
    unbind?.();
    fake({ level: 'none', title: 'Payroll' });
    expect(await destinationTitle(db, userId, pageId)).toBe(HIDDEN_TITLE);
  });
});
