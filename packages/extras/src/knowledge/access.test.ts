import { describe, expect, it } from 'vitest';
import {
  canChangeOwners,
  canChangeSettings,
  canChangeTags,
  canConvert,
  canManageReports,
  canPublish,
  canReadReport,
  canReport,
  canVerify,
  readOwners,
  readStatus,
  readTags,
  wikiRowLimiter,
  type KbActor,
  type WikiLimiterInput,
} from './access';
import { KB_PROPERTY, KB_STATUS_OPTION, type KbLevel } from './constants';

const RILEY = '6f1c2b9e-4d3a-4e5f-9a8b-1c2d3e4f5a6b';
const SAM = '0b7d4c3a-2e1f-4a5b-8c6d-7e8f9a0b1c2d';
const DATABASE = 'a3e5c7d9-1b2f-4c6e-8a0d-2f4b6d8e0a1c';

function row(status: string | undefined, owners?: string[], createdBy: string | null = SAM) {
  const values: Record<string, unknown> = {};
  if (status !== undefined) values[KB_PROPERTY.status] = status;
  if (owners !== undefined) values[KB_PROPERTY.owner] = owners;
  return { id: 'b1c3e5a7-9d2f-4b6a-8c0e-1d3f5a7c9e2b', values, createdBy };
}

function limit(input: Partial<WikiLimiterInput> & Pick<WikiLimiterInput, 'row' | 'level'>) {
  return wikiRowLimiter({ databaseId: DATABASE, userId: RILEY, ...input });
}

describe('row values', () => {
  it('reads owners, falling back to the creator only when Owner was never set', () => {
    expect(readOwners(row(undefined).values, SAM)).toEqual([SAM]);
    expect(readOwners(row(undefined, []).values, SAM)).toEqual([]);
    expect(readOwners(row(undefined, [RILEY, RILEY, 7 as never]).values, SAM)).toEqual([RILEY]);
    expect(readOwners(row(undefined).values, null)).toEqual([]);
  });

  it('counts only Published as published', () => {
    expect(readStatus(row(KB_STATUS_OPTION.published).values)).toBe('published');
    expect(readStatus(row(KB_STATUS_OPTION.draft).values)).toBe('draft');
    expect(readStatus(row(undefined).values)).toBe('draft');
    expect(readStatus(row('something_else').values)).toBe('draft');
    expect(readTags({ [KB_PROPERTY.tags]: ['billing', 3] })).toEqual(['billing']);
  });
});

describe('the draft limiter (KB-03)', () => {
  it('leaves published pages alone', () => {
    for (const level of ['view', 'comment', 'edit', 'full'] as KbLevel[]) {
      expect(limit({ row: row(KB_STATUS_OPTION.published, [SAM]), level })).toBe(level);
    }
  });

  it('hides drafts from readers, commenters and share-link visitors', () => {
    expect(limit({ row: row(KB_STATUS_OPTION.draft, [SAM]), level: 'view' })).toBe('none');
    expect(limit({ row: row(KB_STATUS_OPTION.draft, [SAM]), level: 'comment' })).toBe('none');
    expect(limit({ row: row(undefined, [SAM]), level: 'view' })).toBe('none');
    expect(limit({ row: row('unknown', [SAM]), level: 'view' })).toBe('none');
    expect(limit({ row: row(KB_STATUS_OPTION.draft, [RILEY]), level: 'view', userId: null })).toBe(
      'none',
    );
  });

  it('shows drafts to their owners and to editors', () => {
    expect(limit({ row: row(KB_STATUS_OPTION.draft, [SAM, RILEY]), level: 'view' })).toBe('view');
    expect(limit({ row: row(KB_STATUS_OPTION.draft, undefined, RILEY), level: 'view' })).toBe(
      'view',
    );
    expect(limit({ row: row(KB_STATUS_OPTION.draft, [], RILEY), level: 'view' })).toBe('none');
    expect(limit({ row: row(KB_STATUS_OPTION.draft, [SAM]), level: 'edit' })).toBe('edit');
    expect(limit({ row: row(KB_STATUS_OPTION.draft, [SAM]), level: 'full' })).toBe('full');
  });

  it('uses the level on the knowledge base when Databases passes it', () => {
    const draft = row(KB_STATUS_OPTION.draft, [SAM]);
    expect(limit({ row: draft, level: 'edit', databaseLevel: 'edit_content' })).toBe('none');
    expect(limit({ row: draft, level: 'edit', databaseLevel: 'edit' })).toBe('edit');
    expect(limit({ row: draft, level: 'view', databaseLevel: 'full' })).toBe('none');
  });

  it('never raises a level', () => {
    expect(limit({ row: row(KB_STATUS_OPTION.draft, [RILEY]), level: 'none' })).toBe('none');
    expect(limit({ row: row(KB_STATUS_OPTION.published), level: 'none' })).toBe('none');
  });
});

describe('permissions (spec section 5)', () => {
  const actor = (baseLevel: KbLevel, isOwner = false, pageLevel: KbLevel = baseLevel): KbActor => ({
    baseLevel,
    pageLevel,
    isOwner,
  });

  it('lets owners and editors publish, and owners or Full access verify', () => {
    expect(canPublish(actor('view', true))).toBe(true);
    expect(canPublish(actor('edit'))).toBe(true);
    expect(canPublish(actor('comment'))).toBe(false);
    expect(canVerify(actor('view', true))).toBe(true);
    expect(canVerify(actor('edit'))).toBe(false);
    expect(canVerify(actor('full'))).toBe(true);
  });

  it('gives owners nothing once they can’t open the page', () => {
    const gone = actor('view', true, 'none');
    expect(canPublish(gone)).toBe(false);
    expect(canVerify(gone)).toBe(false);
    expect(canManageReports(gone)).toBe(false);
    expect(canVerify(actor('full', false, 'none'))).toBe(false);
  });

  it('keeps owners and tags for editors, with owners changing tags', () => {
    expect(canChangeOwners(actor('edit'))).toBe(true);
    expect(canChangeOwners(actor('view', true))).toBe(false);
    expect(canChangeTags(actor('view', true))).toBe(true);
    expect(canChangeTags(actor('edit_content'))).toBe(false);
  });

  it('shows reports to the reporter, owners and editors only', () => {
    expect(canReadReport(actor('view'), true)).toBe(true);
    expect(canReadReport(actor('view'), false)).toBe(false);
    expect(canReadReport(actor('view', true), false)).toBe(true);
    expect(canReadReport(actor('edit'), false)).toBe(true);
    expect(canReadReport(actor('comment', false, 'none'), true)).toBe(false);
  });

  it('lets signed-in readers report published pages', () => {
    expect(canReport(actor('view'), 'published', true)).toBe(true);
    expect(canReport(actor('view'), 'published', false)).toBe(false);
    expect(canReport(actor('edit'), 'draft', true)).toBe(false);
    expect(canReport(actor('none'), 'published', true)).toBe(false);
  });

  it('keeps settings and turning into a knowledge base to Full access', () => {
    expect(canChangeSettings('full')).toBe(true);
    expect(canChangeSettings('edit')).toBe(false);
    expect(canConvert('full', true)).toBe(true);
    expect(canConvert('full', false)).toBe(false);
    expect(canConvert('edit', true)).toBe(false);
  });
});
